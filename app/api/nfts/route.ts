import { NextRequest, NextResponse } from 'next/server';
import {
  LOCK_ADDRESS,
  BASE_RPC_URL,
  BASE_NETWORK_ID,
  LOCKSMITH_BASE_URL,
  UNLOCK_SUBGRAPH_URL,
  UNLOCK_SUBGRAPH_ID,
  UNLOCK_SUBGRAPH_API_KEY,
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

type SubgraphKey = {
  tokenId: string;
  lock: {
    address: string;
    deployer?: string | null;
    lockManagers?: string[] | null;
    name?: string | null;
  };
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
    const collected: any[] = [];
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

        const baseItem = {
          owner,
          contractAddress,
          tokenId: tokenIdDecimal,
          title: displayTitle,
          description: trimmedSubtitle,
          subtitle: trimmedSubtitle,
          image: fallbackImage,
          collectionName: fallbackCollection,
          tokenType: null,
        };

        collected.push(baseItem);
      }
    }

    return NextResponse.json({ nfts: collected, error: lastError });
  } catch (error: any) {
    console.error('NFT fetch failed:', error);
    return NextResponse.json({ nfts: [], error: error?.message || 'Unexpected error' });
  }
}
