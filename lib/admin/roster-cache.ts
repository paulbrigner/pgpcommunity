import crypto from "crypto";
import { documentClient } from "@/lib/dynamodb";
import { MEMBERSHIP_TIERS } from "@/lib/config";
import type { AdminRoster } from "@/lib/admin/roster";

type CacheMode = "off" | "read-through" | "stale-while-revalidate";

type RosterCacheConfig = {
  enabled: boolean;
  mode: CacheMode;
  tableName: string | null;
  ttlSeconds: number;
  maxStaleSeconds: number;
  pageSize: number;
  tiersHash: string;
};

export type AdminRosterCacheStatus = {
  enabled: boolean;
  mode: "off" | "read-through" | "stale-while-revalidate";
  computedAt: number | null;
  expiresAt: number | null;
  isFresh: boolean;
  isStale: boolean;
  isWithinMaxStale: boolean;
  rebuildTriggered: boolean;
  rebuildBlocking: boolean;
  missing: boolean;
  lockActive: boolean;
  lockExpiresAt: number | null;
};

type CacheMetaItem = {
  pk: string;
  sk: string;
  type: "ADMIN_ROSTER_CACHE";
  version: number;
  computedAt: number;
  expiresAt: number;
  expiresAtEpochSec: number;
  pageCount: number;
  pageSize: number;
  totalMembers: number;
  tiersHash: string;
  rosterMeta?: AdminRoster["meta"];
};

type CachePageItem = {
  pk: string;
  sk: string;
  type: "ADMIN_ROSTER_CACHE_PAGE";
  pageIndex: number;
  members: AdminRoster["members"];
};

type LoadedRosterCache = {
  roster: AdminRoster;
  isFresh: boolean;
  isWithinMaxStale: boolean;
  computedAt: number;
  expiresAt: number;
};

const CACHE_VERSION = 1;
const CACHE_PK = "ADMIN_ROSTER_CACHE";
const CACHE_SK_META = "META";
const CACHE_SK_LOCK = "LOCK";
const CACHE_SK_PAGE_PREFIX = "PAGE#";
const DEFAULT_TTL_SECONDS = 600;
const DEFAULT_MAX_STALE_SECONDS = 3600;
const DEFAULT_PAGE_SIZE = 100;
const LOCK_TTL_MS = 5 * 60 * 1000;

const buildBaseCacheStatus = (config: RosterCacheConfig): AdminRosterCacheStatus => ({
  enabled: config.enabled,
  mode: config.mode,
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
});

const normalizeMode = (value: string | undefined): CacheMode => {
  if (!value) return "off";
  const normalized = value.trim().toLowerCase();
  if (normalized === "read-through" || normalized === "readthrough" || normalized === "read_through") {
    return "read-through";
  }
  if (normalized === "stale-while-revalidate" || normalized === "stale" || normalized === "swr") {
    return "stale-while-revalidate";
  }
  return "off";
};

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const computeTiersHash = (): string => {
  const payload = MEMBERSHIP_TIERS.map((tier) => ({
    id: tier.id,
    address: tier.checksumAddress.toLowerCase(),
    order: tier.order,
    renewable: tier.renewable ?? null,
    gasSponsored: tier.gasSponsored ?? null,
    neverExpires: tier.neverExpires ?? null,
  })).sort((a, b) => (a.order !== b.order ? a.order - b.order : a.address.localeCompare(b.address)));
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
};

