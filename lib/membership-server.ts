import { Contract } from 'ethers';
import { LOCKSMITH_BASE_URL, MEMBERSHIP_TIERS, MembershipTierConfig } from '@/lib/config';
import { getRpcProvider } from '@/lib/rpc/provider';

const ABI = [
  'function getHasValidKey(address _owner) view returns (bool)',
  'function keyExpirationTimestampFor(address _owner) view returns (uint256)',
  'function totalKeys(address _owner) view returns (uint256)',
  'function balanceOf(address _owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address _owner, uint256 _index) view returns (uint256)',
  'function keyExpirationTimestampFor(uint256 _tokenId) view returns (uint256)',
  'function tokenExpirationTimestamp(uint256 _tokenId) view returns (uint256)',
  'function expirationTimestampFor(uint256 _tokenId) view returns (uint256)',
] as const;

type TierStatus = 'active' | 'expired' | 'none';

export type TierMembershipSummary = {
  tier: MembershipTierConfig;
  status: TierStatus;
  expiry: number | null;
  tokenIds?: string[];
  metadata?: {
    name?: string | null;
    description?: string | null;
    image?: string | null;
    price?: string | null;
  };
};

export type MembershipSummary = {
  status: TierStatus;
  expiry: number | null;
  tiers: TierMembershipSummary[];
  highestActiveTier: TierMembershipSummary | null;
};

const lockMetadataCache = new Map<string, any>();

async function fetchTierMetadata(lockAddress: string, networkId: number) {
  if (!LOCKSMITH_BASE_URL) return null;
  const key = `${networkId}:${lockAddress.toLowerCase()}`;
  if (lockMetadataCache.has(key)) {
    return lockMetadataCache.get(key);
  }
  try {
    const url = `${LOCKSMITH_BASE_URL}/v2/api/metadata/${networkId}/locks/${lockAddress}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      lockMetadataCache.set(key, null);
      return null;
    }
    const data = await res.json();
    lockMetadataCache.set(key, data);
    return data;
  } catch {
    lockMetadataCache.set(key, null);
    return null;
  }
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function callWithRetries<T>(fn: () => Promise<T>, attempts = 3, delayMs = 200): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { lastErr = e; if (i < attempts - 1) await sleep(delayMs * (i + 1)); }
  }
  throw lastErr;
}

async function evaluateLockMembership(addresses: string[], rpcUrl: string, networkId: number, lockAddress: string): Promise<{ status: TierStatus; expiry: number | null }>{
  const provider = getRpcProvider(rpcUrl, networkId);
  const contract = new Contract(lockAddress, ABI, provider);
  const now = Math.floor(Date.now() / 1000);
  let maxExpiry: number | null = null;
  let anyHasValidKey = false;
  let hadAnyKey = false;

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
      if (has) anyHasValidKey = true;
    } catch {}

    // Try totalKeys first (more widely supported than ERC721 enumerable on some versions)
    try {
      const total: bigint = await callWithRetries(() => contract.totalKeys(addr));
      if (total > 0n) hadAnyKey = true;
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
        hadAnyKey = true;
        const tokenId: bigint = await callWithRetries(() => contract.tokenOfOwnerByIndex(addr, 0n));
        const n = await tryTokenExpiry(tokenId);
        if (typeof n === 'number' && n > 0) maxExpiry = Math.max(maxExpiry ?? 0, n);
      }
    } catch {}
  }

  let status: 'active'|'expired'|'none' = 'none';
  if (typeof maxExpiry === 'number' && maxExpiry > 0) {
    status = maxExpiry > now ? 'active' : 'expired';
  } else if (anyHasValidKey) {
    status = 'active';
  } else if (hadAnyKey) {
    // Address holds (or held) a key but we could not fetch a timestamp; treat as expired
    status = 'expired';
  }
  return { status, expiry: maxExpiry ?? null };
}

export async function getStatusAndExpiry(addresses: string[], rpcUrl: string, networkId: number, lockAddress: string): Promise<{ status: TierStatus; expiry: number | null }>{
  return evaluateLockMembership(addresses, rpcUrl, networkId, lockAddress);
}

export async function getMembershipSummary(addresses: string[], rpcUrl: string, networkId: number): Promise<MembershipSummary> {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { status: 'none', expiry: null, tiers: [], highestActiveTier: null };
  }

  const normalizedAddresses = Array.from(new Set(addresses.map((addr) => addr.toLowerCase())));

  const tiers: TierMembershipSummary[] = [];
  let highestActiveTier: TierMembershipSummary | null = null;
  let hasAnyActive = false;
  let maxExpiredExpiry: number | null = null;
  const farFutureCutoffSec = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 50; // 50 years

  for (const tier of MEMBERSHIP_TIERS) {
    const { status, expiry } = await evaluateLockMembership(normalizedAddresses, rpcUrl, networkId, tier.checksumAddress);
    const metadataRaw = await fetchTierMetadata(tier.checksumAddress, networkId);
    const metadata = metadataRaw
      ? {
          name: metadataRaw?.name ?? metadataRaw?.lockName ?? metadataRaw?.metadata?.name ?? null,
          description: metadataRaw?.description ?? metadataRaw?.metadata?.description ?? null,
          image: metadataRaw?.image ?? metadataRaw?.metadata?.image ?? null,
          price: metadataRaw?.price ?? metadataRaw?.metadata?.price ?? null,
        }
      : undefined;

    const isFarFuture = typeof expiry === 'number' && Number.isFinite(expiry) && expiry > farFutureCutoffSec;
    const normalizedExpiry = status === 'active' && (tier.neverExpires || isFarFuture) ? null : expiry ?? null;
    const entry: TierMembershipSummary = {
      tier,
      status,
      expiry: normalizedExpiry,
      metadata,
    };
    tiers.push(entry);

    if (status === 'active') {
      hasAnyActive = true;
      if (!highestActiveTier || tier.order < highestActiveTier.tier.order) {
        highestActiveTier = entry;
      }
    } else if (status === 'expired') {
      if (typeof entry.expiry === 'number' && Number.isFinite(entry.expiry) && entry.expiry > 0) {
        maxExpiredExpiry = Math.max(maxExpiredExpiry ?? 0, entry.expiry);
      }
    }
  }

  const overallStatus: TierStatus = hasAnyActive ? 'active' : maxExpiredExpiry ? 'expired' : 'none';
  const overallExpiry: number | null =
    overallStatus === 'active'
      ? (typeof highestActiveTier?.expiry === 'number' ? highestActiveTier.expiry : null)
      : overallStatus === 'expired'
        ? maxExpiredExpiry
        : null;

  return {
    status: overallStatus,
    expiry: overallExpiry,
    tiers,
    highestActiveTier,
  };
}
