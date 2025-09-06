// This page interacts directly with the user's browser and wallet,
// so it needs to run on the client side rather than on the server.
"use client";

import { useState, useEffect, useMemo } from "react"; // React helpers for state and lifecycle
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Paywall } from "@unlock-protocol/paywall";
import { networks } from "@unlock-protocol/networks";
import {
  LOCK_ADDRESS,
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  UNLOCK_ADDRESS,
} from "@/lib/config"; // Environment-specific constants
import { checkMembership as fetchMembership } from "@/lib/membership"; // Helper function for membership logic
import { Button } from "@/components/ui/button";
import { signInWithSiwe } from "@/lib/siwe/client";

const PAYWALL_CONFIG = {
  icon: "",
  locks: {
    [LOCK_ADDRESS]: {
      name: "PGP Community Membership",
      order: 1,
      network: BASE_NETWORK_ID,
      recipient: "",
      dataBuilder: "",
      emailRequired: false,
      maxRecipients: null,
    },
  },
  title: "Join the PGP* for Crypto Community",
  referrer: UNLOCK_ADDRESS,
  skipSelect: false,
  hideSoldOut: false,
  pessimistic: false,
  skipRecipient: true,
  endingCallToAction: "Join Now!",
  persistentCheckout: false,
};

export default function Home() {
  // NextAuth session
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const authenticated = status === "authenticated";
  const ready = status !== "loading";
  const walletAddress = (session?.user as any)?.walletAddress as
    | string
    | undefined;
  const wallets = ((session?.user as any)?.wallets as string[] | undefined) || [];
  const firstName = (session?.user as any)?.firstName as string | undefined;
  // Detailed membership state: 'active', 'expired', or 'none'
  const [membershipStatus, setMembershipStatus] = useState<
    "active" | "expired" | "none"
  >("none");
  // Indicates whether we are currently checking membership status
  const [loadingMembership, setLoadingMembership] = useState(false);
  // Flags to show when purchase/renewal or funding actions are running
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Local auth error (e.g., SIWE with unlinked wallet)
  const [authError, setAuthError] = useState<string | null>(null);

  // Paywall instance configured for the Base network
  const paywall = useMemo(() => {
    return new Paywall({
      ...networks,
      [BASE_NETWORK_ID]: {
        ...networks[BASE_NETWORK_ID],
        provider: BASE_RPC_URL,
      },
    });
  }, [BASE_NETWORK_ID, BASE_RPC_URL]);

  // Check on-chain whether the session wallet has a valid membership
  const refreshMembership = async () => {
    if (!ready || !authenticated || !walletAddress) {
      setMembershipStatus("none");
      return;
    }

    setLoadingMembership(true);
    try {
      const status = await fetchMembership(
        [{ address: walletAddress } as any],
        BASE_RPC_URL,
        BASE_NETWORK_ID,
        LOCK_ADDRESS
      );
      setMembershipStatus(status);
    } catch (error) {
      console.error("Membership check failed:", error);
    } finally {
      setLoadingMembership(false);
    }
  };

  useEffect(() => {
    // When authenticated, check membership automatically
    if (ready && authenticated && walletAddress) {
      refreshMembership();
    }
  }, [ready, authenticated, walletAddress]);

  // After email sign-in, apply any locally saved profile to the server and refresh session
  useEffect(() => {
    if (!ready || !authenticated) return;
    try {
      const raw = localStorage.getItem("pendingProfile");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data?.firstName || !data?.lastName) return;
      (async () => {
        try {
          const res = await fetch("/api/profile/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
          if (!res.ok) {
            console.error("Profile update failed", await res.text());
          } else {
            await update({});
            localStorage.removeItem("pendingProfile");
          }
        } catch (e) {
          console.error("Profile update error", e);
        }
      })();
    } catch {}
  }, [ready, authenticated, update]);

  // Open the Unlock Protocol checkout using the existing provider
  const purchaseMembership = async () => {
    if (!walletAddress) {
      console.error("No wallet connected.");
      return;
    }
    setIsPurchasing(true);
    try {
      const provider = (window as any)?.ethereum;
      if (!provider) throw new Error("No Ethereum provider available");
      await paywall.connect(provider);
      // Prevent Unlock from navigating; we'll control refresh ourselves.
      const checkoutConfig = { ...PAYWALL_CONFIG } as any;
      delete checkoutConfig.redirectUri;
      await paywall.loadCheckoutModal(checkoutConfig);
      // Force a single hard reload after the modal fully closes.
      if (typeof window !== "undefined") {
        window.location.replace(window.location.href);
        return;
      }
      await refreshMembership();
    } catch (error) {
      console.error("Purchase failed:", error);
    } finally {
      setIsPurchasing(false);
    }
  };

  // Ask the backend for a short-lived signed URL to view gated content
  const getContentUrl = async (file: string): Promise<string> => {
    if (!walletAddress) throw new Error("No wallet connected.");
    const res = await fetch(`/api/content/${file}`);
    if (!res.ok) throw new Error("Failed to fetch signed URL");
    const data = await res.json();
    return data.url;
  };

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      await refreshMembership();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold text-center">
        PGP for Crypto Community
      </h1>
      {/* Scenario-driven UI based on auth, wallet linking, and membership */}
      {!ready ? (
        <p>Loading…</p>
      ) : !authenticated ? (
        // Not logged in yet
        <div className="space-y-4 text-center">
          <p>Please login to continue.</p>
          <Button
            onClick={async () => {
              const res = await signInWithSiwe();
              if (!res.ok) {
                // Redirect to email sign-in with a helpful reason and callback back to here
                const current = (() => {
                  const q = searchParams?.toString();
                  return q && q.length ? `${pathname}?${q}` : pathname || "/";
                })();
                router.push(`/signin?callbackUrl=${encodeURIComponent(current)}&reason=wallet-unlinked`);
                return;
              }
              setAuthError(null);
            }}
          >
            Login with Wallet
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const current = (() => {
                const q = searchParams?.toString();
                return q && q.length ? `${pathname}?${q}` : pathname || "/";
              })();
              router.push(`/signin?callbackUrl=${encodeURIComponent(current)}&reason=signup`);
            }}
          >
            Sign up with Email
          </Button>
          {authError && (
            <p className="text-sm text-red-600 dark:text-red-400">{authError}</p>
          )}
        </div>
      ) : !walletAddress && wallets.length === 0 ? (
        // Authenticated but no wallet linked yet
        <div className="space-y-4 text-center">
          <p>You’re signed in. Link your wallet to continue.</p>
          <Button
            onClick={async () => {
              const { linkWalletWithSiwe } = await import("@/lib/siwe/client");
              const res = await linkWalletWithSiwe();
              if (!res.ok) {
                alert(res.error || "Linking failed");
                return;
              }
              // Refresh session so walletAddress populates, which triggers membership check
              try { await update({}); } catch {}
            }}
          >
            Link Wallet
          </Button>
          <div>
            <Button variant="outline" onClick={() => signOut()}>Log Out</Button>
          </div>
        </div>
      ) : loadingMembership ? (
        <p>Checking membership…</p>
      ) : membershipStatus === "active" ? (
        // Scenario 1: linked wallet has a valid membership -> authorized
        <div className="space-y-4 text-center">
          <p>
            Hello {firstName || (session?.user as any)?.email || walletAddress || "member"}!
            You’re a member.
          </p>
          <div className="space-x-2">
            <Button
              asChild
              onClick={async (e) => {
                e.preventDefault();
                const url = await getContentUrl("index.html");
                window.open(url, "_blank");
              }}
            >
              <a href="#">View Home</a>
            </Button>
            <Button
              asChild
              onClick={async (e) => {
                e.preventDefault();
                const url = await getContentUrl("guide.html");
                window.open(url, "_blank");
              }}
            >
              <a href="#">View Guide</a>
            </Button>
            <Button
              asChild
              onClick={async (e) => {
                e.preventDefault();
                const url = await getContentUrl("faq.html");
                window.open(url, "_blank");
              }}
            >
              <a href="#">View FAQ</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/settings/profile">Edit Profile</a>
            </Button>
            <br />
            <br />
            <Button variant="outline" onClick={() => signOut()}>
              Log Out
            </Button>
          </div>
        </div>
      ) : (
        // Scenario 2: authenticated but no valid membership -> offer purchase/renew
        <div className="space-y-4 text-center">
          <p>
            Hello, {firstName || walletAddress || (session?.user as any)?.email}!{" "}
            {membershipStatus === "expired"
              ? "Your membership has expired."
              : "You need a membership."}
          </p>
          <div className="space-x-2">
            <Button onClick={purchaseMembership} disabled={isPurchasing}>
              {isPurchasing
                ? membershipStatus === "expired"
                  ? "Renewing…"
                  : "Purchasing…"
                : membershipStatus === "expired"
                ? "Renew Membership"
                : "Get Membership"}
            </Button>
            <Button onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh Status"}
            </Button>
            <Button asChild variant="outline">
              <a href="/settings/profile">Edit Profile</a>
            </Button>
            <Button variant="outline" onClick={() => signOut()}>
              Log Out
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
