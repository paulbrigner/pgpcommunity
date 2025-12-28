import { NextRequest, NextResponse } from 'next/server';
import {
  PRIMARY_LOCK_ADDRESS,
  BASE_RPC_URL,
  BASE_NETWORK_ID,
  UNLOCK_SUBGRAPH_URL,
  UNLOCK_SUBGRAPH_ID,
  UNLOCK_SUBGRAPH_API_KEY,
  MEMBERSHIP_TIER_ADDRESSES,
} from '@/lib/config';
import unlockNetworks from '@unlock-protocol/networks';
import { Contract } from 'ethers';
import { getRpcProvider } from '@/lib/rpc/provider';
import { getEventMetadata } from '@/lib/events/metadata-store';
import { fetchRelevantEventLocks } from '@/lib/events/discovery';

const ALCHEMY_API_KEY = (() => {
  try {
    const url = new URL(BASE_RPC_URL);
    const parts = url.pathname.split('/').filter(Boolean);
    const key = parts[1];
    return key || null;
  } catch {
    return null;
  }
})();

const ALCHEMY_NFT_BASE = ALCHEMY_API_KEY
  ? `https://base-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}`
  : null;

const lockAddress = (PRIMARY_LOCK_ADDRESS || '').toLowerCase();

let cachedLockDeployer: string | null = null;
let cachedLockOwner: string | null = null;

const provider = BASE_RPC_URL ? getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID) : null;

const normalizeImageUrl = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('ipfs://')) {
    const path = trimmed.slice('ipfs://'.length);
    return `https://cloudflare-ipfs.com/ipfs/${path}`;
  }
  return trimmed;
};

const getAttributeValue = (attributes: Array<any>, candidates: string[]): string | null => {
  const lowered = candidates.map((c) => c.toLowerCase());
  for (const attr of attributes) {
    const trait = (attr?.trait_type || attr?.traitType || attr?.type || attr?.name || '').toLowerCase();
    if (trait && lowered.includes(trait)) {
      const val = attr?.value || attr?.display_value || attr?.displayValue;
      if (typeof val === 'string' && val.trim().length) {
        return val.trim();
      }
    }
  }
  return null;
};

async function getLockOwner(): Promise<string | null> {
  if (cachedLockOwner) return cachedLockOwner;
  if (!provider || !lockAddress) return null;
  try {
    const contract = new Contract(
      lockAddress,
      ['function owner() view returns (address)'],
      provider
    );
    const owner: string = await contract.owner();
    cachedLockOwner = owner ? owner.toLowerCase() : null;
    return cachedLockOwner;
  } catch (err) {
    console.error('Failed to load lock owner', err);
    return null;
  }
}

const lockNameCache = new Map<string, string | null>();
const lockCreationCache = new Map<string, number | null>();
const legacyEventTimestampCache = new Map<string, number | null>();

async function getLockName(address: string): Promise<string | null> {
  const key = address.toLowerCase();
  if (lockNameCache.has(key)) {
    return lockNameCache.get(key) ?? null;
  }
  if (!provider) {
    lockNameCache.set(key, null);
    return null;
  }
  try {
    const contract = new Contract(
      key,
      ['function name() view returns (string)'],
      provider
    );
    const name: string = await contract.name();
    const trimmed = typeof name === 'string' ? name.trim() : '';
    const normalized = trimmed.length ? trimmed : null;
    lockNameCache.set(key, normalized);
    return normalized;
  } catch (_err) {
    lockNameCache.set(key, null);
    return null;
  }
}




const NETWORK_ID = BASE_NETWORK_ID;
const NETWORK_CONFIG_COLLECTION = (unlockNetworks as any)?.networks || unlockNetworks;
const RESOLVED_NETWORK_ID = Number.isFinite(NETWORK_ID) && NETWORK_ID > 0 ? NETWORK_ID : BASE_NETWORK_ID;
const NETWORK_CONFIG = NETWORK_CONFIG_COLLECTION?.[String(RESOLVED_NETWORK_ID)] || NETWORK_CONFIG_COLLECTION?.[RESOLVED_NETWORK_ID] || null;

