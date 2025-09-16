import { NextRequest, NextResponse } from 'next/server';
import { LOCK_ADDRESS, BASE_RPC_URL } from '@/lib/config';
import { JsonRpcProvider, Contract } from 'ethers';

type AlchemyNFT = {
  contract: { address: string };
  tokenId: string;
  title?: string | null;
  description?: string | null;
  tokenType?: string | null;
  image?: {
    cachedUrl?: string | null;
    thumbnailUrl?: string | null;
    originalUrl?: string | null;
  } | null;
  collection?: { name?: string | null } | null;
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

          if (contractAddress === lockAddress) {
            // Always include assets directly from the membership lock.
            collected.push({
              owner,
              contractAddress,
              tokenId: nft.tokenId,
              title: nft.title || nft.collection?.name || 'Untitled NFT',
              description: nft.description || null,
              image:
                nft.image?.thumbnailUrl ||
                nft.image?.cachedUrl ||
                nft.image?.originalUrl ||
                null,
              collectionName: nft.collection?.name || null,
              tokenType: nft.tokenType || null,
            });
            continue;
          }

          const deployer = await getContractDeployer(contractAddress, deployerCache);
          const normalizedDeployer = deployer?.toLowerCase() || null;
          if (normalizedDeployer === lockAddress) {
            collected.push({
              owner,
              contractAddress,
              tokenId: nft.tokenId,
              title: nft.title || nft.collection?.name || 'Untitled NFT',
              description: nft.description || null,
              image:
                nft.image?.thumbnailUrl ||
                nft.image?.cachedUrl ||
                nft.image?.originalUrl ||
                null,
              collectionName: nft.collection?.name || null,
              tokenType: nft.tokenType || null,
            });
            continue;
          }

          if (lockDeployer && normalizedDeployer === lockDeployer.toLowerCase()) {
            collected.push({
              owner,
              contractAddress,
              tokenId: nft.tokenId,
              title: nft.title || nft.collection?.name || 'Untitled NFT',
              description: nft.description || null,
              image:
                nft.image?.thumbnailUrl ||
                nft.image?.cachedUrl ||
                nft.image?.originalUrl ||
                null,
              collectionName: nft.collection?.name || null,
              tokenType: nft.tokenType || null,
            });
            continue;
          }

          if (lockOwner && normalizedDeployer === lockOwner) {
            collected.push({
              owner,
              contractAddress,
              tokenId: nft.tokenId,
              title: nft.title || nft.collection?.name || 'Untitled NFT',
              description: nft.description || null,
              image:
                nft.image?.thumbnailUrl ||
                nft.image?.cachedUrl ||
                nft.image?.originalUrl ||
                null,
              collectionName: nft.collection?.name || null,
              tokenType: nft.tokenType || null,
            });
            continue;
          }

          if (lockOwner) {
            const contractOwner = await getNftContractOwner(contractAddress);
            if (contractOwner && contractOwner === lockOwner) {
              collected.push({
                owner,
                contractAddress,
                tokenId: nft.tokenId,
                title: nft.title || nft.collection?.name || 'Untitled NFT',
                description: nft.description || null,
                image:
                  nft.image?.thumbnailUrl ||
                  nft.image?.cachedUrl ||
                  nft.image?.originalUrl ||
                  null,
                collectionName: nft.collection?.name || null,
                tokenType: nft.tokenType || null,
              });
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
