import { Contract, formatUnits } from "ethers";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import {
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  MEMBERSHIP_TIERS,
  UNLOCK_SUBGRAPH_API_KEY,
  UNLOCK_SUBGRAPH_ID,
  UNLOCK_SUBGRAPH_URL,
  USDC_ADDRESS,
} from "@/lib/config";
import { membershipStateService, snapshotToMembershipSummary, type AllowanceState } from "@/lib/membership-state-service";
import { pickHighestActiveTier, pickNextActiveTier, resolveTierLabel } from "@/lib/membership-tiers";
import { getRpcProvider } from "@/lib/rpc/provider";
import {
  getRosterCacheConfig,
  loadRosterCache,
  rebuildRosterCache,
  type AdminRosterCacheStatus,
} from "@/lib/admin/roster-cache";

type RawUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  wallets?: string[] | null;
  walletAddress?: string | null;
  isAdmin?: boolean | null;
  welcomeEmailSentAt?: string | null;
  lastEmailSentAt?: string | null;
  lastEmailType?: string | null;
  emailBounceReason?: string | null;
  emailSuppressed?: boolean | null;
  isTestMember?: boolean | null;
};

export type AdminMember = {
  id: string;
  name: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  wallets: string[];
  primaryWallet: string | null;
  membershipStatus: "active" | "expired" | "none" | "unknown";
  membershipExpiry: number | null;
  highestActiveTierId: string | null;
  highestActiveTierLabel: string | null;
  highestActiveTierExpiry: number | null;
  highestActiveTierLock: string | null;
  highestActiveTierTokenId: string | null;
  nextActiveTierId: string | null;
  nextActiveTierLabel: string | null;
  nextActiveTierExpiry: number | null;
  autoRenew: boolean | null;
  allowances: Record<string, AllowanceState>;
  ethBalance: string | null;
  usdcBalance: string | null;
  isAdmin: boolean;
  welcomeEmailSentAt: string | null;
  lastEmailSentAt: string | null;
  lastEmailType: string | null;
  emailBounceReason: string | null;
  emailSuppressed: boolean | null;
  membershipCheckedAt: number | null;
  memberSince: number | null;
  isTestMember: boolean;
};

export type AdminRoster = {
  members: AdminMember[];
  meta: {
    total: number;
    active: number;
    expired: number;
    none: number;
    autoRenewOn: number;
    autoRenewOff: number;
    expiringSoon: number;
  };
  cache?: AdminRosterCacheStatus;
};

export type BuildAdminRosterOptions = {
  includeAllowances?: boolean;
  includeBalances?: boolean;
  includeTokenIds?: boolean;
  statusFilter?: "all" | "active" | "expired" | "none";
  forceRefresh?: boolean;
  preferStale?: boolean;
  triggerRebuild?: boolean;
  forceRebuild?: boolean;
  memberSinceByWallet?: Record<string, number | null>;
};

const ERC20_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"] as const;
const provider = getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
const usdcContract = USDC_ADDRESS ? new Contract(USDC_ADDRESS, ERC20_BALANCE_ABI, provider) : null;
const balanceCache = new Map<string, { ethBalance: string | null; usdcBalance: string | null }>();
const blockTimestampCache = new Map<number, number>();
const LOG_RPC_DEBUG = process.env.RPC_DEBUG === "true";
const MAX_CONCURRENCY = 2;
const BALANCE_RETRIES = 2;
const BALANCE_RETRY_DELAY_MS = 300;
const MEMBER_JOIN_BATCH_SIZE = 100;
const MEMBER_JOIN_PAGE_SIZE = 1000;
const MEMBER_JOIN_BLOCK_CONCURRENCY = 3;
const DEFAULT_SUBGRAPH_ENDPOINT = "https://gateway.thegraph.com/api";
const rpcDebugInfo = (() => {
  try {
    const u = new URL(BASE_RPC_URL || "");
    const parts = u.pathname.split("/").filter(Boolean);
    const token = parts[parts.length - 1] || "";
    return {
      host: u.host,
      protocol: u.protocol.replace(":", ""),
      pathDepth: parts.length,
      keyLength: token.length || undefined,
      keyPreview: token.length >= 8 ? `${token.slice(0, 4)}...${token.slice(-4)}` : token || undefined,
    };
  } catch {
    return { invalidUrl: true };
  }
})();
if (LOG_RPC_DEBUG && typeof window === "undefined") {
  console.info("[RPC DEBUG] Admin roster provider init", { networkId: BASE_NETWORK_ID, rpc: rpcDebugInfo });
}