const GRAPH_GATEWAY_BASE = 'https://gateway.thegraph.com/api/subgraphs/id';
const RESOLVED_SUBGRAPH_URL =
  UNLOCK_SUBGRAPH_URL ||
  (UNLOCK_SUBGRAPH_ID ? `${GRAPH_GATEWAY_BASE}/${UNLOCK_SUBGRAPH_ID}` : NETWORK_CONFIG?.subgraph?.endpoint || (RESOLVED_NETWORK_ID ? `https://subgraph.unlock-protocol.com/${RESOLVED_NETWORK_ID}` : null));

const SUBGRAPH_AUTH_HEADERS = UNLOCK_SUBGRAPH_API_KEY
  ? { Authorization: `Bearer ${UNLOCK_SUBGRAPH_API_KEY}` }
  : undefined;

async function fetchSubgraph(body: string) {
  if (!RESOLVED_SUBGRAPH_URL) {
    throw new Error('Unlock subgraph URL not configured');
  }
  return fetch(RESOLVED_SUBGRAPH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SUBGRAPH_AUTH_HEADERS ?? {}),
    },
    body,
    cache: 'no-store',
  });
}

const LOCK_CREATION_FIELD_CANDIDATES = ['createdAtBlock', 'creationBlock', 'createdAt', 'creationTimestamp'] as const;

function coerceToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceToTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

const resolveEventTimestamp = (date: string | null, startTime: string | null, timezone?: string | null): number | null => {
  if (!date) return null;
  const trimmedDate = date.trim();
  if (!trimmedDate) return null;
  const candidates: string[] = [];
  if (startTime && startTime.trim().length) {
    const trimmedTime = startTime.trim();
    if (timezone && timezone.trim().length) {
      candidates.push(`${trimmedDate} ${trimmedTime} ${timezone.trim()}`);
    }
    candidates.push(`${trimmedDate} ${trimmedTime}`);
  }
  candidates.push(trimmedDate);
  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

async function fetchLockCreationField(address: string, field: typeof LOCK_CREATION_FIELD_CANDIDATES[number]): Promise<number | null> {
  const body = JSON.stringify({
    query: `query LockCreation($address: String!) { locks(first: 1, where: { address: $address }) { ${field} } }`,
    variables: { address },
  });
  const res = await fetchSubgraph(body);
  if (!res.ok) {
    throw new Error(`Subgraph request failed (${res.status}) while reading ${field}`);
  }
  const json = await res.json();
  if (json?.errors?.length) {
    throw new Error(json.errors[0]?.message || `Subgraph error requesting ${field}`);
  }
  const value = json?.data?.locks?.[0]?.[field];
  return coerceToNumber(value);
}

async function getLockCreationSortKey(address: string): Promise<number | null> {
  const key = address.toLowerCase();
  if (lockCreationCache.has(key)) {
    return lockCreationCache.get(key) ?? null;
  }

  for (const field of LOCK_CREATION_FIELD_CANDIDATES) {
    try {
      const maybeValue = await fetchLockCreationField(key, field);
      if (maybeValue != null) {
        lockCreationCache.set(key, maybeValue);
        return maybeValue;
      }
    } catch (_err) {
      // Try the next candidate field if this one is unsupported
      continue;
    }
  }

  lockCreationCache.set(key, null);
  return null;
}

type SubgraphKey = {
  tokenId: string;
  lock: {
    address: string;
    deployer?: string | null;
    lockManagers?: string[] | null;
    name?: string | null;
  };
  expiration?: string | null;
  cancelled?: boolean | null;
};

type EventDetails = {
  subtitle: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  location: string | null;
};

function buildAttributeList(metadata: any, attributes: Array<any> = []) {
  const merged: Array<any> = Array.isArray(attributes) ? [...attributes] : [];
  const rawAttributes = metadata?.attributes;
  if (Array.isArray(rawAttributes)) {
    merged.push(...rawAttributes);
  }
  const properties = metadata?.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const [trait, value] of Object.entries(properties as Record<string, unknown>)) {
      const resolved = (value as any)?.value ?? value;
      merged.push({ trait_type: trait, value: resolved });
    }
  }
  return merged;
}

