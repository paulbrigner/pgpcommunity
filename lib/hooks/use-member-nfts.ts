import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { stripMarkdown, buildNftKey } from "@/lib/home-utils";

type DisplayNft = {
  owner: string | null;
  contractAddress: string;
  tokenId: string;
  title: string;
  description: string | null;
  subtitle?: string | null;
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string | null;
  location?: string | null;
  image: string | null;
  collectionName: string | null;
  tokenType: string | null;
  videoUrl?: string | null;
  sortKey?: number;
};

export function useMemberNfts(addressesKey: string, enabled: boolean, includeMissed: boolean) {
  const [creatorNfts, setCreatorNfts] = useState<DisplayNft[] | null>(null);
  const [missedNfts, setMissedNfts] = useState<DisplayNft[] | null>(null);
  const [upcomingNfts, setUpcomingNfts] = useState<any[] | null>(null);
  const [creatorNftsLoading, setCreatorNftsLoading] = useState(false);
  const [creatorNftsError, setCreatorNftsError] = useState<string | null>(null);
  const nftFetchSeq = useRef(0);
  const lastFetchedAddresses = useRef<string | null>(null);

  const loadCreatorNfts = useCallback(
    async (key: string, force = false) => {
      if (!key) return;
      if (!force && lastFetchedAddresses.current === key) {
        return;
      }
      const seq = ++nftFetchSeq.current;
      setCreatorNftsLoading(true);
      setCreatorNftsError(null);
      try {
        const res = await fetch(`/api/nfts?addresses=${encodeURIComponent(key)}`, { cache: "no-store" });
        const data = await res.json();
        if (nftFetchSeq.current !== seq) return;
        setCreatorNfts(Array.isArray(data?.nfts) ? data.nfts : []);
        setMissedNfts(Array.isArray(data?.missed) ? data.missed : []);
        setUpcomingNfts(
          Array.isArray(data?.upcoming)
            ? data.upcoming.map((nft: any) => ({
                contractAddress: String(nft.contractAddress),
                title: String(nft.title ?? ""),
                description: nft.description ?? null,
                subtitle: nft.subtitle ?? null,
                startTime: nft.startTime ?? null,
                endTime: nft.endTime ?? null,
                timezone: nft.timezone ?? null,
                location: nft.location ?? null,
                image: nft.image ?? null,
                registrationUrl: String(nft.registrationUrl ?? ""),
                quickCheckoutLock: typeof nft.quickCheckoutLock === "string" ? nft.quickCheckoutLock : null,
              }))
            : []
        );
        setCreatorNftsError(typeof data?.error === "string" && data.error.length ? data.error : null);
        lastFetchedAddresses.current = key;
      } catch (err: any) {
        if (nftFetchSeq.current !== seq) return;
        setCreatorNftsError(err?.message || "Failed to load NFTs");
        setCreatorNfts([]);
        lastFetchedAddresses.current = key;
      } finally {
        if (nftFetchSeq.current === seq) {
          setCreatorNftsLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!enabled) {
      setCreatorNfts(null);
      setMissedNfts(null);
      setUpcomingNfts(null);
      setCreatorNftsLoading(false);
      setCreatorNftsError(null);
      lastFetchedAddresses.current = null;
      return;
    }
    if (!addressesKey) return;
    void loadCreatorNfts(addressesKey);
  }, [addressesKey, enabled, loadCreatorNfts]);

  const displayNfts = useMemo(() => {
    const owned = Array.isArray(creatorNfts) ? creatorNfts : [];
    const missedList = Array.isArray(missedNfts) ? missedNfts : [];
    const source = includeMissed && missedList.length > 0 ? [...owned, ...missedList] : [...owned];
    if (!source.length) return [] as typeof owned;

    const enriched = source.map((nft) => {
      const sortValue = (() => {
        if (typeof nft.sortKey === "number" && Number.isFinite(nft.sortKey)) {
          return nft.sortKey;
        }
        if (nft.startTime && nft.subtitle) {
          const parsed = Date.parse(`${nft.subtitle} ${nft.startTime}`);
          if (Number.isFinite(parsed)) return parsed;
        }
        if (nft.subtitle) {
          const parsed = Date.parse(nft.subtitle);
          if (Number.isFinite(parsed)) return parsed;
        }
        if (nft.tokenId) {
          const parsed = Number(nft.tokenId);
          if (Number.isFinite(parsed)) return parsed;
        }
        return 0;
      })();
      return { ...nft, sortKey: sortValue };
    });

    return includeMissed && missedList.length > 0
      ? enriched.sort((a, b) => {
          if ((a.sortKey ?? 0) !== (b.sortKey ?? 0)) {
            return (b.sortKey ?? 0) - (a.sortKey ?? 0);
          }
          const titleA = (a.title ?? '').toLowerCase();
          const titleB = (b.title ?? '').toLowerCase();
          if (titleA > titleB) return -1;
          if (titleA < titleB) return 1;
          const tokenA = (a.tokenId ?? '').toString().toLowerCase();
          const tokenB = (b.tokenId ?? '').toString().toLowerCase();
          if (tokenA > tokenB) return -1;
          if (tokenA < tokenB) return 1;
          return 0;
        })
      : enriched;
  }, [creatorNfts, missedNfts]);

  const missedKeySet = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(missedNfts)) {
      for (const entry of missedNfts) {
        set.add(buildNftKey(entry.contractAddress, entry.tokenId ?? 'upcoming'));
      }
    }
    return set;
  }, [missedNfts]);

  return {
    creatorNfts,
    missedNfts,
    upcomingNfts,
    creatorNftsLoading,
    creatorNftsError,
    displayNfts,
    missedKeySet,
    refresh: (force = false) => loadCreatorNfts(addressesKey, force),
  } as const;
}