async function scanUsers(): Promise<RawUser[]> {
  const items: RawUser[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await documentClient.scan({
      TableName: TABLE_NAME,
      FilterExpression: "#type = :user",
      ProjectionExpression: "id, #name, email, firstName, lastName, wallets, walletAddress, isAdmin, isTestMember, welcomeEmailSentAt, lastEmailSentAt, lastEmailType, emailBounceReason, emailSuppressed",
      ExpressionAttributeNames: { "#type": "type", "#name": "name" },
      ExpressionAttributeValues: { ":user": "USER" },
      ExclusiveStartKey,
    });
    if (res.Items) {
      for (const item of res.Items) {
        items.push(item as RawUser);
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);
  return items;
}

function normalizeWallets(wallets: any): string[] {
  if (!Array.isArray(wallets)) return [];
  return Array.from(
    new Set(
      wallets
        .map((addr) => (typeof addr === "string" ? addr.trim().toLowerCase() : ""))
        .filter((addr) => addr.length === 42 && addr.startsWith("0x")),
    ),
  );
}

function normalizeWallet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length !== 42 || !trimmed.startsWith("0x")) return null;
  return trimmed;
}

function buildSubgraphUrl(): string | null {
  if (UNLOCK_SUBGRAPH_URL?.trim()) {
    return UNLOCK_SUBGRAPH_URL.trim();
  }
  if (UNLOCK_SUBGRAPH_API_KEY?.trim() && UNLOCK_SUBGRAPH_ID?.trim()) {
    return `${DEFAULT_SUBGRAPH_ENDPOINT}/${UNLOCK_SUBGRAPH_API_KEY.trim()}/subgraphs/id/${UNLOCK_SUBGRAPH_ID.trim()}`;
  }
  return null;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function resolveBlockTimestamp(blockNumber: number): Promise<number | null> {
  if (!Number.isFinite(blockNumber) || blockNumber <= 0) return null;
  const cached = blockTimestampCache.get(blockNumber);
  if (typeof cached === "number") return cached;
  try {
    const block = await provider.getBlock(blockNumber);
    const timestamp = typeof block?.timestamp === "number" ? block.timestamp : null;
    if (typeof timestamp === "number") {
      blockTimestampCache.set(blockNumber, timestamp);
      return timestamp;
    }
  } catch (err) {
    if (LOG_RPC_DEBUG) {
      console.warn("Admin roster: failed to resolve block timestamp", blockNumber, err);
    }
  }
  return null;
}

async function fetchMemberJoinBlocks(lockAddress: string, owners: string[]): Promise<Record<string, number>> {
  const endpoint = buildSubgraphUrl();
  if (!endpoint || !owners.length) return {};
  const normalizedOwners = Array.from(
    new Set(
      owners
        .map((addr) => (typeof addr === "string" ? addr.trim().toLowerCase() : ""))
        .filter((addr) => addr.length === 42 && addr.startsWith("0x")),
    ),
  );
  if (!normalizedOwners.length) return {};
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (UNLOCK_SUBGRAPH_API_KEY?.trim()) {
    headers["x-api-key"] = UNLOCK_SUBGRAPH_API_KEY.trim();
    headers["authorization"] = `Bearer ${UNLOCK_SUBGRAPH_API_KEY.trim()}`;
  }

  const ownerBlocks: Record<string, number> = {};
  const ownerChunks = chunkArray(normalizedOwners, MEMBER_JOIN_BATCH_SIZE);
  for (const chunk of ownerChunks) {
    let skip = 0;
    while (true) {
      const payload = {
        query: `
          query MemberJoinBlocks($lock: String!, $owners: [String!], $first: Int!, $skip: Int!) {
            keys(first: $first, skip: $skip, where: { lock: $lock, owner_in: $owners }) {
              owner
              createdAtBlock
            }
          }
        `,
        variables: {
          lock: lockAddress.toLowerCase(),
          owners: chunk,
          first: MEMBER_JOIN_PAGE_SIZE,
          skip,
        },
      };

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`Subgraph responded with ${res.status}`);
        }
        const body = await res.json();
        if (Array.isArray(body?.errors) && body.errors.length) {
          throw new Error(body.errors[0]?.message || "Subgraph error");
        }
        const rows: any[] = Array.isArray(body?.data?.keys) ? body.data.keys : [];
        if (!rows.length) break;
        for (const row of rows) {
          const owner = typeof row?.owner === "string" ? row.owner.toLowerCase() : null;
          if (!owner) continue;
          const rawBlock = row?.createdAtBlock;
          const blockNum = typeof rawBlock === "number" ? rawBlock : Number(rawBlock);
          if (!Number.isFinite(blockNum) || blockNum <= 0) continue;
          const current = ownerBlocks[owner];
          if (typeof current !== "number" || blockNum < current) {
            ownerBlocks[owner] = blockNum;
          }
        }
        if (rows.length < MEMBER_JOIN_PAGE_SIZE) break;
        skip += rows.length;
      } catch (err) {
        if (LOG_RPC_DEBUG) {
          console.warn("Admin roster: member join subgraph fetch failed", err);
        }
        break;
      }
    }
  }

  return ownerBlocks;
}