function extractEventDetails(metadata: any, fallbackName: string | null, attributes: Array<any> = []): EventDetails {
  const mergedAttributes = buildAttributeList(metadata, attributes);
  const subtitle = coerceToTrimmedString(
    metadata?.ticket?.event_start_date ||
      metadata?.metadata?.ticket?.event_start_date ||
      metadata?.event_start_date ||
      metadata?.metadata?.event_start_date
  ) || getAttributeValue(mergedAttributes, [
    "event_start_date",
    "event_date",
    "eventDate",
    "date",
  ]) || null;
  const startTime = coerceToTrimmedString(
    metadata?.ticket?.event_start_time ||
      metadata?.metadata?.ticket?.event_start_time ||
      metadata?.event_start_time ||
      metadata?.metadata?.event_start_time
  ) || getAttributeValue(mergedAttributes, [
    "event_start_time",
    "start_time",
    "startTime",
    "time",
  ]) || null;
  const endTime = coerceToTrimmedString(
    metadata?.ticket?.event_end_time ||
      metadata?.metadata?.ticket?.event_end_time ||
      metadata?.event_end_time ||
      metadata?.metadata?.event_end_time
  ) || getAttributeValue(mergedAttributes, [
    "event_end_time",
    "end_time",
    "endTime",
  ]) || null;
  const timezone = coerceToTrimmedString(
    metadata?.ticket?.event_timezone ||
      metadata?.metadata?.ticket?.event_timezone ||
      metadata?.event_timezone ||
      metadata?.metadata?.event_timezone
  ) || getAttributeValue(mergedAttributes, [
    "event_timezone",
    "timezone",
    "time_zone",
  ]) || null;
  const location = coerceToTrimmedString(
    metadata?.ticket?.event_location ||
      metadata?.ticket?.event_address ||
      metadata?.metadata?.ticket?.event_location ||
      metadata?.metadata?.ticket?.event_address ||
      metadata?.event_location ||
      metadata?.event_address
  ) || getAttributeValue(mergedAttributes, [
    "event_location",
    "event_address",
    "location",
    "address",
  ]) || fallbackName || null;

  return { subtitle, startTime, endTime, timezone, location };
}

const toHexTokenId = (tokenId: string): string => {
  try {
    const value = BigInt(tokenId);
    return `0x${value.toString(16)}`;
  } catch {
    return tokenId;
  }
};

async function fetchLegacyEventTimestamp(
  contractAddress: string,
  tokenId: string | null,
  fallbackName: string | null,
): Promise<number | null> {
  const key = contractAddress.toLowerCase();
  if (legacyEventTimestampCache.has(key)) {
    return legacyEventTimestampCache.get(key) ?? null;
  }
  if (!ALCHEMY_NFT_BASE || !tokenId) {
    legacyEventTimestampCache.set(key, null);
    return null;
  }
  try {
    const tokenIdHex = toHexTokenId(tokenId);
    const data = await fetchFromAlchemy<any>("getNFTMetadata", {
      contractAddress: key,
      tokenId: tokenIdHex,
      refreshCache: "false",
    });
    const metadataRoot = data?.rawMetadata ?? data?.metadata ?? data ?? null;
    const attributes = Array.isArray(metadataRoot?.attributes)
      ? metadataRoot.attributes
      : Array.isArray(data?.attributes)
      ? data.attributes
      : [];
    const details = extractEventDetails(metadataRoot, fallbackName, attributes);
    const timestamp = resolveEventTimestamp(details.subtitle, details.startTime, details.timezone);
    legacyEventTimestampCache.set(key, timestamp);
    return timestamp;
  } catch (err) {
    console.warn("Legacy event timestamp fetch failed", contractAddress, err);
    legacyEventTimestampCache.set(key, null);
    return null;
  }
}

async function fetchFromAlchemy<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!ALCHEMY_NFT_BASE) {
    throw new Error('Alchemy NFT API unavailable');
  }
  const search = new URLSearchParams(params);
  const res = await fetch(`${ALCHEMY_NFT_BASE}/${path}?${search.toString()}`, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 0 },
  });
    if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Alchemy request failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as T;
}

