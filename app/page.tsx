// This page interacts directly with the user's browser and wallet,
// so it needs to run on the client side rather than on the server.
"use client";

import { useState, useEffect, useMemo, useRef } from "react"; // React helpers for state and lifecycle
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
import { checkMembership as fetchMembership, getMembershipExpiration } from "@/lib/membership"; // Helper functions for membership logic
import { Button } from "@/components/ui/button";
import { signInWithSiwe } from "@/lib/siwe/client";
import { BadgeCheck, BellRing, CalendarClock, HeartHandshake, ShieldCheck, TicketCheck, Wallet, Key as KeyIcon } from "lucide-react";
import { OnboardingChecklist } from "@/components/site/OnboardingChecklist";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const PAYWALL_CONFIG = {
  icon: "",
  locks: {
    [LOCK_ADDRESS]: {
      name: "PGP Community Membership",
      order: 0,
      network: BASE_NETWORK_ID,
      recipient: "",
      dataBuilder: "",
      emailRequired: false,
      maxRecipients: null,
    },
  },
  title: "Join the PGP* for Crypto Community",
  referrer: UNLOCK_ADDRESS,
  skipSelect: true,
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
  const lastName = (session?.user as any)?.lastName as string | undefined;
  const profileComplete = !!(firstName && lastName);
  const walletLinked = !!(walletAddress || wallets.length > 0);
  // Membership state; 'unknown' avoids UI flicker until we hydrate from session/cache
  const [membershipStatus, setMembershipStatus] = useState<
    "active" | "expired" | "none" | "unknown"
  >("unknown");
  // Indicates whether we are currently checking membership status
  const [loadingMembership, setLoadingMembership] = useState(false);
  const [checkedMembership, setCheckedMembership] = useState(false);
  // Flags to show when purchase/renewal or funding actions are running
  const [isPurchasing, setIsPurchasing] = useState(false);
  
  const [membershipExpiry, setMembershipExpiry] = useState<number | null>(null);
  const refreshSeq = useRef(0);
  const prevStatusRef = useRef<"active" | "expired" | "none">("none");
  const [confirmOpen, setConfirmOpen] = useState(false);

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
    if (!ready || !authenticated || !(walletAddress || (wallets && wallets.length > 0))) {
      // Not enough info to check yet; preserve current state
      return;
    }

    setLoadingMembership(true);
    const seq = ++refreshSeq.current;
    try {
      const addresses = wallets && wallets.length
        ? wallets.map((a) => String(a).toLowerCase())
        : [String(walletAddress) as string];
      // initiate refresh via server API
      const resp = await fetch(`/api/membership/expiry?addresses=${encodeURIComponent(addresses.join(','))}`, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`expiry API: ${resp.status}`);
      const { expiry, status } = await resp.json();
      // Only apply if this is the latest refresh
      if (seq === refreshSeq.current) {
        // Prefer fresh expiry if present; otherwise keep prior future-dated expiry
        const preservedExpiry =
          (typeof expiry === 'number' && expiry > 0)
            ? expiry
            : (membershipExpiry && membershipExpiry * 1000 > Date.now() ? membershipExpiry : null);

        setMembershipExpiry(preservedExpiry);
        const nowSec = Math.floor(Date.now() / 1000);
        const derived = typeof preservedExpiry === 'number' && preservedExpiry > 0
          ? (preservedExpiry > nowSec ? 'active' : 'expired')
          : undefined;
        let effectiveStatus = (derived ?? status) as "active" | "expired" | "none";
        // Avoid downgrading to 'none' on transient RPC failures if we previously knew better
        if (effectiveStatus === 'none' && prevStatusRef.current !== 'none') {
          effectiveStatus = prevStatusRef.current;
        }
        setMembershipStatus(effectiveStatus);
        // Persist a short-lived client cache to minimize re-checks
        try {
          const cache = { status: effectiveStatus, expiry: preservedExpiry, at: Math.floor(Date.now()/1000), addresses: addresses.join(',') };
          localStorage.setItem('membershipCache', JSON.stringify(cache));
        } catch {}
        prevStatusRef.current = effectiveStatus;
      } else {
        // stale refresh, ignore
      }
    } catch (error) {
      console.error("Membership check failed:", error);
    } finally {
      setLoadingMembership(false);
      setCheckedMembership(true);
    }
  };

  useEffect(() => {
    // Prefer server-provided membership data via session; fall back to client cache; otherwise fetch in background
    if (!ready || !authenticated) return;
    const su: any = session?.user || {};
    const addresses = (wallets && wallets.length ? wallets : walletAddress ? [walletAddress] : []).map((a) => String(a).toLowerCase());
    const addressesKey = addresses.join(',');

    // If no linked wallets yet, we know membership cannot be verified; show onboarding immediately.
    if (!addresses.length) {
      setMembershipStatus('none');
      setMembershipExpiry(null);
      setCheckedMembership(true);
      return;
    }

    if (su.membershipStatus) {
      setMembershipStatus(su.membershipStatus);
      setMembershipExpiry(typeof su.membershipExpiry === 'number' ? su.membershipExpiry : null);
      setCheckedMembership(true);
      // Remember last known good status to avoid transient downgrades
      try { if (su.membershipStatus !== 'none') { prevStatusRef.current = su.membershipStatus; } } catch {}
      // Prime client cache
      try {
        const cache = { status: su.membershipStatus, expiry: su.membershipExpiry ?? null, at: Math.floor(Date.now()/1000), addresses: addressesKey };
        localStorage.setItem('membershipCache', JSON.stringify(cache));
      } catch {}
      return;
    }

    // Try client cache (5 min TTL)
    try {
      const raw = localStorage.getItem('membershipCache');
      if (raw) {
        const cache = JSON.parse(raw || '{}');
        const age = Math.floor(Date.now()/1000) - (cache?.at || 0);
        if (cache?.addresses === addressesKey && age < 300 && cache?.status) {
          setMembershipStatus(cache.status);
          setMembershipExpiry(typeof cache.expiry === 'number' ? cache.expiry : null);
          setCheckedMembership(true);
          // Preserve last known good status to prevent transient downgrades
          try { if (cache.status !== 'none') { prevStatusRef.current = cache.status; } } catch {}
          // Background refresh without changing checked flag
          refreshMembership();
          return;
        }
      }
    } catch {}

    // No session value and no usable cache: do a foreground fetch once
    refreshMembership();
  }, [ready, authenticated, (session as any)?.user?.membershipStatus, (session as any)?.user?.membershipExpiry, walletAddress, wallets]);

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
      // After the modal closes, clear any cached membership and sign out to force a clean session
      try { localStorage.removeItem('membershipCache'); } catch {}
      await signOut({ callbackUrl: '/' });
      return;
    } catch (error) {
      console.error("Purchase failed:", error);
    } finally {
      setIsPurchasing(false);
    }
  };

  // Ask the backend for a short-lived signed URL to view gated content
  const getContentUrl = async (file: string): Promise<string> => {
    const res = await fetch(`/api/content/${file}`);
    if (!res.ok) throw new Error("Failed to fetch signed URL");
    const data = await res.json();
    return data.url;
  };

  

  return (
    <div className="mx-auto p-6 space-y-6">
      <h1 className="text-3xl md:text-4xl font-bold text-center">
        PGP for Crypto Community
      </h1>
      {/* Scenario-driven UI based on auth, wallet linking, and membership */}
      {!ready ? (
        <p className="text-center">Loading…</p>
      ) : !authenticated ? (
        // Not logged in yet — Landing & Benefits
        <div className="mx-auto max-w-4xl space-y-10">
          <section className="text-center space-y-4">
            <p className="text-lg text-muted-foreground">
              Join a community of privacy and crypto enthusiasts. Support PGP efforts, collect meeting NFTs, and get insider updates.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
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
                className="w-full sm:w-auto"
              >
                <Wallet className="mr-2 h-4 w-4" /> Sign In with Wallet
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
                className="w-full sm:w-auto"
              >
                Sign up with Email
              </Button>
            </div>
            {authError && (
              <p className="text-sm text-red-600 dark:text-red-400">{authError}</p>
            )}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-lg border p-4">
              <HeartHandshake className="h-5 w-5 mt-0.5 text-primary" />
              <div>
                <h3 className="font-medium">Support the PGP Community</h3>
                <p className="text-sm text-muted-foreground">Your membership helps sustain open, privacy‑preserving tooling and community events.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border p-4">
              <TicketCheck className="h-5 w-5 mt-0.5 text-primary" />
              <div>
                <h3 className="font-medium">Track Meeting POAPs/NFTs</h3>
                <p className="text-sm text-muted-foreground">Automatically collect and showcase proof of attendance and meeting NFTs.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border p-4">
              <BellRing className="h-5 w-5 mt-0.5 text-primary" />
              <div>
                <h3 className="font-medium">Insider Updates</h3>
                <p className="text-sm text-muted-foreground">Be first to hear about upcoming meetings, demos, and releases.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border p-4">
              <ShieldCheck className="h-5 w-5 mt-0.5 text-primary" />
              <div>
                <h3 className="font-medium">Member‑Only Content</h3>
                <p className="text-sm text-muted-foreground">Access gated guides, recordings, and resources when your membership is active.</p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border p-4">
            <h3 className="font-semibold mb-2">How it works</h3>
            <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 text-sm">
              <li className="flex items-start gap-2">
                <BadgeCheck className="h-5 w-5 shrink-0 mt-0.5 text-primary" />
                <div>
                  <div className="font-medium">Create your account</div>
                  <div className="text-muted-foreground">Sign in with your wallet or email.</div>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <Wallet className="h-5 w-5 shrink-0 mt-0.5 text-primary" />
                <div>
                  <div className="font-medium">Link a wallet</div>
                  <div className="text-muted-foreground">Use it for NFTs, donations, and access.</div>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <KeyIcon className="h-5 w-5 shrink-0 mt-0.5 text-primary" />
                <div>
                  <div className="font-medium">Activate membership</div>
                  <div className="text-muted-foreground">Purchase the PGP Unlock membership.</div>
                </div>
              </li>
              
            </ul>
            <div className="mt-4 text-sm text-muted-foreground">
              This site uses the open‑source, Web3‑based Unlock Protocol to issue and verify memberships. When you buy a membership, Unlock mints a time‑limited key (NFT) to your wallet. We verify your active key on‑chain to grant access to member‑only pages and features. When your key expires, you can renew to continue access. <a className="underline hover:text-foreground" href="https://unlock-protocol.com/" target="_blank" rel="noreferrer">Learn more about Unlock Protocol</a>.
            </div>
          </section>
        </div>
      ) : membershipStatus === "unknown" ? (
        // If wallet is not linked yet, show onboarding; otherwise neutral placeholder during hydration
        !walletLinked ? (
          <div className="mx-auto max-w-4xl space-y-6">
            <OnboardingChecklist
              walletLinked={false}
              profileComplete={!!(firstName && lastName)}
              membershipStatus="none"
            />
          </div>
        ) : (
          <div className="mx-auto max-w-4xl" />
        )
      ) : membershipStatus === "active" ? (
        // Scenario 1: linked wallet has a valid membership -> authorized
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="text-center">
            <p>
              Hello {firstName || (session?.user as any)?.email || walletAddress || "member"}! You’re a member.
            </p>
          </div>
          {walletLinked && profileComplete ? (
            <div className="grid gap-4 md:grid-cols-2">
              {/* Membership Card */}
              <div className="rounded-lg border p-4 space-y-2">
                <h2 className="text-lg font-semibold">Membership</h2>
                <p className="text-sm text-muted-foreground">
                  {typeof membershipExpiry === 'number' && membershipExpiry > 0
                    ? `Active until ${new Date(membershipExpiry * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                    : 'Active'}
                </p>
                <p className="text-xs text-muted-foreground">
                  This membership can renew automatically at expiration when your wallet holds enough USDC for the fee and a small amount of ETH for gas.
                </p>
              </div>

              {/* Member Tools */}
              <div className="rounded-lg border p-4 space-y-3">
                <h2 className="text-lg font-semibold">Member Tools</h2>
                <div className="flex flex-wrap items-center gap-2">
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
                </div>
              </div>

              {/* Donations (placeholder) */}
              <div className="rounded-lg border p-4 space-y-2">
                <h2 className="text-lg font-semibold">Donations</h2>
                <p className="text-sm text-muted-foreground">Support the PGP Community. Donation options coming soon.</p>
              </div>

              {/* NFT/POAPs (placeholder) */}
              <div className="rounded-lg border p-4 space-y-2">
                <h2 className="text-lg font-semibold">NFT / POAPs</h2>
                <p className="text-sm text-muted-foreground">Your collected meeting NFTs/POAPs will appear here.</p>
              </div>

              {/* News / Updates (placeholder) */}
              <div className="rounded-lg border p-4 space-y-2 md:col-span-2">
                <h2 className="text-lg font-semibold">News & Updates</h2>
                <p className="text-sm text-muted-foreground">Member announcements and updates will appear here.</p>
              </div>
            </div>
          ) : (
            <OnboardingChecklist
              walletLinked={walletLinked}
              profileComplete={profileComplete}
              membershipStatus="active"
            />
          )}
        </div>
      ) : !walletLinked ? (
        // Authenticated but wallet not linked (after hydration)
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="text-center">
            <p>
              Hello {firstName || (session?.user as any)?.email || "there"}! Link your wallet to continue.
            </p>
          </div>
          <OnboardingChecklist
            walletLinked={false}
            profileComplete={!!(firstName && lastName)}
            membershipStatus="none"
          />
        </div>
      ) : (
        // Scenario 2: authenticated but no valid membership -> offer purchase/renew
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="text-center">
            <p>
              Hello, {firstName || walletAddress || (session?.user as any)?.email}! {membershipStatus === "expired" ? "Your membership has expired." : "You need a membership."}
            </p>
          </div>
          <OnboardingChecklist
            walletLinked={walletLinked}
            profileComplete={!!(firstName && lastName)}
            membershipStatus={membershipStatus}
            onPurchaseMembership={() => setConfirmOpen(true)}
            purchasing={isPurchasing}
          />
        </div>
      )}
      {/* Purchase/Renew prerequisites dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Before you continue</AlertDialogTitle>
            <AlertDialogDescription>
              Review wallet requirements before continuing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 text-left">
            <div>What to have in your wallet:</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>USDC (Base): 0.10 USDC for the membership itself.</li>
              <li>ETH (Base): a tiny amount for gas; keep ~0.00001–0.00005 ETH to cover the approval + purchase and future renewals.</li>
            </ul>
            <div>
              <strong>Price reference:</strong> The lock is priced in USDC and the last price‑update sets it to 0.10 USDC. Each renewal adds ~30 days.
            </div>
            <div>
              <strong>First time only:</strong> you may see two on‑chain steps—Approve USDC (gas only) then Purchase (0.10 USDC + gas).
            </div>
            <div>That’s it—0.10 USDC for the membership, plus pennies of ETH for gas.</div>
            <div className="text-xs text-muted-foreground">
              Note: If your wallet has sufficient USDC and a bit of ETH for gas when your current period ends, the membership can renew automatically.
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); purchaseMembership(); }}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
