import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildNftKey } from "@/lib/home-utils";

type PrefetchedData = {
  creatorNfts: any[] | null;
  missedNfts: any[] | null;
  upcomingNfts: any[] | null;
  error: string | null;
};

export function useMemberNfts(addressesKey: string, enabled: boolean, includeMissed: boolean, initialData?: PrefetchedData | null) {
  const queryEnabled = enabled && !!addressesKey;
  const hasInitialData = !!initialData;
  const {
    data,
    isPending,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["nfts", addressesKey],
    enabled: queryEnabled,
    staleTime: 1000 * 60 * 3,
    gcTime: 1000 * 60 * 10,
    retry: 2,
    refetchOnMount: hasInitialData ? false : "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialData: hasInitialData ? initialData ?? undefined : undefined,
    initialDataUpdatedAt: hasInitialData ? Date.now() : undefined,
    queryFn: async () => {
      const res = await fetch(`/api/nfts?addresses=${encodeURIComponent(addressesKey)}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load NFTs (${res.status})`);
      }
      const payload = await res.json();
      return {
        creatorNfts: Array.isArray(payload?.nfts) ? payload.nfts : [],
        missedNfts: Array.isArray(payload?.missed) ? payload.missed : [],
        upcomingNfts: Array.isArray(payload?.upcoming)
          ? payload.upcoming.map((nft: any) => ({
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
          : [],
        error: typeof payload?.error === "string" && payload.error.length ? payload.error : null,
      };
    },
  });

  const creatorNfts = data?.creatorNfts ?? null;
  const missedNfts = data?.missedNfts ?? null;
  const upcomingNfts = data?.upcomingNfts ?? null;
  const creatorNftsError = data?.error ?? (error ? error.message : null);
  const creatorNftsLoading = isPending || isFetching;

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
  }, [creatorNfts, missedNfts, includeMissed]);

  const missedKeySet = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(missedNfts)) {
      for (const entry of missedNfts) {
        set.add(buildNftKey(entry.contractAddress, entry.tokenId ?? 'upcoming'));
      }
    }
    return set;
  }, [missedNfts]);

  const refresh = useMemo(
    () => () => refetch({ cancelRefetch: false, throwOnError: false }),
    [refetch]
  );

  return {
    creatorNfts,
    missedNfts,
    upcomingNfts,
    creatorNftsLoading,
    creatorNftsError,
    displayNfts,
    missedKeySet,
    refresh,
  } as const;
}
