import { getServerSession } from "next-auth";
import dynamic from "next/dynamic";
import { Suspense } from "react";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { membershipStateService, snapshotToMembershipSummary, type AllowanceState } from "@/lib/membership-state-service";
import type { MembershipSummary } from "@/lib/membership-server";
import { HomeShellSkeleton } from "@/components/home/Skeletons";
import { headers } from "next/headers";

const HomeClient = dynamic(() => import("./home-client"), {
  loading: () => <HomeShellSkeleton />,
});

export default async function HomePage() {
  const session = await getServerSession(authOptions as any);
  const sessionUser = (session as any)?.user || null;
  const wallets = Array.isArray(sessionUser?.wallets) ? (sessionUser.wallets as string[]) : [];
  const walletAddress = typeof sessionUser?.walletAddress === "string" ? (sessionUser.walletAddress as string) : null;
  const addresses = wallets.length ? wallets : walletAddress ? [walletAddress] : [];
  const normalized = Array.from(new Set(addresses.map((addr) => (addr ? addr.toLowerCase() : "")).filter(Boolean)));

  let initialSummary: MembershipSummary | null = null;
  let initialStatus: "active" | "expired" | "none" | "unknown" = "unknown";
  let initialExpiry: number | null = null;
  let initialAllowances: Record<string, AllowanceState> = {};
  let initialTokenIds: Record<string, string[]> = {};
  let initialAllowancesLoaded = false;
  let initialNfts: any = null;

  if (normalized.length) {
    try {
      const snapshot = await membershipStateService.getState({
        addresses: normalized,
        forceRefresh: false,
        includeAllowances: false,
        includeTokenIds: false,
      });
      const { summary, allowances, tokenIds, includesAllowances } = snapshotToMembershipSummary(snapshot);
      initialSummary = summary;
      initialStatus = summary.status;
      initialExpiry = summary.expiry ?? null;
      initialAllowances = includesAllowances ? allowances : {};
      initialTokenIds = tokenIds;
      initialAllowancesLoaded = !!includesAllowances;
    } catch (error) {
      console.error("Home page membership snapshot failed", error);
    }

    try {
      const hdrs = await headers();
      const cookie = hdrs.get("cookie") ?? "";
      const res = await fetch(`${process.env.NEXTAUTH_URL || ""}/api/nfts?addresses=${encodeURIComponent(normalized.join(","))}`, {
        headers: {
          cookie,
        },
        cache: "no-store",
      });
      if (res.ok) {
        const payload = await res.json();
        initialNfts = {
          creatorNfts: Array.isArray(payload?.nfts) ? payload.nfts : [],
          missedNfts: Array.isArray(payload?.missed) ? payload.missed : [],
          upcomingNfts: Array.isArray(payload?.upcoming) ? payload.upcoming : [],
          error: typeof payload?.error === "string" && payload.error.length ? payload.error : null,
        };
      }
    } catch (err) {
      console.error("Home page NFT prefetch failed", err);
    }
  }

  return (
    <Suspense fallback={<HomeShellSkeleton />}>
      <HomeClient
        initialMembershipSummary={initialSummary}
        initialMembershipStatus={initialStatus}
        initialMembershipExpiry={initialExpiry}
        initialAllowances={initialAllowances}
        initialTokenIds={initialTokenIds}
        initialAllowancesLoaded={initialAllowancesLoaded}
        initialNfts={initialNfts}
      />
    </Suspense>
  );
}