async function fetchKeysForOwner(owner: string): Promise<SubgraphKey[]> {
  const results: SubgraphKey[] = [];
  const normalizedOwner = owner.toLowerCase();
  const pageSize = 500;
  let skip = 0;

  while (true) {
    const body = JSON.stringify({
      query: `query Keys($owner: String!, $first: Int!, $skip: Int!) {
        keys(
          first: $first,
          skip: $skip,
          where: { owner: $owner },
          orderBy: expiration,
          orderDirection: desc
        ) {
          tokenId
          expiration
          cancelled
          lock {
            address
            deployer
            lockManagers
            name
          }
        }
      }`,
      variables: { owner: normalizedOwner, first: pageSize, skip },
    });

    const res = await fetchSubgraph(body);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Subgraph request failed (${res.status}): ${detail}`);
    }
    const json = await res.json();
    if (json?.errors?.length) {
      throw new Error(json.errors[0]?.message || 'Subgraph error');
    }
    const page: SubgraphKey[] = Array.isArray(json?.data?.keys) ? json.data.keys : [];
    if (!page.length) {
      break;
    }
    results.push(...page);
    if (page.length < pageSize) {
      break;
    }
    skip += page.length;
  }

  return results;
}

async function fetchSampleTokenForLock(lockAddress: string): Promise<string | null> {
  const body = JSON.stringify({
    query: `query LockSample($address: String!) {
      keys(first: 1, where: { lock: $address }, orderBy: createdAtBlock, orderDirection: desc) {
        tokenId
      }
    }`,
    variables: { address: lockAddress },
  });
  const res = await fetchSubgraph(body);
  if (!res.ok) {
    return null;
  }
  const json = await res.json();
  const tokenId = json?.data?.keys?.[0]?.tokenId;
  return typeof tokenId === 'string' && tokenId.length ? tokenId : null;
}

async function getLockDeployer(): Promise<string | null> {
  if (cachedLockDeployer) return cachedLockDeployer;
  if (!lockAddress) return null;
  if (RESOLVED_SUBGRAPH_URL) {
    try {
      const body = JSON.stringify({
        query: `query Lock($address: String!) {
          locks(first: 1, where: { address: $address }) {
            deployer
          }
        }`,
        variables: { address: lockAddress },
      });
      const res = await fetchSubgraph(body);
      if (res.ok) {
        const json = await res.json();
        const deployer = json?.data?.locks?.[0]?.deployer;
        if (typeof deployer === 'string' && deployer.length) {
          cachedLockDeployer = deployer.toLowerCase();
          return cachedLockDeployer;
        }
      } else {
        console.error('Lock deployer subgraph request failed', res.status);
      }
    } catch (_err) {
      console.error('Failed to load lock deployer from subgraph', _err);
    }
  }
  try {
    const data = await fetchFromAlchemy<any>('getContractMetadata', {
      contractAddress: lockAddress,
    });
    const deployer =
      data?.contractMetadata?.contractDeployer ||
      data?.contractDeployer ||
      null;
    if (deployer) {
      cachedLockDeployer = String(deployer).toLowerCase();
    }
    return cachedLockDeployer;
  } catch (err) {
    console.error('Failed to load lock contract metadata', err);
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const addrsParam = searchParams.get('addresses');
    if (!addrsParam) {
      return NextResponse.json({ error: 'addresses query param required' }, { status: 400 });
    }
    const addresses = Array.from(
      new Set(
        addrsParam
          .split(',')
          .map((a) => a.trim().toLowerCase())
          .filter(Boolean)
      )
    );
    if (!addresses.length) {
      return NextResponse.json({ nfts: [] });
    }

    const [lockDeployer, lockOwner] = await Promise.all([
      getLockDeployer(),
      getLockOwner(),
    ]);
    const collected: Array<{ item: any; sortKey: number; tokenId: string; contract: string }> = [];
    const userContracts = new Set<string>();
    const missed: any[] = [];
    const upcoming: any[] = [];
    const missedContracts = new Set<string>();
    let lastError: string | null = null;

    for (const owner of addresses) {
      let ownerKeys: SubgraphKey[] = [];
      try {
        ownerKeys = await fetchKeysForOwner(owner);
      } catch (err: any) {
        console.error('Failed to fetch keys from subgraph', owner, err);
        lastError = err?.message || 'Failed to load NFTs';
        continue;
      }

      for (const keyData of ownerKeys) {
        const contractAddress = keyData.lock?.address?.toLowerCase();
        if (!contractAddress) continue;
        if (MEMBERSHIP_TIER_ADDRESSES.has(contractAddress)) continue;

        const keyLockDeployer = keyData.lock?.deployer?.toLowerCase() || null;
        const keyLockManagers = Array.isArray(keyData.lock?.lockManagers)
          ? keyData.lock.lockManagers.map((addr) => String(addr).toLowerCase())
          : [];

        const include =
          contractAddress === lockAddress ||
          (keyLockDeployer &&
            (keyLockDeployer === lockAddress ||
              (lockDeployer && keyLockDeployer === lockDeployer))) ||
          (lockOwner && keyLockManagers.includes(lockOwner));

        if (!include) {
          continue;
        }

        const rawTokenId = keyData.tokenId;
        const tokenIdDecimal = typeof rawTokenId === 'string' && rawTokenId.length
          ? rawTokenId
          : rawTokenId != null
          ? String(rawTokenId)
          : null;
        if (!tokenIdDecimal) continue;

        const onChainLockName = await getLockName(contractAddress);
        const metadata = await getEventMetadata(contractAddress);

        const title = metadata?.titleOverride?.trim()?.length
          ? metadata.titleOverride.trim()
          : onChainLockName?.length
          ? onChainLockName
          : keyData.lock?.name?.trim() || 'Event';

        const description = metadata?.description ?? null;
        const eventDate = metadata?.date ?? null;
        const startTime = metadata?.startTime ?? null;
        const endTime = metadata?.endTime ?? null;
        const timezone = metadata?.timezone ?? null;
        const location = metadata?.location ?? null;
        const image = metadata?.imageUrl ? normalizeImageUrl(metadata.imageUrl) : null;

        const expirationRaw = typeof keyData.expiration === 'string'
          ? keyData.expiration
          : typeof keyData.expiration === 'number'
          ? keyData.expiration
          : null;
        const expirationValue = expirationRaw != null ? Number(expirationRaw) : null;
        const expiration = Number.isFinite(expirationValue) ? expirationValue : null;
        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);
        const cancelled = Boolean(keyData.cancelled);
        const isActive = !cancelled && expiration != null && expiration > nowSec;

        let eventTimestamp = resolveEventTimestamp(eventDate, startTime, timezone);
        if (eventTimestamp === null) {
          const legacyTimestamp = await fetchLegacyEventTimestamp(
            contractAddress,
            tokenIdDecimal,
            onChainLockName || keyData.lock?.name || null,
          );
          if (legacyTimestamp !== null) {
            eventTimestamp = legacyTimestamp;
          }
        }
        const baseItem = {
          owner,
          contractAddress,
          tokenId: tokenIdDecimal,
          title,
          description,
          subtitle: eventDate,
          eventDate,
          startTime,
          endTime,
          timezone,
          location,
          image,
          collectionName: onChainLockName || keyData.lock?.name || null,
          tokenType: null,
          videoUrl: null,
          eventStatus: isActive ? "active" : "expired",
          expiresAt: expiration,
          eventTimestamp,
        };

        const creationSortValue = await getLockCreationSortKey(contractAddress);
        const normalizedSortKey = creationSortValue != null && Number.isFinite(creationSortValue)
          ? creationSortValue
          : Number.MAX_SAFE_INTEGER;

        if (!isActive) {
          const isFutureEvent = (() => {
            const dateText = (baseItem.eventDate || baseItem.subtitle || "").trim();
            if (!dateText) return false;
            const candidates: string[] = [];
            const timeText = (baseItem.startTime || '').trim();
            if (timeText) {
              candidates.push(`${dateText} ${timeText}`);
            }
            candidates.push(dateText);
            for (const candidate of candidates) {
              const parsed = Date.parse(candidate);
              if (Number.isFinite(parsed)) {
                return parsed > nowMs;
              }
            }
            return false;
          })();
          if (isFutureEvent) {
            continue;
          }
          missed.push({ ...baseItem, sortKey: normalizedSortKey });
          missedContracts.add(contractAddress);
          continue;
        }

        collected.push({ item: { ...baseItem, sortKey: normalizedSortKey }, sortKey: normalizedSortKey, tokenId: tokenIdDecimal, contract: contractAddress });
        userContracts.add(contractAddress);
      }
    }

    const ordered = collected
      .sort((a, b) => {
        if (a.sortKey !== b.sortKey) return b.sortKey - a.sortKey;
        if (a.contract !== b.contract) return a.contract.localeCompare(b.contract);
        try {
          const aId = BigInt(a.tokenId);
          const bId = BigInt(b.tokenId);
          if (aId === bId) return 0;
          return aId > bId ? -1 : 1;
        } catch {
          return b.tokenId.localeCompare(a.tokenId);
        }
      })
      .map((entry) => entry.item);

    try {
      const relevantLocks = await fetchRelevantEventLocks();
      const visited = new Set<string>();
      for (const lock of relevantLocks) {
        const addr = lock.address.toLowerCase();
        if (visited.has(addr)) continue;
        visited.add(addr);
        if (userContracts.has(addr)) continue;
        if (missedContracts.has(addr)) continue;
        if (addr === lockAddress) continue;
        const sampleTokenId = await fetchSampleTokenForLock(addr);
        const onChainLockName = await getLockName(addr);
        const metadata = await getEventMetadata(addr);
        if (metadata?.status === "draft") {
          continue;
        }

        const title = metadata?.titleOverride?.trim()?.length
          ? metadata.titleOverride.trim()
          : onChainLockName?.length
          ? onChainLockName
          : lock.name?.trim() || 'Upcoming Meeting';
        const description = metadata?.description ?? null;
        const eventDate = metadata?.date ?? null;
        const startTime = metadata?.startTime ?? null;
        const endTime = metadata?.endTime ?? null;
        const timezone = metadata?.timezone ?? null;
        const location = metadata?.location ?? null;
        const imageUrl = metadata?.imageUrl ? normalizeImageUrl(metadata.imageUrl) : null;
        const creationSortValue = await getLockCreationSortKey(addr);
        const normalizedSortKey = creationSortValue != null && Number.isFinite(creationSortValue)
          ? creationSortValue
          : Number.MAX_SAFE_INTEGER;

        let eventTimestamp = resolveEventTimestamp(eventDate, startTime, timezone);
        if (eventTimestamp === null) {
          const legacyTimestamp = await fetchLegacyEventTimestamp(
            addr,
            sampleTokenId,
            onChainLockName || lock.name || null,
          );
          if (legacyTimestamp !== null) {
            eventTimestamp = legacyTimestamp;
          }
        }
        const nowMs = Date.now();
        const classification: 'upcoming' | 'past' = eventTimestamp !== null
          ? (eventTimestamp > nowMs ? 'upcoming' : 'past')
          : (sampleTokenId ? 'past' : 'upcoming');

        if (classification === 'upcoming') {
          upcoming.push({
            contractAddress: addr,
            title,
            registrationUrl: `/events/${addr}`,
            description,
            subtitle: eventDate,
            startTime,
            endTime,
            timezone,
            location,
            image: imageUrl,
            quickCheckoutLock: null,
            eventDate,
            eventTimestamp,
            sortKey: normalizedSortKey,
          });
          continue;
        }

        missed.push({
          owner: null,
          contractAddress: addr,
          tokenId: sampleTokenId ?? 'lock-metadata',
          title,
          description,
          subtitle: eventDate,
          eventDate,
          startTime,
          endTime,
          timezone,
          location,
          image: imageUrl,
          collectionName: onChainLockName || lock.name || null,
          tokenType: null,
          videoUrl: null,
          eventTimestamp,
          sortKey: normalizedSortKey,
        });
        missedContracts.add(addr);
      }
    } catch (err) {
      console.error('Failed to load missed NFTs', err);
    }

    return NextResponse.json({ nfts: ordered, missed, upcoming, error: lastError });
  } catch (error: any) {
    console.error('NFT fetch failed:', error);
    return NextResponse.json({ nfts: [], error: error?.message || 'Unexpected error' });
  }
}
