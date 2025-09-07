import { JsonRpcProvider, Contract } from 'ethers';

const ABI = [
  'function getHasValidKey(address _owner) view returns (bool)',
  'function keyExpirationTimestampFor(address _owner) view returns (uint256)',
  'function balanceOf(address _owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address _owner, uint256 _index) view returns (uint256)',
  'function keyExpirationTimestampFor(uint256 _tokenId) view returns (uint256)',
  'function tokenExpirationTimestamp(uint256 _tokenId) view returns (uint256)',
  'function expirationTimestampFor(uint256 _tokenId) view returns (uint256)',
] as const;

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function callWithRetries<T>(fn: () => Promise<T>, attempts = 3, delayMs = 200): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { lastErr = e; if (i < attempts - 1) await sleep(delayMs * (i + 1)); }
  }
  throw lastErr;
}

export async function getStatusAndExpiry(addresses: string[], rpcUrl: string, networkId: number, lockAddress: string): Promise<{ status: 'active'|'expired'|'none'; expiry: number | null }>{
  const provider = new JsonRpcProvider(rpcUrl, networkId);
  const contract = new Contract(lockAddress, ABI, provider);
  const now = Math.floor(Date.now() / 1000);
  let maxExpiry: number | null = null;
  let anyHasKey = false;

  const tryTokenExpiry = async (tokenId: bigint): Promise<number | null> => {
    const sigs = [
      'keyExpirationTimestampFor(uint256)',
      'tokenExpirationTimestamp(uint256)',
      'expirationTimestampFor(uint256)'
    ];
    for (const sig of sigs) {
      try {
        const fn = contract.getFunction(sig);
        const ts: bigint = await callWithRetries(() => fn(tokenId));
        const n = Number(ts);
        if (Number.isFinite(n) && n > 0) return n;
      } catch {}
    }
    return null;
  };

  for (const addrRaw of addresses) {
    const addr = addrRaw.toLowerCase();
    try {
      const has = await callWithRetries(() => contract.getHasValidKey(addr));
      if (has) anyHasKey = true;
    } catch {}

    // Direct address-based expiry
    try {
      const fn = contract.getFunction('keyExpirationTimestampFor(address)');
      const ts: bigint = await callWithRetries(() => fn(addr));
      const n = Number(ts);
      if (Number.isFinite(n) && n > 0) {
        maxExpiry = Math.max(maxExpiry ?? 0, n);
        continue;
      }
    } catch {}

    // Enumerable path
    try {
      const bal: bigint = await callWithRetries(() => contract.balanceOf(addr));
      if (bal > 0n) {
        const tokenId: bigint = await callWithRetries(() => contract.tokenOfOwnerByIndex(addr, 0n));
        const n = await tryTokenExpiry(tokenId);
        if (typeof n === 'number' && n > 0) maxExpiry = Math.max(maxExpiry ?? 0, n);
      }
    } catch {}
  }

  let status: 'active'|'expired'|'none' = 'none';
  if (typeof maxExpiry === 'number' && maxExpiry > 0) {
    status = maxExpiry > now ? 'active' : 'expired';
  } else if (anyHasKey) {
    status = 'active';
  }
  return { status, expiry: maxExpiry ?? null };
}