async function fetchMemberJoinDates(lockAddress: string, owners: string[]): Promise<Record<string, number>> {
  const ownerBlocks = await fetchMemberJoinBlocks(lockAddress, owners);
  const blockNumbers = Array.from(new Set(Object.values(ownerBlocks)));
  if (!blockNumbers.length) return {};

  await mapWithLimit(blockNumbers, MEMBER_JOIN_BLOCK_CONCURRENCY, async (blockNumber) => {
    await resolveBlockTimestamp(blockNumber);
    return blockNumber;
  });

  const result: Record<string, number> = {};
  for (const [owner, blockNumber] of Object.entries(ownerBlocks)) {
    const timestamp = blockTimestampCache.get(blockNumber);
    if (typeof timestamp === "number") {
      result[owner] = timestamp;
    }
  }
  return result;
}

function resolveMemberSince(addresses: string[], memberSinceByWallet?: Record<string, number | null>): number | null {
  if (!memberSinceByWallet || !addresses.length) return null;
  let earliest: number | null = null;
  for (const addr of addresses) {
    const normalized = normalizeWallet(addr);
    if (!normalized) continue;
    const value = memberSinceByWallet[normalized];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    if (earliest == null || value < earliest) {
      earliest = value;
    }
  }
  return earliest;
}

async function fetchBalances(address: string | null): Promise<{ ethBalance: string | null; usdcBalance: string | null }> {
  if (!address) return { ethBalance: null, usdcBalance: null };
  const key = address.toLowerCase();
  const cached = balanceCache.get(key);
  if (cached) return cached;

  const shouldRetry = (err: any) => {
    const code = err?.code ?? err?.statusCode ?? err?.error?.code;
    if (code === 429 || code === 503) return true;
    const msg = typeof err?.message === "string" ? err.message.toLowerCase() : "";
    return msg.includes("compute units per second") || msg.includes("rate limit") || msg.includes("throttle");
  };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const withRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    let attempt = 0;
    let lastErr: any;
    while (attempt <= BALANCE_RETRIES) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt >= BALANCE_RETRIES || !shouldRetry(err)) break;
        await sleep(BALANCE_RETRY_DELAY_MS * (attempt + 1));
      }
      attempt += 1;
    }
    throw lastErr;
  };

  let ethBalance: string | null = null;
  let usdcBalance: string | null = null;
  try {
    const wei = await withRetry(() => provider.getBalance(address));
    ethBalance = formatUnits(wei, 18);
  } catch (err) {
    if (LOG_RPC_DEBUG) {
      console.warn("Admin roster: failed to fetch ETH balance", address, err);
    }
  }
  if (usdcContract) {
    try {
      const bal = await withRetry(() => usdcContract.balanceOf(address));
      usdcBalance = formatUnits(bal, 6);
    } catch (err) {
      if (LOG_RPC_DEBUG) {
        console.warn("Admin roster: failed to fetch USDC balance", address, err);
      }
    }
  }
  const result = { ethBalance, usdcBalance };
  balanceCache.set(key, result);
  return result;
}

async function mapWithLimit<T, U>(items: T[], limit: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let index = 0;
  let active = 0;

  return new Promise((resolve, reject) => {
    const next = () => {
      if (index >= items.length && active === 0) {
        resolve(results);
        return;
      }
      while (active < limit && index < items.length) {
        const current = index++;
        active++;
        fn(items[current])
          .then((value) => {
            results[current] = value;
          })
          .catch(reject)
          .finally(() => {
            active--;
            next();
          });
      }
    };
    next();
  });
}

