import { NextRequest, NextResponse } from 'next/server';
import { LOCK_ADDRESS, BASE_RPC_URL, BASE_NETWORK_ID } from '@/lib/config';
import { JsonRpcProvider, Contract } from 'ethers';

type AlchemyNFT = {
  contract: { address: string };
  tokenId: string;
  title?: string | null;
  description?: string | null;
  tokenType?: string | null;
  metadata?: { name?: string | null; image?: string | null; image_url?: string | null; imageUrl?: string | null; image_uri?: string | null; imageUri?: string | null; [key: string]: any } | null;
  raw?: { metadata?: { name?: string | null; image?: string | null; image_url?: string | null; imageUrl?: string | null; image_uri?: string | null; imageUri?: string | null; [key: string]: any } | null } | null;
  image?: {
    cachedUrl?: string | null;
    thumbnailUrl?: string | null;
    originalUrl?: string | null;
  } | null;
  collection?: { name?: string | null } | null;
  contractMetadata?: { name?: string | null } | null;
};

type AlchemyNFTResponse = {
  ownedNfts?: AlchemyNFT[];
  pageKey?: string;
};

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

const extractAttributes = (nft: AlchemyNFT): Array<any> => {
  if (Array.isArray(nft.metadata?.attributes)) return nft.metadata!.attributes!;
  if (Array.isArray(nft.raw?.metadata?.attributes)) return nft.raw!.metadata!.attributes!;
  return [];
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

const contractOwnerCache = new Map<string, string | null>();

async function getNftContractOwner(address: string): Promise<string | null> {
  const key = address.toLowerCase();
  if (contractOwnerCache.has(key)) return contractOwnerCache.get(key) ?? null;
  if (!provider) {
    contractOwnerCache.set(key, null);
    return null;
  }
  try {
    const contract = new Contract(
      key,
      ['function owner() view returns (address)'],
      provider
    );
    const owner: string = await contract.owner();
    const normalized = owner ? owner.toLowerCase() : null;
    contractOwnerCache.set(key, normalized);
    return normalized;
  } catch (err) {
    contractOwnerCache.set(key, null);
    return null;
  }
}




const locksmithMetadataCache = new Map<string, any>();
const LOCKSMITH_BASE = process.env.NEXT_PUBLIC_LOCKSMITH_BASE || 'https://locksmith.unlock-protocol.com';
const NETWORK_ID = Number(Number.isFinite(BASE_NETWORK_ID) && !Number.isNaN(BASE_NETWORK_ID) ? BASE_NETWORK_ID : (process.env.NEXT_PUBLIC_BASE_NETWORK_ID ? Number(process.env.NEXT_PUBLIC_BASE_NETWORK_ID) : 0));

async function fetchLocksmithMetadata(lockAddress: string, tokenId: string) {
  const key = `${lockAddress}:${tokenId}`;
  if (locksmithMetadataCache.has(key)) {
    return locksmithMetadataCache.get(key);
  }
  try {
    const url = `${LOCKSMITH_BASE}/v2/api/metadata/${NETWORK_ID}/locks/${lockAddress}/keys/${encodeURIComponent(tokenId)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      locksmithMetadataCache.set(key, null);
      return null;
    }
    const data = await res.json();
    locksmithMetadataCache.set(key, data);
    return data;
  } catch (err) {
    locksmithMetadataCache.set(key, null);
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

async function getLockDeployer(): Promise<string | null> {
  if (cachedLockDeployer) return cachedLockDeployer;
  if (!lockAddress) return null;
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

async function getContractDeployer(address: string, cache: Map<string, string | null>): Promise<string | null> {
  const key = address.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const data = await fetchFromAlchemy<any>('getContractMetadata', {
      contractAddress: key,
    });
    const deployer =
      data?.contractMetadata?.contractDeployer ||
      data?.contractDeployer ||
      null;
    const normalized = deployer ? String(deployer).toLowerCase() : null;
    cache.set(key, normalized);
    return normalized;
  } catch (err) {
    console.error('Failed to load contract metadata', address, err);
    cache.set(key, null);
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

    if (!ALCHEMY_NFT_BASE) {
      return NextResponse.json({ nfts: [], error: 'NFT service not configured' });
    }

    const [lockDeployer, lockOwner] = await Promise.all([
      getLockDeployer(),
      getLockOwner(),
    ]);

    const deployerCache = new Map<string, string | null>();
    const collected: any[] = [];
    let lastError: string | null = null;

    for (const owner of addresses) {
      let pageKey: string | undefined;
      for (let page = 0; page < 3; page++) {
        let response: AlchemyNFTResponse | null = null;
        try {
          response = await fetchFromAlchemy<AlchemyNFTResponse>('getNFTsForOwner', {
            owner,
            withMetadata: 'true',
            pageSize: '100',
            ...(pageKey ? { pageKey } : {}),
          });
        } catch (err: any) {
          console.error('Failed to fetch NFTs for owner', owner, err);
          lastError = err?.message || 'Failed to load NFTs';
          break;
        }
        if (!response) break;
        const nfts = response?.ownedNfts || [];
        if (!nfts.length) break;

        for (const nft of nfts) {
          const contractAddress = nft.contract?.address?.toLowerCase();
          if (!contractAddress) continue;

          const tokenIdDecimal = (() => {
            const raw = nft.tokenId;
            if (!raw) return null;
            if (typeof raw === 'string' && raw.startsWith('0x')) {
              try { return BigInt(raw).toString(); } catch { return raw; }
            }
            return typeof raw === 'string' ? raw : String(raw);
          })();

          const locksmithResponse = tokenIdDecimal ? await fetchLocksmithMetadata(contractAddress, tokenIdDecimal) : null;
          const locksmithMetadata = locksmithResponse?.metadata || locksmithResponse || null;

          const fallbackTitle =
            locksmithMetadata?.name?.trim()?.length
              ? locksmithMetadata.name
              : nft.title?.trim()?.length
              ? nft.title
              : nft.collection?.name?.trim()?.length
              ? nft.collection?.name
              : nft.metadata?.name?.trim()?.length
              ? nft.metadata?.name
              : (nft as any)?.raw?.metadata?.name?.trim()?.length
              ? (nft as any).raw.metadata.name
              : 'Untitled NFT';

          const fallbackCollection =
            locksmithMetadata?.description?.trim()?.length
              ? locksmithMetadata.description
              : nft.collection?.name?.trim()?.length
              ? nft.collection?.name
              : nft.contractMetadata?.name?.trim()?.length
              ? nft.contractMetadata?.name
              : nft.metadata?.description?.trim()?.length
              ? nft.metadata?.description
              : (nft as any)?.raw?.metadata?.description?.trim()?.length
              ? (nft as any).raw.metadata.description
              : null;

          const attributes = [
            ...extractAttributes(nft),
            ...(Array.isArray(locksmithMetadata?.attributes) ? locksmithMetadata.attributes : []),
          ];
          const attrEventName = getAttributeValue(attributes, ['event_name', 'eventName', 'event']);
          const attrTicketName = getAttributeValue(attributes, ['ticket_name', 'ticketName']);
          const attrSubtitle = getAttributeValue(attributes, ['subtitle', 'tagline', 'ticket_description', 'ticketDescription']);

          const displayTitle = attrEventName || attrTicketName || fallbackTitle;
          const subtitleSource =
            attrSubtitle ||
            locksmithMetadata?.description?.trim() ||
            fallbackCollection ||
            nft.metadata?.description ||
            (nft as any)?.raw?.metadata?.description ||
            nft.description ||
            null;
          const trimmedSubtitle = subtitleSource?.trim()?.length ? subtitleSource.trim() : null;

          const fallbackImage =
            normalizeImageUrl(locksmithMetadata?.image) ||
            normalizeImageUrl(locksmithMetadata?.image_url) ||
            normalizeImageUrl(locksmithMetadata?.imageUrl) ||
            normalizeImageUrl(locksmithMetadata?.image_uri) ||
            normalizeImageUrl(locksmithMetadata?.imageUri) ||
            normalizeImageUrl(nft.image?.thumbnailUrl) ||
            normalizeImageUrl(nft.image?.cachedUrl) ||
            normalizeImageUrl(nft.image?.originalUrl) ||
            normalizeImageUrl(nft.metadata?.image_url) ||
            normalizeImageUrl(nft.metadata?.imageUrl) ||
            normalizeImageUrl(nft.metadata?.image_uri) ||
            normalizeImageUrl(nft.metadata?.imageUri) ||
            normalizeImageUrl(nft.metadata?.image) ||
            normalizeImageUrl(nft.raw?.metadata?.image_url) ||
            normalizeImageUrl(nft.raw?.metadata?.imageUrl) ||
            normalizeImageUrl(nft.raw?.metadata?.image_uri) ||
            normalizeImageUrl(nft.raw?.metadata?.imageUri) ||
            normalizeImageUrl(nft.raw?.metadata?.image) ||
            null;

          const baseItem = {
            owner,
            contractAddress,
            tokenId: nft.tokenId,
            title: displayTitle,
            description: trimmedSubtitle,
            subtitle: trimmedSubtitle,
            image: fallbackImage,
            collectionName: fallbackCollection,
            tokenType: nft.tokenType || null,
          };

          const deployer = await getContractDeployer(contractAddress, deployerCache);
          const normalizedDeployer = deployer?.toLowerCase() || null;

          const includeByDeployer =
            contractAddress === lockAddress ||
            normalizedDeployer === lockAddress ||
            (lockDeployer && normalizedDeployer === lockDeployer.toLowerCase()) ||
            (lockOwner && normalizedDeployer === lockOwner);

          if (includeByDeployer) {
            collected.push(baseItem);
            continue;
          }

          if (lockOwner) {
            const contractOwner = await getNftContractOwner(contractAddress);
            if (contractOwner && contractOwner === lockOwner) {
              collected.push(baseItem);
              continue;
            }
          }
        }

        pageKey = response.pageKey;
        if (!pageKey) break;
      }
    }

    return NextResponse.json({ nfts: collected, error: lastError });
  } catch (error: any) {
    console.error('NFT fetch failed:', error);
    return NextResponse.json({ nfts: [], error: error?.message || 'Unexpected error' });
  }
}
