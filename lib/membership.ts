import { BrowserProvider, JsonRpcProvider, Contract, parseUnits } from 'ethers';
import { WalletService } from '@unlock-protocol/unlock-js';

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
  const lockContract = new Contract(
    lockAddress,
    [
      'function totalKeys(address) view returns (uint256)',
      'function getHasValidKey(address) view returns (bool)',
    ],
    provider
  );

  for (const w of wallets) {
    if (w.address) {
      const total = await lockContract.totalKeys(w.address);
      if (total.toString() !== '0') {
        const valid = await lockContract.getHasValidKey(w.address);
        return valid ? 'active' : 'expired';
      }
    }
  }
  return 'none';
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
