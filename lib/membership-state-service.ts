import { Contract } from 'ethers';
import {
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  MEMBERSHIP_TIERS,
  USDC_ADDRESS,
  UNLOCK_SUBGRAPH_API_KEY,
  UNLOCK_SUBGRAPH_ID,
  UNLOCK_SUBGRAPH_URL,
  type MembershipTierConfig,
} from '@/lib/config';
import { getMembershipSummary, type MembershipSummary, type TierMembershipSummary } from '@/lib/membership-server';
import { getRpcProvider } from '@/lib/rpc/provider';

export interface MembershipStateService {
  getState(params: {
    addresses: string[];
    chainId?: number;
    forceRefresh?: boolean;
    hydrateMetadata?: boolean;
    includeAllowances?: boolean;
    includeTokenIds?: boolean;
  }): Promise<MembershipStateSnapshot>;

  getTierState(params: {
    addresses: string[];
    tierId: string;
    chainId?: number;
    forceRefresh?: boolean;
  }): Promise<TierStateSnapshot | null>;

  invalidate(addresses: string[], chainId?: number): boolean;

  prime(snapshot: MembershipStateSnapshot, params: { addresses: string[]; chainId?: number; ttlMs?: number }): void;
}

export type MembershipStateSnapshot = {
  chainId: number;
  fetchedAt: number;
  asOfBlock?: number;
  highestActiveTier: TierStateSnapshot | null;
  tiers: TierStateSnapshot[];
  allowances: Record<string, AllowanceState>;
  includesAllowances?: boolean;
  includesTokenIds?: boolean;
};

export type TierStateSnapshot = {
  tier: MembershipTierConfig;
  status: 'active' | 'expired' | 'none';
  expiry: number | null;
  tokenIds: string[];
  renewalApprovedAt?: number;
  metadata?: {
    name?: string | null;
    description?: string | null;
    image?: string | null;
    price?: string | null;
  };
};

export type AllowanceState = {
  lockAddress: string;
  amount: string;
  spender: string;
  isUnlimited: boolean;
  lastCheckedAt: number;
  keyPrice?: string | null;
};

const DEFAULT_CACHE_TTL_MS = 180_000; // 3 minutes
const UNLIMITED_ALLOWANCE_THRESHOLD = 2n ** 255n;
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
] as const;
const LOCK_ABI = [
  'function keyPrice() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
] as const;
const DEFAULT_SUBGRAPH_ENDPOINT = 'https://gateway.thegraph.com/api';

type CacheEntry = {
  snapshot: MembershipStateSnapshot;
  expiresAt: number;
};
const ALLOWANCE_BATCH_SIZE = 1;
const ALLOWANCE_BATCH_DELAY_MS = 500;
const BALANCE_RETRIES = 2;
const BALANCE_RETRY_DELAY_MS = 300;

function isThrottle(err: any): boolean {
  const code = err?.code ?? err?.statusCode ?? err?.error?.code;
  if (code === 429 || code === 503) return true;
  const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  return msg.includes('compute units per second') || msg.includes('rate limit') || msg.includes('throttle');
}

function describeRpc(url: string | undefined) {
  if (!url) return { urlMissing: true };
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const token = parts[parts.length - 1] || '';
    return {
      host: u.host,
      protocol: u.protocol.replace(':', ''),
      pathDepth: parts.length,
      keyLength: token.length || undefined,
      keyPreview: token.length >= 8 ? `${token.slice(0, 4)}...${token.slice(-4)}` : token || undefined,
    };
  } catch {
    return { invalidUrl: true };
  }
}

const rpcDebugInfo = describeRpc(BASE_RPC_URL);
const LOG_RPC_DEBUG = process.env.RPC_DEBUG === 'true';
if (LOG_RPC_DEBUG && typeof window === 'undefined') {
  try {
    const providerProbe = getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
    void providerProbe
      .getNetwork()
      .then((net) => {
        console.info('[RPC DEBUG] MembershipStateService network detected', {
          chainId: Number(net.chainId),
          name: net.name,
          rpc: rpcDebugInfo,
        });
      })
      .catch((err) => {
        console.error('[RPC DEBUG] MembershipStateService network detection failed', { rpc: rpcDebugInfo, error: err });
      });
  } catch (err) {
    console.error('[RPC DEBUG] MembershipStateService provider init failed', { rpc: rpcDebugInfo, error: err });
  }
}

class InMemoryMembershipStateService implements MembershipStateService {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<MembershipStateSnapshot>>();