export const getRosterCacheConfig = (): RosterCacheConfig => {
  const tableNameRaw = process.env.ADMIN_ROSTER_CACHE_TABLE || "";
  const tableName = tableNameRaw.trim().length ? tableNameRaw.trim() : null;
  const mode = normalizeMode(process.env.ADMIN_ROSTER_CACHE_MODE);
  const ttlSeconds = parsePositiveInt(process.env.ADMIN_ROSTER_CACHE_TTL_SECONDS) ?? DEFAULT_TTL_SECONDS;
  const maxStaleSeconds = parsePositiveInt(process.env.ADMIN_ROSTER_CACHE_MAX_STALE_SECONDS) ?? DEFAULT_MAX_STALE_SECONDS;
  const pageSize = parsePositiveInt(process.env.ADMIN_ROSTER_CACHE_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE;
  const tiersHash = computeTiersHash();
  const enabled = !!tableName && mode !== "off";

  return {
    enabled,
    mode,
    tableName,
    ttlSeconds,
    maxStaleSeconds: Math.max(maxStaleSeconds, ttlSeconds),
    pageSize,
    tiersHash,
  };
};

const buildPageKey = (index: number) => `${CACHE_SK_PAGE_PREFIX}${String(index).padStart(4, "0")}`;

const chunkMembers = (members: AdminRoster["members"], pageSize: number): AdminRoster["members"][] => {
  if (pageSize <= 0) return [members];
  const pages: AdminRoster["members"][] = [];
  for (let i = 0; i < members.length; i += pageSize) {
    pages.push(members.slice(i, i + pageSize));
  }
  return pages.length ? pages : [[]];
};

const isCacheMetaValid = (meta: CacheMetaItem | undefined, config: RosterCacheConfig): meta is CacheMetaItem => {
  if (!meta) return false;
  if (meta.type !== "ADMIN_ROSTER_CACHE") return false;
  if (meta.version !== CACHE_VERSION) return false;
  if (meta.tiersHash !== config.tiersHash) return false;
  if (!Number.isFinite(meta.pageCount) || meta.pageCount < 1) return false;
  if (!Number.isFinite(meta.computedAt) || meta.computedAt <= 0) return false;
  if (!Number.isFinite(meta.expiresAt) || meta.expiresAt <= 0) return false;
  if (meta.pageSize !== config.pageSize) return false;
  return true;
};

export async function loadRosterCache(config: RosterCacheConfig): Promise<LoadedRosterCache | null> {
  if (!config.enabled || !config.tableName) return null;
  const metaRes = await documentClient.get({
    TableName: config.tableName,
    Key: { pk: CACHE_PK, sk: CACHE_SK_META },
  });
  const meta = metaRes.Item as CacheMetaItem | undefined;
  if (!isCacheMetaValid(meta, config)) return null;

  const pages: CachePageItem[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const res = await documentClient.query({
      TableName: config.tableName,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": CACHE_PK, ":prefix": CACHE_SK_PAGE_PREFIX },
      ExclusiveStartKey: lastKey,
    });
    if (res.Items) {
      for (const item of res.Items) {
        pages.push(item as CachePageItem);
      }
    }
    lastKey = res.LastEvaluatedKey as any;
  } while (lastKey);

  if (pages.length !== meta.pageCount) return null;
  pages.sort((a, b) => (a.pageIndex || 0) - (b.pageIndex || 0));
  const members = pages.flatMap((page) => (Array.isArray(page.members) ? page.members : []));

  const now = Date.now();
  const isFresh = meta.expiresAt > now;
  const maxStaleMs = config.maxStaleSeconds * 1000;
  const isWithinMaxStale = now - meta.computedAt <= maxStaleMs;
  const rosterMeta = meta.rosterMeta || {
    total: members.length,
    active: members.filter((m) => m.membershipStatus === "active").length,
    expired: members.filter((m) => m.membershipStatus === "expired").length,
    none: members.filter((m) => m.membershipStatus === "none").length,
    autoRenewOn: members.filter((m) => m.autoRenew === true).length,
    autoRenewOff: members.filter((m) => m.autoRenew === false).length,
    expiringSoon: members.filter(
      (m) =>
        typeof m.membershipExpiry === "number" &&
        m.membershipExpiry > Math.floor(now / 1000) &&
        m.membershipExpiry < Math.floor(now / 1000) + 30 * 24 * 60 * 60,
    ).length,
  };

  return {
    roster: { members, meta: rosterMeta },
    isFresh,
    isWithinMaxStale,
    computedAt: meta.computedAt,
    expiresAt: meta.expiresAt,
  };
}

export async function loadRosterCacheStatus(config: RosterCacheConfig): Promise<AdminRosterCacheStatus> {
  const base = buildBaseCacheStatus(config);
  if (!config.enabled || !config.tableName) return base;

  const tableName = config.tableName;
  const [metaRes, lockRes] = await Promise.all([
    documentClient.get({ TableName: tableName, Key: { pk: CACHE_PK, sk: CACHE_SK_META } }),
    documentClient.get({ TableName: tableName, Key: { pk: CACHE_PK, sk: CACHE_SK_LOCK } }),
  ]);

  const now = Date.now();
  const lockItem = lockRes.Item as { expiresAt?: number } | undefined;
  const lockActive = typeof lockItem?.expiresAt === "number" && lockItem.expiresAt > now;
  const lockExpiresAt = lockActive ? lockItem?.expiresAt ?? null : null;

  const meta = metaRes.Item as CacheMetaItem | undefined;
  if (!isCacheMetaValid(meta, config)) {
    return {
      ...base,
      missing: true,
      lockActive,
      lockExpiresAt,
    };
  }

  const isFresh = meta.expiresAt > now;
  const maxStaleMs = config.maxStaleSeconds * 1000;
  const isWithinMaxStale = now - meta.computedAt <= maxStaleMs;

  return {
    ...base,
    computedAt: meta.computedAt,
    expiresAt: meta.expiresAt,
    isFresh,
    isStale: !isFresh,
    isWithinMaxStale,
    missing: false,
    lockActive,
    lockExpiresAt,
  };
}

const acquireRosterCacheLock = async (config: RosterCacheConfig): Promise<string | null> => {
  if (!config.tableName) return null;
  const lockId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + LOCK_TTL_MS;
  try {
    await documentClient.update({
      TableName: config.tableName,
      Key: { pk: CACHE_PK, sk: CACHE_SK_LOCK },
      UpdateExpression: "SET #type = :type, lockId = :lockId, expiresAt = :expiresAt",
      ConditionExpression: "attribute_not_exists(lockId) OR expiresAt < :now",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: {
        ":type": "ADMIN_ROSTER_CACHE_LOCK",
        ":lockId": lockId,
        ":expiresAt": expiresAt,
        ":now": now,
      },
    });
    return lockId;
  } catch {
    return null;
  }
};

const releaseRosterCacheLock = async (config: RosterCacheConfig, lockId: string) => {
  if (!config.tableName || !lockId) return;
  try {
    await documentClient.delete({
      TableName: config.tableName,
      Key: { pk: CACHE_PK, sk: CACHE_SK_LOCK },
      ConditionExpression: "lockId = :lockId",
      ExpressionAttributeValues: { ":lockId": lockId },
    });
  } catch {
    // best-effort lock release
  }
};

const writeRosterPages = async (config: RosterCacheConfig, pages: AdminRoster["members"][]) => {
  const tableName = config.tableName;
  if (!tableName) return;
  const batches: Array<{ RequestItems: Record<string, any[]> }> = [];
  let current: any[] = [];
  pages.forEach((members, index) => {
    const item: CachePageItem = {
      pk: CACHE_PK,
      sk: buildPageKey(index + 1),
      type: "ADMIN_ROSTER_CACHE_PAGE",
      pageIndex: index + 1,
      members,
    };
    current.push({ PutRequest: { Item: item } });
    if (current.length === 25) {
      batches.push({ RequestItems: { [tableName]: current } });
      current = [];
    }
  });
  if (current.length) {
    batches.push({ RequestItems: { [tableName]: current } });
  }

  for (const batch of batches) {
    await documentClient.batchWrite(batch);
  }
};

const deleteExtraPages = async (config: RosterCacheConfig, previousCount: number, nextCount: number) => {
  const tableName = config.tableName;
  if (!tableName || previousCount <= nextCount) return;
  const deletes: any[] = [];
  for (let i = nextCount + 1; i <= previousCount; i += 1) {
    deletes.push({ DeleteRequest: { Key: { pk: CACHE_PK, sk: buildPageKey(i) } } });
  }
  for (let i = 0; i < deletes.length; i += 25) {
    const batch = deletes.slice(i, i + 25);
    await documentClient.batchWrite({ RequestItems: { [tableName]: batch } });
  }
};

export async function saveRosterCache(config: RosterCacheConfig, roster: AdminRoster, computedAt: number) {
  const tableName = config.tableName;
  if (!config.enabled || !tableName) return;

  const pages = chunkMembers(roster.members, config.pageSize);
  const pageCount = pages.length;
  const expiresAt = computedAt + config.ttlSeconds * 1000;

  const metaRes = await documentClient.get({
    TableName: tableName,
    Key: { pk: CACHE_PK, sk: CACHE_SK_META },
  });
  const previousPageCount = (metaRes.Item as CacheMetaItem | undefined)?.pageCount ?? 0;

  await writeRosterPages(config, pages);

  const metaItem: CacheMetaItem = {
    pk: CACHE_PK,
    sk: CACHE_SK_META,
    type: "ADMIN_ROSTER_CACHE",
    version: CACHE_VERSION,
    computedAt,
    expiresAt,
    expiresAtEpochSec: Math.floor(expiresAt / 1000),
    pageCount,
    pageSize: config.pageSize,
    totalMembers: roster.members.length,
    tiersHash: config.tiersHash,
    rosterMeta: roster.meta,
  };
  await documentClient.put({
    TableName: tableName,
    Item: metaItem,
  });

  await deleteExtraPages(config, previousPageCount, pageCount);
}

export async function rebuildRosterCache(
  config: RosterCacheConfig,
  build: () => Promise<AdminRoster>,
): Promise<{ roster: AdminRoster; computedAt: number | null; cached: boolean }> {
  if (!config.enabled || !config.tableName) {
    return { roster: await build(), computedAt: null, cached: false };
  }
  const lockId = await acquireRosterCacheLock(config);
  if (!lockId) {
    return { roster: await build(), computedAt: null, cached: false };
  }
  try {
    const roster = await build();
    const computedAt = Date.now();
    await saveRosterCache(config, roster, computedAt);
    return { roster, computedAt, cached: true };
  } finally {
    await releaseRosterCacheLock(config, lockId);
  }
}