function deriveAutoRenew(allowances: Record<string, AllowanceState>, highestTierId: string | null): boolean | null {
  if (!highestTierId) return null;
  const tier = MEMBERSHIP_TIERS.find((entry) => entry.id === highestTierId || entry.address === highestTierId);
  if (!tier) return null;
  const key = tier.checksumAddress.toLowerCase();
  const allowance = allowances[key];
  if (!allowance) return false;
  if (allowance.isUnlimited) return true;
  try {
    const approved = BigInt(allowance.amount || "0");
    const price = allowance.keyPrice ? BigInt(allowance.keyPrice) : null;
    if (price && approved >= price) return true;
    return approved > 0n;
  } catch {
    return false;
  }
}

async function buildAdminMemberEntry(user: RawUser, options: BuildAdminRosterOptions): Promise<AdminMember | null> {
  if (!user.id) return null;
  const includeAllowances = options.includeAllowances !== false;
  const includeBalances = options.includeBalances !== false;
  const includeTokenIds = options.includeTokenIds !== false;

  const wallets = normalizeWallets(user.wallets);
  const primaryWallet = user.walletAddress?.toLowerCase?.() || wallets[0] || null;
  const addresses = wallets.length ? wallets : primaryWallet ? [primaryWallet] : [];

  let membershipStatus: AdminMember["membershipStatus"] = "none";
  let membershipExpiry: number | null = null;
  let highestActiveTierId: string | null = null;
  let highestActiveTierLabel: string | null = null;
  let highestActiveTierExpiry: number | null = null;
  let highestActiveTierLock: string | null = null;
  let highestActiveTierTokenId: string | null = null;
  let nextActiveTierId: string | null = null;
  let nextActiveTierLabel: string | null = null;
  let nextActiveTierExpiry: number | null = null;
  let autoRenew: boolean | null = null;
  let allowances: Record<string, AllowanceState> = {};
  let membershipCheckedAt: number | null = null;
  let memberSince: number | null = null;

  if (addresses.length) {
    try {
      const snapshot = await membershipStateService.getState({
        addresses,
        forceRefresh: true,
        includeAllowances,
        includeTokenIds,
      });
      membershipCheckedAt = snapshot.fetchedAt;
      const { summary, allowances: allowanceMap } = snapshotToMembershipSummary(snapshot);
      allowances = includeAllowances ? allowanceMap : {};
      membershipStatus = summary.status ?? "none";
      const highest = pickHighestActiveTier(summary);
      const next = pickNextActiveTier(summary);
      membershipExpiry = highest?.expiry ?? summary.expiry ?? null;
      highestActiveTierId = highest?.tier?.id ?? summary.highestActiveTier?.tier?.id ?? null;
      highestActiveTierLabel = resolveTierLabel(highest || summary.highestActiveTier, highestActiveTierId);
      highestActiveTierExpiry = highest?.expiry ?? null;
      highestActiveTierLock = highest?.tier?.checksumAddress ?? summary.highestActiveTier?.tier?.checksumAddress ?? null;
      highestActiveTierTokenId = Array.isArray(highest?.tokenIds) && highest?.tokenIds.length ? highest.tokenIds[0] : null;
      nextActiveTierId = next?.tier?.id ?? null;
      nextActiveTierLabel = resolveTierLabel(next, nextActiveTierId);
      nextActiveTierExpiry = next?.expiry ?? null;
      autoRenew = includeAllowances ? deriveAutoRenew(allowances, highestActiveTierId) : null;
    } catch (err) {
      console.error("Admin roster: failed to build membership summary for user", user.id, err);
      membershipStatus = "unknown";
      allowances = {};
    }
  }

  const joinAddresses = Array.from(new Set([...(wallets || []), ...(primaryWallet ? [primaryWallet] : [])]));
  memberSince = resolveMemberSince(joinAddresses, options.memberSinceByWallet);

  if (options.statusFilter && options.statusFilter !== "all" && membershipStatus !== options.statusFilter) {
    return null;
  }

  const balances = includeBalances ? await fetchBalances(primaryWallet) : { ethBalance: null, usdcBalance: null };

  return {
    id: user.id,
    name: user.name || null,
    email: user.email || null,
    firstName: user.firstName || null,
    lastName: user.lastName || null,
    wallets,
    primaryWallet,
    membershipStatus,
    membershipExpiry,
    highestActiveTierId,
    highestActiveTierLabel,
    highestActiveTierExpiry,
    highestActiveTierLock,
    highestActiveTierTokenId,
    nextActiveTierId,
    nextActiveTierLabel,
    nextActiveTierExpiry,
    autoRenew,
    allowances,
    ethBalance: balances.ethBalance,
    usdcBalance: balances.usdcBalance,
    isAdmin: !!user.isAdmin,
    welcomeEmailSentAt: user.welcomeEmailSentAt || null,
    lastEmailSentAt: user.lastEmailSentAt || null,
    lastEmailType: user.lastEmailType || null,
    emailBounceReason: user.emailBounceReason || null,
    emailSuppressed: typeof user.emailSuppressed === "boolean" ? !!user.emailSuppressed : null,
    membershipCheckedAt,
    memberSince,
    isTestMember: typeof user.isTestMember === "boolean" ? user.isTestMember : false,
  };
}

