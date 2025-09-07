import { BrowserProvider, JsonRpcProvider, Contract, parseUnits } from 'ethers';
import { WalletService, Web3Service } from '@unlock-protocol/unlock-js';
import { UNLOCK_ADDRESS } from '@/lib/config';

export const UNLOCK_ERRORS: Record<string, string> = {
  '0x17ed8646': 'Membership sold out or max keys reached.',
  '0x31af6951': 'Lock sold out.',
  '0x1f04ddc8': 'Not enough funds.',
};

export function decodeUnlockError(data: string) {
  const code = data.slice(0, 10).toLowerCase();
  return UNLOCK_ERRORS[code] || data;
}

export async function checkMembership(
  wallets: any[],
  rpcUrl: string,
  networkId: number,
  lockAddress: string
): Promise<'active' | 'expired' | 'none'> {
  const provider = new JsonRpcProvider(rpcUrl, networkId);
  const lock = new Contract(
    lockAddress,
    [
      'function getHasValidKey(address _owner) view returns (bool)',
      'function totalKeys(address _owner) view returns (uint256)',
      'function keyExpirationTimestampFor(address _owner) view returns (uint256)',
      'function balanceOf(address _owner) view returns (uint256)',
      'function tokenOfOwnerByIndex(address _owner, uint256 _index) view returns (uint256)',
      'function keyExpirationTimestampFor(uint256 _tokenId) view returns (uint256)',
      'function tokenExpirationTimestamp(uint256 _tokenId) view returns (uint256)',
      'function expirationTimestampFor(uint256 _tokenId) view returns (uint256)',
    ],
    provider
  );

  const now = BigInt(Math.floor(Date.now() / 1000));
  // no-op

  const tryTokenExpiry = async (tokenId: bigint): Promise<bigint | null> => {
    const sigs = [
      'keyExpirationTimestampFor(uint256)',
      'tokenExpirationTimestamp(uint256)',
      'expirationTimestampFor(uint256)'
    ];
    for (const sig of sigs) {
      try {
        const f = lock.getFunction(sig);
        const ts: bigint = await f(tokenId);
        return ts;
      } catch {}
    }
    return null;
  };

  for (const w of wallets) {
    const addr = (w as any)?.address || (typeof w === 'string' ? w : undefined);
    if (!addr) continue;
    // no-op
    // 1) If contract says it's valid, we're done
    try {
      const has = await lock.getHasValidKey(addr);
      if (has) { return 'active'; }
    } catch {}

    // 2) If key exists but not valid -> expired
    let hadAnyKey = false;
    try {
      const total: bigint = await lock.totalKeys(addr);
      if (total > 0n) hadAnyKey = true;
    } catch {}

    // 3) Try address-based expiration
    try {
      const fn = lock.getFunction('keyExpirationTimestampFor(address)');
      const ts: bigint = await fn(addr);
      if (ts > 0n) {
        if (ts > now) { return 'active'; }
        return 'expired';
      }
    } catch {}

    // 4) Try by token id via enumerable
    try {
      const bal: bigint = await lock.balanceOf(addr);
      if (bal > 0n) {
        hadAnyKey = true;
        const tokenId: bigint = await lock.tokenOfOwnerByIndex(addr, 0n);
        const ts = await tryTokenExpiry(tokenId);
        if (ts && ts > 0n) {
          if (ts > now) { return 'active'; }
          return 'expired';
        }
      }
    } catch {}

    if (hadAnyKey) { return 'expired'; }
  }
  return 'none';
}

