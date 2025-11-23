import { getServerSession } from "next-auth";
import HomeClient from "./home-client";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { membershipStateService, snapshotToMembershipSummary, type AllowanceState } from "@/lib/membership-state-service";
import type { MembershipSummary } from "@/lib/membership-server";

export default async function HomePage() {
  const session = await getServerSession(authOptions as any);
  const sessionUser = (session?.user ?? null) as any | null;
  const wallets = Array.isArray(sessionUser?.wallets) ? (sessionUser.wallets as string[]) : [];
  const walletAddress = typeof sessionUser?.walletAddress === "string" ? (sessionUser.walletAddress as string) : null;
  const addresses = wallets.length ? wallets : walletAddress ? [walletAddress] : [];
  const normalized = Array.from(new Set(addresses.map((addr) => (addr ? addr.toLowerCase() : "")).filter(Boolean)));

  let initialSummary: MembershipSummary | null = null;
  let initialStatus: "active" | "expired" | "none" | "unknown" = "unknown";
  let initialExpiry: number | null = null;
  let initialAllowances: Record<string, AllowanceState> = {};
  let initialTokenIds: Record<string, string[]> = {};

  if (normalized.length) {
    try {
      const snapshot = await membershipStateService.getState({ addresses: normalized, forceRefresh: true });
      const { summary, allowances, tokenIds } = snapshotToMembershipSummary(snapshot);
      initialSummary = summary;
      initialStatus = summary.status;
      initialExpiry = summary.expiry ?? null;
      initialAllowances = allowances;
      initialTokenIds = tokenIds;
    } catch (error) {
      console.error("Home page membership snapshot failed", error);
    }
  }

  return (
    <HomeClient
      initialMembershipSummary={initialSummary}
      initialMembershipStatus={initialStatus}
      initialMembershipExpiry={initialExpiry}
      initialAllowances={initialAllowances}
      initialTokenIds={initialTokenIds}
    />
  );
}