async function buildAdminRosterFresh(options: BuildAdminRosterOptions = {}): Promise<AdminRoster> {
  const users = await scanUsers();
  const memberTier =
    MEMBERSHIP_TIERS.find((tier) => tier.neverExpires || tier.renewable === false) ||
    MEMBERSHIP_TIERS[MEMBERSHIP_TIERS.length - 1];
  let memberSinceByWallet: Record<string, number | null> = {};
  if (memberTier) {
    const addressSet = new Set<string>();
    for (const user of users) {
      normalizeWallets(user.wallets).forEach((addr) => addressSet.add(addr));
      const primary = normalizeWallet(user.walletAddress);
      if (primary) addressSet.add(primary);
    }
    if (addressSet.size) {
      memberSinceByWallet = await fetchMemberJoinDates(memberTier.checksumAddress, Array.from(addressSet));
    }
  }

  const entries = await mapWithLimit(users, MAX_CONCURRENCY, (user) =>
    buildAdminMemberEntry(user, { ...options, memberSinceByWallet }),
  );
  const members: AdminMember[] = entries.filter((m): m is AdminMember => !!m);

  const nowSec = Math.floor(Date.now() / 1000);
  const statusRank = (status: AdminMember["membershipStatus"]) => {
    switch (status) {
      case "active":
        return 0;
      case "expired":
        return 1;
      case "none":
        return 2;
      default:
        return 3;
    }
  };

  members.sort((a, b) => {
    const byStatus = statusRank(a.membershipStatus) - statusRank(b.membershipStatus);
    if (byStatus !== 0) return byStatus;
    const expiryA = a.membershipExpiry || 0;
    const expiryB = b.membershipExpiry || 0;
    if (expiryA !== expiryB) return expiryA - expiryB;
    return (a.name || a.email || "").localeCompare(b.name || b.email || "");
  });

  const meta = {
    total: members.length,
    active: members.filter((m) => m.membershipStatus === "active").length,
    expired: members.filter((m) => m.membershipStatus === "expired").length,
    none: members.filter((m) => m.membershipStatus === "none").length,
    autoRenewOn: members.filter((m) => m.autoRenew === true).length,
    autoRenewOff: members.filter((m) => m.autoRenew === false).length,
    expiringSoon: members.filter((m) => typeof m.membershipExpiry === "number" && m.membershipExpiry > nowSec && m.membershipExpiry < nowSec + 30 * 24 * 60 * 60).length,
  };

  return { members, meta };
}

const emptyRosterMeta = {
  total: 0,
  active: 0,
  expired: 0,
  none: 0,
  autoRenewOn: 0,
  autoRenewOff: 0,
  expiringSoon: 0,
};

const buildEmptyRoster = (cache?: AdminRosterCacheStatus): AdminRoster => ({
  members: [],
  meta: { ...emptyRosterMeta },
  ...(cache ? { cache } : {}),
});