  async getState(params: { addresses: string[]; chainId?: number; forceRefresh?: boolean; hydrateMetadata?: boolean; includeAllowances?: boolean; includeTokenIds?: boolean }) {
    const { normalized, chainId, cacheKey } = this.prepareParams(params.addresses, params.chainId);
    const includeAllowances = params.includeAllowances !== false;
    const includeTokenIds = params.includeTokenIds !== false;
    const variantKey = `${cacheKey}:${includeAllowances ? 'a1' : 'a0'}:${includeTokenIds ? 't1' : 't0'}`;
    if (!normalized.length) {
      return this.emptySnapshot(chainId);
    }

    if (!params.forceRefresh) {
      const cached = this.cache.get(variantKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.snapshot;
      }
    }

    if (!params.forceRefresh && this.pending.has(variantKey)) {
      return this.pending.get(variantKey)!;
    }

    const fetchPromise = this.fetchSnapshot(normalized, chainId, { includeAllowances, includeTokenIds });
    this.pending.set(variantKey, fetchPromise);
    try {
      const snapshot = await fetchPromise;
      this.cache.set(variantKey, { snapshot, expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS });
      return snapshot;
    } finally {
      this.pending.delete(variantKey);
    }
  }

  async getTierState(params: { addresses: string[]; tierId: string; chainId?: number; forceRefresh?: boolean }) {
    const state = await this.getState({ addresses: params.addresses, chainId: params.chainId, forceRefresh: params.forceRefresh });
    const normalizedTier = params.tierId?.trim().toLowerCase();
    if (!normalizedTier) return null;
    return state.tiers.find((tier) => tier.tier.id === normalizedTier || tier.tier.address === normalizedTier || tier.tier.checksumAddress.toLowerCase() === normalizedTier) || null;
  }

