import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMembershipStateSnapshot } from "@/app/actions/membership-state";
import { snapshotToMembershipSummary, type AllowanceState } from "@/lib/membership-state-service";
import type { MembershipSummary } from "@/lib/membership-server";
import { pickHighestActiveTier } from "@/lib/membership-tiers";

type UseMembershipOptions = {
  ready: boolean;
  authenticated: boolean;
  walletAddress?: string | null;
  wallets?: string[];
  addressesKey: string;
  initialMembershipSummary: MembershipSummary | null;
  initialMembershipStatus?: "active" | "expired" | "none" | "unknown";
  initialMembershipExpiry?: number | null;
  initialAllowances?: Record<string, AllowanceState>;
  initialTokenIds?: Record<string, string[]>;
  initialAllowancesLoaded?: boolean;
};

export function useMembership({
  ready,
  authenticated,
  walletAddress,
  wallets = [],
  addressesKey,
  initialMembershipSummary,
  initialMembershipStatus = "unknown",
  initialMembershipExpiry = null,
  initialAllowances = {},
  initialTokenIds = {},
  initialAllowancesLoaded = true,
}: UseMembershipOptions) {
  const [membershipStatus, setMembershipStatus] = useState<"active" | "expired" | "none" | "unknown">(
    initialMembershipStatus ?? "unknown"
  );
  const [membershipSummary, setMembershipSummary] = useState<MembershipSummary | null>(initialMembershipSummary ?? null);
  const [membershipExpiry, setMembershipExpiry] = useState<number | null>(initialMembershipExpiry ?? null);
  const [allowances, setAllowances] = useState<Record<string, AllowanceState>>(initialAllowances ?? {});
  const [tokenIds, setTokenIds] = useState<Record<string, string[]>>(initialTokenIds ?? {});
  const [allowancesLoaded, setAllowancesLoaded] = useState<boolean>(!!initialAllowancesLoaded);

  const prevStatusRef = useRef<"active" | "expired" | "none">("none");
  const previousSummaryRef = useRef<MembershipSummary | null>(initialMembershipSummary ?? null);
  const initialMembershipAppliedRef = useRef(false);

  const addresses = useMemo(() => {
    const list = wallets && wallets.length ? wallets : walletAddress ? [walletAddress] : [];
    return list.map((a) => String(a).toLowerCase());
  }, [walletAddress, wallets]);

  const membershipQueryEnabled = ready && authenticated && addresses.length > 0;
  const needsAllowancesFetch = !initialAllowancesLoaded;
  const hasInitialData = !!initialMembershipSummary;

  const membershipQuery = useQuery({
    queryKey: ["membership", addressesKey],
    enabled: membershipQueryEnabled,
    staleTime: needsAllowancesFetch ? 0 : 1000 * 60 * 3,
    gcTime: 1000 * 60 * 10,
    retry: 2,
    refetchOnMount: needsAllowancesFetch ? "always" : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: needsAllowancesFetch,
    initialData: hasInitialData
      ? {
          summary: initialMembershipSummary,
          allowances: initialAllowances ?? {},
          tokenIds: initialTokenIds ?? {},
          includesAllowances: initialAllowancesLoaded,
          includesTokenIds: true,
        }
      : undefined,
    initialDataUpdatedAt: hasInitialData ? Date.now() : undefined,
    queryFn: async () => {
      const snapshot = await fetchMembershipStateSnapshot({ addresses, forceRefresh: false });
      return snapshotToMembershipSummary(snapshot);
    },
  });

  useEffect(() => {
    if (!ready || !authenticated) return;
    if (!addresses.length) {
      setMembershipStatus("none");
      setMembershipExpiry(null);
      setMembershipSummary(null);
      setAllowances({});
      setTokenIds({});
      return;
    }
    if (!initialMembershipAppliedRef.current) {
      if (initialMembershipSummary) {
        const summaryStatus = initialMembershipSummary.status;
        const summaryExpiry = initialMembershipSummary.expiry ?? null;
        setMembershipStatus(summaryStatus);
        setMembershipExpiry(summaryExpiry);
        setMembershipSummary(initialMembershipSummary);
        setAllowances(initialAllowances ?? {});
        initialMembershipAppliedRef.current = true;
        return;
      }

      if (initialMembershipStatus && initialMembershipStatus !== "unknown") {
        const expiry = typeof initialMembershipExpiry === "number" ? initialMembershipExpiry : null;
        setMembershipStatus(initialMembershipStatus);
        setMembershipExpiry(expiry);
        if (initialMembershipStatus === "active") {
          prevStatusRef.current = "active";
        }
        initialMembershipAppliedRef.current = true;
        if (initialMembershipStatus === "active") {
          return;
        }
      } else {
        initialMembershipAppliedRef.current = true;
      }
    }

  }, [ready, authenticated, addresses.length, initialMembershipStatus, initialMembershipExpiry, initialMembershipSummary, initialAllowances]);

  useEffect(() => {
    if (!authenticated) {
      previousSummaryRef.current = membershipSummary ?? null;
      return;
    }
    previousSummaryRef.current = membershipSummary ?? null;
  }, [authenticated, membershipSummary]);

  useEffect(() => {
    if (!membershipQuery.data) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const { summary, allowances: snapshotAllowances, tokenIds: snapshotTokenIds } = membershipQuery.data;
    setAllowances(snapshotAllowances);
    setTokenIds(snapshotTokenIds || {});
    if (membershipQuery.data.includesAllowances !== undefined) {
      setAllowancesLoaded(!!membershipQuery.data.includesAllowances);
    }

    // Preserve previous active tier if the new response downgrades unexpectedly while still within expiry.
    const previousSummary = previousSummaryRef.current ?? membershipSummary ?? null;
    const previousTier = pickHighestActiveTier(previousSummary);
    const previousExpiry = typeof previousTier?.expiry === "number" ? previousTier.expiry : null;
    const previousStillActive =
      !!previousTier && previousTier.status === "active" && (previousExpiry === null || previousExpiry > nowSec);
    const currentTier = pickHighestActiveTier(summary);

    if (previousStillActive && (!currentTier || currentTier.status !== "active")) {
      setMembershipStatus("active");
      setMembershipExpiry(previousExpiry ?? null);
      if (previousSummary) {
        setMembershipSummary(previousSummary);
      }
      prevStatusRef.current = "active";
      return;
    }

    const expiry = typeof summary.expiry === "number" ? summary.expiry : null;
    const derived = typeof expiry === "number" && expiry > nowSec ? ("active" as const) : typeof expiry === "number" ? ("expired" as const) : undefined;
    const effectiveStatus = (derived ?? summary.status) as "active" | "expired" | "none";
    setMembershipStatus(effectiveStatus);
    setMembershipExpiry(expiry);
    setMembershipSummary(summary);
    previousSummaryRef.current = summary;
    if (effectiveStatus !== "none") {
      prevStatusRef.current = effectiveStatus;
    }
  }, [membershipQuery.data, membershipSummary, membershipQuery.isFetching]);

  return {
    membershipStatus,
    membershipSummary,
    membershipExpiry,
    allowances,
    tokenIds,
    refreshMembership: () => membershipQuery.refetch({ cancelRefetch: false, throwOnError: false }),
    allowancesLoaded,
    setAllowances,
    setTokenIds,
  } as const;
}