export async function buildAdminRoster(options: BuildAdminRosterOptions = {}): Promise<AdminRoster> {
  const includeAllowances = options.includeAllowances !== false;
  const includeBalances = options.includeBalances !== false;
  const includeTokenIds = options.includeTokenIds !== false;
  const statusFilter = options.statusFilter || "all";
  const preferStale = !!options.preferStale;
  const triggerRebuild = !!options.triggerRebuild;
  const forceRebuild = !!options.forceRebuild;
  const shouldTriggerRebuild = triggerRebuild || forceRebuild;

  const cacheEligible = !includeAllowances && !includeBalances && !includeTokenIds && statusFilter === "all";
  const cacheConfig = getRosterCacheConfig();
  const baseCacheStatus: AdminRosterCacheStatus = {
    enabled: cacheConfig.enabled,
    mode: cacheConfig.mode,
    computedAt: null,
    expiresAt: null,
    isFresh: false,
    isStale: false,
    isWithinMaxStale: false,
    rebuildTriggered: false,
    rebuildBlocking: false,
    missing: false,
    lockActive: false,
    lockExpiresAt: null,
  };

  if (cacheEligible && cacheConfig.enabled && !options.forceRefresh) {
    const cached = await loadRosterCache(cacheConfig);
    if (cached) {
      const cacheStatus: AdminRosterCacheStatus = {
        ...baseCacheStatus,
        computedAt: cached.computedAt,
        expiresAt: cached.expiresAt,
        isFresh: cached.isFresh,
        isStale: !cached.isFresh,
        isWithinMaxStale: cached.isWithinMaxStale,
      };
      if (cached.isFresh) {
        if (shouldTriggerRebuild) {
          void rebuildRosterCache(cacheConfig, () => buildAdminRosterFresh(options));
          return {
            ...cached.roster,
            cache: {
              ...cacheStatus,
              rebuildTriggered: true,
              rebuildBlocking: false,
            },
          };
        }
        return { ...cached.roster, cache: cacheStatus };
      }
      if (preferStale) {
        if (shouldTriggerRebuild) {
          void rebuildRosterCache(cacheConfig, () => buildAdminRosterFresh(options));
        }
        return {
          ...cached.roster,
          cache: {
            ...cacheStatus,
            rebuildTriggered: shouldTriggerRebuild,
            rebuildBlocking: false,
          },
        };
      }
      if (cacheConfig.mode === "stale-while-revalidate" && cached.isWithinMaxStale) {
        void rebuildRosterCache(cacheConfig, () => buildAdminRosterFresh(options));
        return { ...cached.roster, cache: { ...cacheStatus, rebuildTriggered: true, rebuildBlocking: false } };
      }
    } else if (preferStale) {
      if (shouldTriggerRebuild) {
        void rebuildRosterCache(cacheConfig, () => buildAdminRosterFresh(options));
      }
      return buildEmptyRoster({
        ...baseCacheStatus,
        missing: true,
        rebuildTriggered: shouldTriggerRebuild,
        rebuildBlocking: false,
      });
    }
  }

  if (cacheEligible && cacheConfig.enabled) {
    const rebuilt = await rebuildRosterCache(cacheConfig, () => buildAdminRosterFresh(options));
    if (rebuilt.cached) {
      const computedAt = rebuilt.computedAt ?? Date.now();
      const cacheStatus: AdminRosterCacheStatus = {
        ...baseCacheStatus,
        computedAt,
        expiresAt: computedAt + cacheConfig.ttlSeconds * 1000,
        isFresh: true,
        isStale: false,
        isWithinMaxStale: true,
        rebuildTriggered: true,
        rebuildBlocking: true,
      };
      return { ...rebuilt.roster, cache: cacheStatus };
    }
    const cacheStatus: AdminRosterCacheStatus = {
      ...baseCacheStatus,
      rebuildBlocking: true,
    };
    return { ...rebuilt.roster, cache: cacheStatus };
  }

  return buildAdminRosterFresh(options);
}

export async function buildAdminMembersByIds(userIds: string[], options: BuildAdminRosterOptions = {}): Promise<AdminMember[]> {
  const ids = Array.from(
    new Set(
      (userIds || [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0),
    ),
  );
  if (!ids.length) return [];

  const users: RawUser[] = [];
  for (const id of ids) {
    const res = await documentClient.get({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${id}`, sk: `USER#${id}` },
    });
    if (res.Item) {
      users.push(res.Item as RawUser);
    }
  }

  const entries = await mapWithLimit(users, MAX_CONCURRENCY, (user) => buildAdminMemberEntry(user, options));
  return entries.filter((m): m is AdminMember => !!m);
}