  invalidate(addresses: string[], chainId?: number) {
    const { cacheKey } = this.prepareParams(addresses, chainId);
    let deleted = false;
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${cacheKey}:`)) {
        this.cache.delete(key);
        deleted = true;
      }
    }
    return deleted;
  }

  prime(snapshot: MembershipStateSnapshot, params: { addresses: string[]; chainId?: number; ttlMs?: number; includeAllowances?: boolean; includeTokenIds?: boolean }) {
    const { normalized, cacheKey } = this.prepareParams(params.addresses, params.chainId);
    if (!normalized.length) return;
    const ttl = typeof params.ttlMs === 'number' && params.ttlMs > 0 ? params.ttlMs : DEFAULT_CACHE_TTL_MS;
    const includeAllowances = params.includeAllowances !== false;
    const includeTokenIds = params.includeTokenIds !== false;
    const variantKey = `${cacheKey}:${includeAllowances ? 'a1' : 'a0'}:${includeTokenIds ? 't1' : 't0'}`;
    this.cache.set(variantKey, { snapshot, expiresAt: Date.now() + ttl });
  }

  private prepareParams(addresses: string[], chainId?: number) {
    const normalized = Array.from(new Set((addresses || []).map((addr) => addr?.toLowerCase()).filter((addr): addr is string => typeof addr === 'string' && addr.length > 0))).sort();
    const resolvedChainId = typeof chainId === 'number' && chainId > 0 ? chainId : BASE_NETWORK_ID;
    const cacheKey = `${resolvedChainId}:${normalized.join(',')}`;
    return { normalized, chainId: resolvedChainId, cacheKey };
  }

  private emptySnapshot(chainId: number): MembershipStateSnapshot {
    return {
      chainId,
      fetchedAt: Date.now(),
      tiers: [],
      highestActiveTier: null,
      allowances: {},
    };
  }

  private async fetchSnapshot(
    addresses: string[],
    chainId: number,
    opts?: { includeAllowances?: boolean; includeTokenIds?: boolean },
  ): Promise<MembershipStateSnapshot> {
    let summary: MembershipSummary;
    try {
      summary = await getMembershipSummary(addresses, BASE_RPC_URL, chainId);
    } catch (err) {
      console.error('MembershipStateService: summary fetch failed, returning empty snapshot', err);
      return this.emptySnapshot(chainId);
    }

    const tiers: TierStateSnapshot[] = summary.tiers.length
      ? await Promise.all(
          summary.tiers.map(async (tierSummary) => ({
            tier: tierSummary.tier,
            status: tierSummary.status,
            expiry: tierSummary.expiry ?? null,
            tokenIds: opts?.includeTokenIds === false ? [] : await this.fetchTokenIds(addresses, tierSummary.tier.checksumAddress, chainId),
            metadata: tierSummary.metadata,
          })),
        )
      : this.buildDefaultTierEntries();

    const highestActive = tiers.find((tier) => tier.status === 'active') || null;

    const allowances = opts?.includeAllowances === false ? {} : await this.fetchAllowances(addresses, chainId);

    return {
      chainId,
      fetchedAt: Date.now(),
      tiers,
      highestActiveTier: highestActive,
      allowances,
      includesAllowances: opts?.includeAllowances !== false,
      includesTokenIds: opts?.includeTokenIds !== false,
    };
  }

  private buildDefaultTierEntries(): TierStateSnapshot[] {
    return MEMBERSHIP_TIERS.map((tier) => ({
      tier,
      status: 'none',
      expiry: null,
      tokenIds: [],
    }));
  }

  private buildSubgraphUrl(): string | null {
    if (UNLOCK_SUBGRAPH_URL?.trim()) {
      return UNLOCK_SUBGRAPH_URL.trim();
    }
    if (UNLOCK_SUBGRAPH_API_KEY?.trim() && UNLOCK_SUBGRAPH_ID?.trim()) {
      return `${DEFAULT_SUBGRAPH_ENDPOINT}/${UNLOCK_SUBGRAPH_API_KEY.trim()}/subgraphs/id/${UNLOCK_SUBGRAPH_ID.trim()}`;
    }
    return null;
  }

  private async fetchTokenIdsFromSubgraph(lockAddress: string, owners: string[]): Promise<{ tokenIds: string[]; ownersWithKeys: Set<string> }> {
    const endpoint = this.buildSubgraphUrl();
    if (!endpoint || !owners.length) return { tokenIds: [], ownersWithKeys: new Set() };
    const normalizedOwners = Array.from(
      new Set(
        owners
          .map((addr) => (typeof addr === 'string' ? addr.trim().toLowerCase() : ''))
          .filter((addr): addr is string => addr.length > 0),
      ),
    );
    if (!normalizedOwners.length) return { tokenIds: [], ownersWithKeys: new Set() };

    const payload = {
      query: `
        query TokenIds($lock: String!, $owners: [String!]) {
          keys(where: { lock: $lock, owner_in: $owners }) {
            tokenId
            owner
          }
        }
      `,
      variables: {
        lock: lockAddress.toLowerCase(),
        owners: normalizedOwners,
      },
    };

    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (UNLOCK_SUBGRAPH_API_KEY?.trim()) {
        headers['x-api-key'] = UNLOCK_SUBGRAPH_API_KEY.trim();
        headers['authorization'] = `Bearer ${UNLOCK_SUBGRAPH_API_KEY.trim()}`;
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`Subgraph responded with ${res.status}`);
      }
      const body = await res.json();
      const rows: any[] = body?.data?.keys ?? [];
      const ownersWithKeys = new Set<string>();
      const tokenIds = rows
        .map((row) => {
          const tokenIdRaw = row?.tokenId;
          const owner = typeof row?.owner === 'string' ? row.owner.toLowerCase() : null;
          if (owner) {
            ownersWithKeys.add(owner);
          }
          if (tokenIdRaw == null) return null;
          try {
            const value = typeof tokenIdRaw === 'bigint' ? tokenIdRaw : BigInt(tokenIdRaw);
            return value >= 0n ? value.toString() : null;
          } catch {
            const asString = String(tokenIdRaw);
            return asString.length ? asString : null;
          }
        })
        .filter((id): id is string => !!id);
      return { tokenIds: Array.from(new Set(tokenIds)), ownersWithKeys };
    } catch (err) {
      if (LOG_RPC_DEBUG) {
        console.warn('MembershipStateService: subgraph tokenIds fetch failed', lockAddress, err);
      }
      return { tokenIds: [], ownersWithKeys: new Set() };
    }
  }

  private async fetchTokenIds(addresses: string[], lockAddress: string, chainId: number): Promise<string[]> {
    if (!addresses.length) return [];
    const discoveredOwners = new Set<string>();
    const provider = getRpcProvider(BASE_RPC_URL, chainId);
    const contract = new Contract(lockAddress, LOCK_ABI, provider);
    const ids = new Set<string>();

    // Prefer subgraph to get deterministic token ids, especially for non-enumerable locks.
    const subgraph = await this.fetchTokenIdsFromSubgraph(lockAddress, addresses);
    subgraph.tokenIds.forEach((id) => ids.add(id));
    subgraph.ownersWithKeys.forEach((owner) => discoveredOwners.add(owner));

    // Fallback to on-chain enumeration for any owners not returned by the subgraph (or when subgraph is unavailable).
    const remainingOwners = addresses.filter((owner) => !discoveredOwners.has(owner.toLowerCase()));
    for (const owner of remainingOwners) {
      try {
        const balance: bigint = await contract.balanceOf(owner).catch(() => 0n);
        if (balance <= 0n) continue;
        const count = Number(balance);
        const cap = Number.isFinite(count) ? Math.min(count, 5) : 0;
        for (let i = 0; i < cap; i++) {
          try {
            const tokenId = await contract.tokenOfOwnerByIndex(owner, BigInt(i));
            const value = typeof tokenId === 'bigint' ? tokenId : BigInt(tokenId);
            ids.add(value.toString());
          } catch {
            break;
          }
        }
      } catch (err) {
        if (LOG_RPC_DEBUG && !isThrottle(err)) {
          console.warn('MembershipStateService: tokenIds fetch failed', lockAddress, owner, err);
        }
      }
    }

    return Array.from(ids);
  }

  private async fetchAllowances(addresses: string[], chainId: number): Promise<Record<string, AllowanceState>> {
    if (!USDC_ADDRESS || !addresses.length || !MEMBERSHIP_TIERS.length) {
      return {};
    }

    const provider = getRpcProvider(BASE_RPC_URL, chainId);
    const erc20 = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const withRetry = async <T>(fn: () => Promise<T>) => {
      let attempt = 0;
      let lastErr: any;
      while (attempt <= BALANCE_RETRIES) {
        try {
          return await fn();
        } catch (err) {
          lastErr = err;
          if (attempt >= BALANCE_RETRIES || !isThrottle(err)) break;
          await sleep(BALANCE_RETRY_DELAY_MS * (attempt + 1));
        }
        attempt += 1;
      }
      throw lastErr;
    };
    const now = Date.now();
    const map: Record<string, AllowanceState> = {};

    await Promise.all(
      MEMBERSHIP_TIERS.map(async (tier) => {
        let maxAllowance = 0n;
        for (let i = 0; i < addresses.length; i += ALLOWANCE_BATCH_SIZE) {
          const batch = addresses.slice(i, i + ALLOWANCE_BATCH_SIZE);
          await Promise.all(
            batch.map(async (owner) => {
              try {
                const value: bigint = await withRetry(() => erc20.allowance(owner, tier.checksumAddress));
                if (value > maxAllowance) {
                  maxAllowance = value;
                }
              } catch (err) {
                if (LOG_RPC_DEBUG && !isThrottle(err)) {
                  console.warn('MembershipStateService: allowance fetch failed', owner, tier.checksumAddress, err);
                }
              }
            }),
          );
          if (i + ALLOWANCE_BATCH_SIZE < addresses.length) {
            await sleep(ALLOWANCE_BATCH_DELAY_MS);
          }
        }

        let keyPriceRaw: bigint | null = null;
        try {
          const lock = new Contract(tier.checksumAddress, LOCK_ABI, provider);
          keyPriceRaw = await lock.keyPrice();
        } catch (err) {
          if (LOG_RPC_DEBUG && !isThrottle(err)) {
            console.warn('MembershipStateService: keyPrice fetch failed', tier.checksumAddress, err);
          }
        }

        const key = tier.checksumAddress.toLowerCase();
        map[key] = {
          lockAddress: tier.checksumAddress,
          amount: maxAllowance.toString(),
          spender: tier.checksumAddress,
          isUnlimited: maxAllowance >= UNLIMITED_ALLOWANCE_THRESHOLD,
          lastCheckedAt: now,
          keyPrice: keyPriceRaw ? keyPriceRaw.toString() : null,
        };
      }),
    );

    return map;
  }
}

export const membershipStateService: MembershipStateService = new InMemoryMembershipStateService();

export function snapshotToMembershipSummary(snapshot: MembershipStateSnapshot): { summary: MembershipSummary; allowances: Record<string, AllowanceState>; tokenIds: Record<string, string[]>; includesAllowances: boolean; includesTokenIds: boolean } {
  const tiers: TierMembershipSummary[] = snapshot.tiers.map((tier) => ({
    tier: tier.tier,
    status: tier.status,
    expiry: tier.expiry ?? null,
    tokenIds: tier.tokenIds,
    metadata: tier.metadata,
  }));

  let status: 'active' | 'expired' | 'none' = 'none';
  let expiry: number | null = null;
  for (const tier of tiers) {
    if (tier.status === 'active') {
      status = 'active';
      if (typeof tier.expiry === 'number' && (!expiry || tier.expiry > expiry)) {
        expiry = tier.expiry;
      }
    } else if (status !== 'active' && tier.status === 'expired') {
      status = 'expired';
      if (typeof tier.expiry === 'number' && (!expiry || tier.expiry > expiry)) {
        expiry = tier.expiry;
      }
    }
  }

  const activeTiers = tiers.filter((tier) => tier.status === 'active');
  const highestActiveTier = activeTiers.length
    ? activeTiers.reduce((prev, current) => (current.tier.order < prev.tier.order ? current : prev))
    : null;

  return {
    summary: {
      status,
      expiry,
    tiers,
    highestActiveTier,
  },
    allowances: snapshot.allowances,
    tokenIds: snapshot.tiers.reduce<Record<string, string[]>>((acc, tier) => {
      acc[tier.tier.checksumAddress.toLowerCase()] = tier.tokenIds;
      return acc;
    }, {}),
    includesAllowances: snapshot.includesAllowances === false ? false : true,
    includesTokenIds: snapshot.includesTokenIds === false ? false : true,
  };
}