export async function getMembershipExpiration(
  wallets: any[],
  rpcUrl: string,
  networkId: number,
  lockAddress: string
): Promise<number | null> {
  const provider = new JsonRpcProvider(rpcUrl, networkId);
  // Prefer Unlock's Web3Service which handles ABI differences across versions
  const web3 = new Web3Service({
    [networkId]: {
      provider: rpcUrl,
      unlockAddress: UNLOCK_ADDRESS,
    },
  } as any);
  // no-op
  // Include multiple ABIs to support various PublicLock versions
  const lock = new Contract(
    lockAddress,
    [
      'function keyExpirationTimestampFor(address _owner) view returns (uint256)',
      'function keyExpirationTimestampFor(uint256 _tokenId) view returns (uint256)',
      'function keyExpirationTimestampFor(uint _tokenId) view returns (uint256)',
      'function tokenExpirationTimestamp(uint256 _tokenId) view returns (uint256)',
      'function tokenExpirationTimestamp(uint _tokenId) view returns (uint256)',
      'function expirationTimestampFor(uint256 _tokenId) view returns (uint256)',
      'function expirationTimestampFor(uint _tokenId) view returns (uint256)',
      'function balanceOf(address _owner) view returns (uint256)',
      'function tokenOfOwnerByIndex(address _owner, uint256 _index) view returns (uint256)',
      'function getTokenIdFor(address _owner) view returns (uint256)'
    ],
    provider
  );

  let maxTs = 0n;

  const tryForAddress = async (addr: string) => {
    // no-op
    // 0) Try via Unlock Web3Service (works across lock versions)
    try {
      const tsAny: any = await web3.getKeyExpirationByLockForOwner(
        lockAddress,
        addr,
        networkId
      );
      const n = typeof tsAny === 'bigint'
        ? Number(tsAny)
        : typeof tsAny === 'string'
        ? Number(tsAny)
        : Number(tsAny?.toString?.() ?? tsAny);
      if (Number.isFinite(n) && n > 0) {
        const b = BigInt(Math.floor(n));
        if (b > maxTs) maxTs = b;
        return;
      }
    } catch (e) { }

    // Try address-based expiry first (some locks expose this)
    try {
      const fn = lock.getFunction('keyExpirationTimestampFor(address)');
      const ts: bigint = await fn(addr);
      if (ts > maxTs) maxTs = ts;
      return;
    } catch (e) { }
    // Try via getTokenIdFor + keyExpirationTimestampFor(uint256)
    try {
      const getId = lock.getFunction('getTokenIdFor(address)');
      const tokenId: bigint = await getId(addr);
      if (tokenId && tokenId > 0n) {
        const tsFn = lock.getFunction('keyExpirationTimestampFor(uint256)');
        const ts: bigint = await tsFn(tokenId);
        if (ts > maxTs) maxTs = ts;
        return;
      }
    } catch (e) { }
    // Fallback: use ERC721Enumerable balance + tokenOfOwnerByIndex
    try {
      const bal: bigint = await lock.balanceOf(addr);
      if (bal > 0n) {
        const tokenId: bigint = await lock.tokenOfOwnerByIndex(addr, 0n);
        // Try a variety of potential function signatures for expiration-by-tokenId
        const tryTokenTs = async (): Promise<bigint | null> => {
          const sigs = [
            'keyExpirationTimestampFor(uint256)',
            'keyExpirationTimestampFor(uint)',
            'tokenExpirationTimestamp(uint256)',
            'tokenExpirationTimestamp(uint)',
            'expirationTimestampFor(uint256)',
            'expirationTimestampFor(uint)',
          ];
          for (const sig of sigs) {
            try {
              const f = lock.getFunction(sig);
              const r: bigint = await f(tokenId);
              return r;
            } catch {}
          }
          return null;
        };
        const tsMaybe = await tryTokenTs();
        const ts: bigint = tsMaybe ?? 0n;
        if (ts > maxTs) maxTs = ts;
      }
    } catch (e) { }
  };

  for (const w of wallets) {
    const addr = (w as any)?.address || (typeof w === 'string' ? w : undefined);
    if (!addr) continue;
    await tryForAddress(addr);
  }

  if (maxTs === 0n) return null;
  try {
    return Number(maxTs);
  } catch {
    return null;
  }
}

async function prepareSigner(
  wallet: any,
  walletService: WalletService,
  networkId: number
) {
  const eip1193 = await wallet.getEthereumProvider();
  try {
    await eip1193.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x2105' }],
    });
  } catch (switchError: any) {
    if (switchError.code === 4902) {
      await eip1193.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: '0x2105',
            chainName: 'Base',
            rpcUrls: ['https://mainnet.base.org'],
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            blockExplorerUrls: ['https://basescan.org'],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }

  const browserProvider = new BrowserProvider(eip1193, networkId);
  const signer = await browserProvider.getSigner();
  await walletService.connect(browserProvider as unknown as JsonRpcProvider, signer);
  return signer;
}

async function ensureUsdcApproval(
  signer: any,
  owner: string,
  lockAddress: string,
  usdcAddress: string,
  amount = parseUnits('0.1', 6)
) {
  const usdc = new Contract(
    usdcAddress,
    [
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)',
    ],
    signer
  );
  const allowance = await usdc.allowance(owner, lockAddress);
  if (allowance < amount) {
    const approveTx = await usdc.approve(lockAddress, amount);
    await approveTx.wait();
  }
}

export async function purchaseMembership(
  wallet: any,
  walletService: WalletService,
  networkId: number,
  lockAddress: string,
  usdcAddress: string
) {
  const signer = await prepareSigner(wallet, walletService, networkId);
  await ensureUsdcApproval(signer, wallet.address, lockAddress, usdcAddress);
  return walletService.purchaseKey({
    lockAddress,
    owner: wallet.address,
    keyPrice: '0.1',
    erc20Address: usdcAddress,
    decimals: 6,
  } as any);
}

export async function renewMembership(
  wallet: any,
  walletService: WalletService,
  networkId: number,
  lockAddress: string,
  usdcAddress: string
) {
  const signer = await prepareSigner(wallet, walletService, networkId);
  await ensureUsdcApproval(signer, wallet.address, lockAddress, usdcAddress);
  return walletService.extendKey({
    lockAddress,
    owner: wallet.address,
    keyPrice: '0.1',
    erc20Address: usdcAddress,
    decimals: 6,
    referrer: wallet.address,
  } as any);
}
