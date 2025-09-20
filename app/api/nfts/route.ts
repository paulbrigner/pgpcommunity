import { NextRequest, NextResponse } from 'next/server';
import {
  LOCK_ADDRESS,
  BASE_RPC_URL,
  BASE_NETWORK_ID,
  LOCKSMITH_BASE_URL,
  UNLOCK_SUBGRAPH_URL,
  UNLOCK_SUBGRAPH_ID,
  UNLOCK_SUBGRAPH_API_KEY,
  HIDDEN_UNLOCK_CONTRACTS,
} from '@/lib/config';
import unlockNetworks from '@unlock-protocol/networks';
import { JsonRpcProvider, Contract } from 'ethers';

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

const lockAddress = (LOCK_ADDRESS || '').toLowerCase();

let cachedLockDeployer: string | null = null;
let cachedLockOwner: string | null = null;

const provider = (() => {
  try {
    return BASE_RPC_URL ? new JsonRpcProvider(BASE_RPC_URL) : null;
  } catch (err) {
    console.error('Failed to create provider for NFT route', err);
    return null;
  }
})();

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




const locksmithMetadataCache = new Map<string, any>();
const LOCKSMITH_BASE = LOCKSMITH_BASE_URL;
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
const YOUTUBE_FIELD_CANDIDATES = [
  'youtube',
  'youtube_url',
  'youtubeUrl',
  'youtube_uri',
  'youtubeUri',
  'video',
  'video_url',
  'videoUrl',
  'video_uri',
  'videoUri',
  'media_url',
  'mediaUrl',
] as const;
const YOUTUBE_HOST_CANDIDATES = ['youtube.com', 'youtu.be'];

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

function isYoutubeUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return YOUTUBE_HOST_CANDIDATES.some((host) => url.host.includes(host));
  } catch {
    return YOUTUBE_HOST_CANDIDATES.some((host) => value.includes(host));
  }
}

function findYoutubeLinkDeep(value: unknown, depth = 0): string | null {
  if (depth > 6) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && isYoutubeUrl(trimmed)) return trimmed;
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findYoutubeLinkDeep(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const found = findYoutubeLinkDeep((value as any)[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractYoutubeLinkFromObject(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const field of YOUTUBE_FIELD_CANDIDATES) {
    const raw = coerceToTrimmedString((obj as any)?.[field]);
    if (raw && isYoutubeUrl(raw)) return raw;
  }

  const links = (obj as any)?.links;
  if (Array.isArray(links)) {
    for (const candidate of links) {
      const value = coerceToTrimmedString(candidate);
      if (value && isYoutubeUrl(value)) return value;
      if (candidate && typeof candidate === 'object') {
        const maybeUrl = coerceToTrimmedString((candidate as any)?.url || (candidate as any)?.href);
        if (maybeUrl && isYoutubeUrl(maybeUrl)) return maybeUrl;
      }
    }
  }

  return null;
}

function extractYoutubeLink(metadata: any, attributes: Array<any>): string | null {
  const topLevel = extractYoutubeLinkFromObject(metadata);
  if (topLevel) return topLevel;

  const nested = extractYoutubeLinkFromObject(metadata?.metadata);
  if (nested) return nested;

  for (const attr of attributes) {
    const value = coerceToTrimmedString(attr?.value || attr?.display_value || attr?.displayValue);
    if (value && isYoutubeUrl(value)) return value;
    const deep = findYoutubeLinkDeep(attr);
    if (deep) return deep;
  }

  const deepFallback = findYoutubeLinkDeep(metadata);
  if (deepFallback) return deepFallback;

  return null;
}

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

type RelevantLock = {
  address: string;
  name?: string | null;
};

async function fetchLocksmithMetadata(lockAddress: string, tokenId: string) {
  const key = `${lockAddress}:${tokenId}`;
  if (locksmithMetadataCache.has(key)) {
    const cached = locksmithMetadataCache.get(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
    locksmithMetadataCache.delete(key);
  }
  try {
    const url = `${LOCKSMITH_BASE}/v2/api/metadata/${RESOLVED_NETWORK_ID}/locks/${lockAddress}/keys/${encodeURIComponent(tokenId)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      locksmithMetadataCache.delete(key);
      return null;
    }
    const data = await res.json();
    locksmithMetadataCache.set(key, data);
    return data;
  } catch (_err) {
    locksmithMetadataCache.delete(key);
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

async function fetchRelevantLocks(lockDeployer: string | null, lockOwner: string | null): Promise<RelevantLock[]> {
  if (!RESOLVED_SUBGRAPH_URL || (!lockDeployer && !lockOwner)) return [];
  const queryParts: string[] = [];
  const variableDecls: string[] = [];
  const variables: Record<string, string> = {};
  if (lockDeployer) {
    variableDecls.push('$deployer: String!');
    variables.deployer = lockDeployer;
    queryParts.push(`deployerLocks: locks(first: 200, where: { deployer: $deployer }) {
      address
      name
    }`);
  }
  if (lockOwner) {
    variableDecls.push('$owner: String!');
    variables.owner = lockOwner;
    queryParts.push(`managerLocks: locks(first: 200, where: { lockManagers_contains: [$owner] }) {
      address
      name
    }`);
  }
  if (!queryParts.length) return [];
  const query = `query RelevantLocks(${variableDecls.join(', ')}) {
    ${queryParts.join('\n')}
  }`;
  const body = JSON.stringify({ query, variables });
  const res = await fetchSubgraph(body);
  if (!res.ok) {
    return [];
  }
  const json = await res.json();
  const locks: RelevantLock[] = [];
  const pushLock = (entry: any) => {
    if (!entry) return;
    const address = typeof entry.address === 'string' ? entry.address.toLowerCase() : null;
    if (!address) return;
    locks.push({ address, name: typeof entry.name === 'string' ? entry.name : null });
  };
  (json?.data?.deployerLocks ?? []).forEach(pushLock);
  (json?.data?.managerLocks ?? []).forEach(pushLock);
  return locks;
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

        const locksmithResponse = await fetchLocksmithMetadata(contractAddress, tokenIdDecimal);
        const locksmithMetadata =
          locksmithResponse && typeof locksmithResponse === 'object'
            ? locksmithResponse
            : null;

        const onChainLockName = await getLockName(contractAddress);

        const fallbackTitle =
          locksmithMetadata?.name?.trim()?.length
            ? locksmithMetadata.name
            : keyData.lock?.name?.trim()?.length
            ? keyData.lock.name
            : 'Untitled NFT';

        const fallbackCollection =
          locksmithMetadata?.description?.trim()?.length
            ? locksmithMetadata.description
          : keyData.lock?.name?.trim()?.length
          ? keyData.lock.name
          : null;

        const metadataDescription = (() => {
          const primary = coerceToTrimmedString(locksmithMetadata?.description);
          if (primary) return primary;
          const nested = coerceToTrimmedString(locksmithMetadata?.metadata?.description);
          if (nested) return nested;
          return fallbackCollection;
        })();

        const attributes = Array.isArray(locksmithMetadata?.attributes)
          ? locksmithMetadata.attributes
          : Array.isArray(locksmithMetadata?.metadata?.attributes)
          ? locksmithMetadata.metadata.attributes
          : [];
        const attrEventName = getAttributeValue(attributes, ['event_name', 'eventName', 'event']);
        const attrTicketName = getAttributeValue(attributes, ['ticket_name', 'ticketName']);
        const attrSubtitle = getAttributeValue(attributes, ['subtitle', 'tagline', 'ticket_description', 'ticketDescription']);

        const locksmithEventName = (locksmithMetadata?.event_name || locksmithMetadata?.metadata?.event_name || attrEventName || attrTicketName || '').toString().trim();
        const locksmithTicketName = (locksmithMetadata?.ticket_name || locksmithMetadata?.metadata?.ticket_name || attrTicketName || '').toString().trim();
        const locksmithSubtitle = (locksmithMetadata?.subtitle || locksmithMetadata?.metadata?.subtitle || attrSubtitle || '').toString().trim();

        const displayTitle = onChainLockName?.length
          ? onChainLockName
          : locksmithEventName.length
          ? locksmithEventName
          : locksmithTicketName.length
          ? locksmithTicketName
          : fallbackTitle;

        const subtitleSource = locksmithSubtitle.length
          ? locksmithSubtitle
          : attrSubtitle || fallbackCollection || locksmithMetadata?.description?.trim() || null;
        const trimmedSubtitle = subtitleSource?.trim()?.length ? subtitleSource.trim() : null;

        const fallbackImage =
          normalizeImageUrl(locksmithMetadata?.image) ||
          normalizeImageUrl(locksmithMetadata?.image_url) ||
          normalizeImageUrl(locksmithMetadata?.imageUrl) ||
          normalizeImageUrl(locksmithMetadata?.image_uri) ||
          normalizeImageUrl(locksmithMetadata?.imageUri) ||
          normalizeImageUrl(locksmithMetadata?.metadata?.image) ||
          normalizeImageUrl(locksmithMetadata?.metadata?.image_url) ||
          normalizeImageUrl(locksmithMetadata?.metadata?.imageUrl) ||
          normalizeImageUrl(locksmithMetadata?.metadata?.image_uri) ||
          normalizeImageUrl(locksmithMetadata?.metadata?.imageUri) ||
          null;

        const youtubeLink = extractYoutubeLink(locksmithMetadata, attributes);

        const baseItem = {
          owner,
          contractAddress,
          tokenId: tokenIdDecimal,
          title: displayTitle,
          description: metadataDescription,
          subtitle: trimmedSubtitle,
          image: fallbackImage,
          collectionName: fallbackCollection,
          tokenType: null,
          videoUrl: youtubeLink,
        };

        const expirationRaw = typeof keyData.expiration === 'string'
          ? keyData.expiration
          : typeof keyData.expiration === 'number'
          ? keyData.expiration
          : null;
        const expiration = expirationRaw != null ? Number(expirationRaw) : null;
        const nowSec = Math.floor(Date.now() / 1000);
        const cancelled = Boolean(keyData.cancelled);
        const isActive = !cancelled && (!expiration || !Number.isFinite(expiration) || expiration <= 0 || expiration > nowSec);

        if (!isActive) {
          missed.push(baseItem);
          missedContracts.add(contractAddress);
          continue;
        }

        const creationSortValue = await getLockCreationSortKey(contractAddress);
        const normalizedSortKey = creationSortValue != null && Number.isFinite(creationSortValue)
          ? creationSortValue
          : Number.MAX_SAFE_INTEGER;

        collected.push({ item: baseItem, sortKey: normalizedSortKey, tokenId: tokenIdDecimal, contract: contractAddress });
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
      const relevantLocks = await fetchRelevantLocks(lockDeployer, lockOwner);
      const visited = new Set<string>();
      for (const lock of relevantLocks) {
        const addr = lock.address.toLowerCase();
        if (visited.has(addr)) continue;
        visited.add(addr);
        if (userContracts.has(addr)) continue;
        if (missedContracts.has(addr)) continue;
        if (addr === lockAddress) continue;
        if (HIDDEN_UNLOCK_CONTRACTS.includes(addr)) continue;
        const sampleTokenId = await fetchSampleTokenForLock(addr);
        const onChainLockName = await getLockName(addr);
        if (!sampleTokenId) {
          const title = onChainLockName?.length
            ? onChainLockName
            : lock.name?.trim()?.length
            ? lock.name
            : 'Upcoming Meeting';
          const registrationUrl = `https://app.unlock-protocol.com/checkout?locks[${addr}][network]=${RESOLVED_NETWORK_ID}`;
          upcoming.push({
            contractAddress: addr,
            title,
            registrationUrl,
            description: lock.name || null,
            image: null,
            subtitle: null,
          });
          continue;
        }
        const metadata = await fetchLocksmithMetadata(addr, sampleTokenId);
        if (!metadata || typeof metadata !== 'object') continue;
        const fallbackTitle =
          (metadata as any)?.name?.trim()?.length
            ? (metadata as any).name
            : lock.name?.trim()?.length
            ? lock.name
            : 'Untitled NFT';
        const attributes = Array.isArray((metadata as any)?.attributes)
          ? (metadata as any).attributes
          : Array.isArray((metadata as any)?.metadata?.attributes)
          ? (metadata as any).metadata.attributes
          : [];
        const attrSubtitle = getAttributeValue(attributes, ['subtitle', 'tagline', 'ticket_description', 'ticketDescription']);
        const displayTitle = onChainLockName?.length ? onChainLockName : fallbackTitle;
        const subtitleSource = attrSubtitle || (metadata as any)?.description || (metadata as any)?.metadata?.description || lock.name || null;
        const trimmedSubtitle = subtitleSource?.trim()?.length ? subtitleSource.trim() : null;
        const fallbackImage =
          normalizeImageUrl((metadata as any)?.image) ||
          normalizeImageUrl((metadata as any)?.image_url) ||
          normalizeImageUrl((metadata as any)?.imageUrl) ||
          normalizeImageUrl((metadata as any)?.image_uri) ||
          normalizeImageUrl((metadata as any)?.imageUri) ||
          normalizeImageUrl((metadata as any)?.metadata?.image) ||
          normalizeImageUrl((metadata as any)?.metadata?.image_url) ||
          normalizeImageUrl((metadata as any)?.metadata?.imageUrl) ||
          normalizeImageUrl((metadata as any)?.metadata?.image_uri) ||
          normalizeImageUrl((metadata as any)?.metadata?.imageUri) ||
          null;
        const youtubeLink = extractYoutubeLink(metadata as any, attributes);
        const metadataDescription = coerceToTrimmedString((metadata as any)?.description) ?? coerceToTrimmedString((metadata as any)?.metadata?.description) ?? null;
        missed.push({
          owner: null,
          contractAddress: addr,
          tokenId: sampleTokenId,
          title: displayTitle,
          description: metadataDescription,
          subtitle: trimmedSubtitle,
          image: fallbackImage,
          collectionName: lock.name || null,
          tokenType: null,
          videoUrl: youtubeLink,
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
