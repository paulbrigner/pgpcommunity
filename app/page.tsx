// This page interacts directly with the user's browser and wallet,
// so it needs to run on the client side rather than on the server.
"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react"; // React helpers for state and lifecycle
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Paywall } from "@unlock-protocol/paywall";
import { networks } from "@unlock-protocol/networks";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  LOCK_ADDRESS,
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  UNLOCK_ADDRESS,
  USDC_ADDRESS,
  BASE_CHAIN_ID_HEX,
  BASE_BLOCK_EXPLORER_URL,
} from "@/lib/config"; // Environment-specific constants
import { Button } from "@/components/ui/button";
import { signInWithSiwe } from "@/lib/siwe/client";
import { BadgeCheck, BellRing, HeartHandshake, ShieldCheck, TicketCheck, Wallet, Key as KeyIcon } from "lucide-react";
import { OnboardingChecklist } from "@/components/site/OnboardingChecklist";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type MembershipSnapshot = {
  status: 'active' | 'expired' | 'none';
  expiry: number | null;
};

let lastKnownMembership: MembershipSnapshot | null = null;

const stripMarkdown = (value: string): string => {
  return value
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/#{1,6}\s*(.*)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^-\s+/gm, '')
    .replace(/\r?\n\r?\n/g, '\n')
    .trim();
};

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
  const sessionUser = session?.user as any | undefined;
  const walletAddress = sessionUser?.walletAddress as
    | string
    | undefined;
  const wallets = useMemo(() => {
    const list = sessionUser?.wallets;
    return Array.isArray(list) ? list.map((item) => String(item)) : [];
  }, [sessionUser]);
  const firstName = sessionUser?.firstName as string | undefined;
  const lastName = sessionUser?.lastName as string | undefined;
  const sessionMembershipStatus = sessionUser?.membershipStatus as
    | 'active'
    | 'expired'
    | 'none'
    | undefined;
  const sessionMembershipExpiry = sessionUser?.membershipExpiry as number | null | undefined;
  const profileComplete = !!(firstName && lastName);
  const walletLinked = !!(walletAddress || wallets.length > 0);
  // Membership state; 'unknown' avoids UI flicker until we hydrate from session/cache
  const [membershipStatus, setMembershipStatus] = useState<
    "active" | "expired" | "none" | "unknown"
  >("unknown");
  // Flags to show when purchase/renewal or funding actions are running
  const [isPurchasing, setIsPurchasing] = useState(false);
  
  const [membershipExpiry, setMembershipExpiry] = useState<number | null>(null);
  const [autoRenewMonths, setAutoRenewMonths] = useState<number | null>(null);
  const [autoRenewChecking, setAutoRenewChecking] = useState(false);
  const [creatorNfts, setCreatorNfts] = useState<Array<{
    owner: string;
    contractAddress: string;
    tokenId: string;
    title: string;
    description: string | null;
    subtitle?: string | null;
    image: string | null;
    collectionName: string | null;
    tokenType: string | null;
    videoUrl?: string | null;
  }> | null>(null);
  const [creatorNftsLoading, setCreatorNftsLoading] = useState(false);
  const [creatorNftsError, setCreatorNftsError] = useState<string | null>(null);
  const [openDescriptionKey, setOpenDescriptionKey] = useState<string | null>(null);
  const [missedNfts, setMissedNfts] = useState<Array<{
    contractAddress: string;
    tokenId: string;
    title: string;
    description: string | null;
    subtitle?: string | null;
    image: string | null;
    collectionName: string | null;
    tokenType: string | null;
    videoUrl?: string | null;
  }> | null>(null);
  const [upcomingNfts, setUpcomingNfts] = useState<Array<{
    contractAddress: string;
    title: string;
    description: string | null;
    subtitle?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    timezone?: string | null;
    location?: string | null;
    image: string | null;
    registrationUrl: string;
    quickCheckoutUrl: string | null;
  }> | null>(null);
  const [showAllNfts, setShowAllNfts] = useState(false);
  const [showUpcomingNfts, setShowUpcomingNfts] = useState(true);
  const [quickCheckoutUrl, setQuickCheckoutUrl] = useState<string | null>(null);
  const refreshSeq = useRef(0);
  const prevStatusRef = useRef<"active" | "expired" | "none">("none");
  const nftFetchSeq = useRef(0);
  const lastFetchedAddresses = useRef<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [autoRenewOptIn, setAutoRenewOptIn] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  // Local auth error (e.g., SIWE with unlinked wallet)
  const [authError, setAuthError] = useState<string | null>(null);

  const addressList = useMemo(() => {
    const raw = wallets && wallets.length
      ? wallets
      : walletAddress
      ? [walletAddress]
      : [];
    return raw.map((a) => String(a).toLowerCase()).filter(Boolean);
  }, [wallets, walletAddress]);
  const addressesKey = useMemo(() => addressList.join(','), [addressList]);

  useEffect(() => {
    if (!authenticated) {
      lastKnownMembership = null;
    }
  }, [authenticated]);

  // Paywall instance configured for the Base network
  const paywall = useMemo(() => {
    return new Paywall({
      ...networks,
      [BASE_NETWORK_ID]: {
        ...networks[BASE_NETWORK_ID],
        provider: BASE_RPC_URL,
      },
    });
  }, []);

  // Ensure wallet is on Base before any post‑purchase approvals
  const ensureBaseNetwork = async (eth: any) => {
    const chainHex = BASE_CHAIN_ID_HEX;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } catch (err: any) {
      if (err?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainHex,
              chainName: "Base",
              rpcUrls: [BASE_RPC_URL],
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              blockExplorerUrls: [BASE_BLOCK_EXPLORER_URL],
            },
          ],
        });
      } else {
        throw err;
      }
    }
  };

  // Check on-chain whether the session wallet has a valid membership
  const refreshMembership = useCallback(async () => {
    if (!ready || !authenticated || !(walletAddress || (wallets && wallets.length > 0))) {
      // Not enough info to check yet; preserve current state
      return;
    }

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
        lastKnownMembership = { status: effectiveStatus, expiry: preservedExpiry ?? null };
      } else {
        // stale refresh, ignore
      }
    } catch (error) {
      console.error("Membership check failed:", error);
    }
  }, [ready, authenticated, walletAddress, wallets, membershipExpiry]);

  useEffect(() => {
    // Prefer server-provided membership data via session; fall back to client cache; otherwise fetch in background
    if (!ready || !authenticated) return;
    const addresses = addressList;

    // If no linked wallets yet, we know membership cannot be verified; show onboarding immediately.
    if (!addresses.length) {
      setMembershipStatus('none');
      setMembershipExpiry(null);
      lastKnownMembership = { status: 'none', expiry: null };
      return;
    }

    if (sessionMembershipStatus) {
      const sessionStatus = sessionMembershipStatus;
      const sessionExpiry = typeof sessionMembershipExpiry === 'number' ? sessionMembershipExpiry : null;
      const fallback = lastKnownMembership;

      if (sessionStatus === 'active') {
        setMembershipStatus('active');
        setMembershipExpiry(sessionExpiry);
        lastKnownMembership = { status: 'active', expiry: sessionExpiry };
        try { prevStatusRef.current = 'active'; } catch {}
        try {
          const cache = { status: 'active', expiry: sessionExpiry ?? null, at: Math.floor(Date.now()/1000), addresses: addressesKey };
          localStorage.setItem('membershipCache', JSON.stringify(cache));
        } catch {}
        return;
      }

      if (fallback?.status === 'active') {
        // Keep showing the last confirmed active state while we re-verify.
        setMembershipStatus('active');
        setMembershipExpiry(fallback.expiry ?? null);
      } else {
        // Unknown while we re-check to avoid flashing onboarding prematurely.
        setMembershipStatus('unknown');
        setMembershipExpiry(sessionExpiry);
      }
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
          // Preserve last known good status to prevent transient downgrades
          try { if (cache.status !== 'none') { prevStatusRef.current = cache.status; } } catch {}
          lastKnownMembership = { status: cache.status, expiry: typeof cache.expiry === 'number' ? cache.expiry : null };
          // Background refresh without changing checked flag
          void refreshMembership();
          return;
        }
      }
    } catch {}

    // No session value and no usable cache: do a foreground fetch once
    void refreshMembership();
  }, [
    ready,
    authenticated,
    sessionMembershipStatus,
    sessionMembershipExpiry,
    addressList,
    addressesKey,
    refreshMembership,
  ]);

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
        const res = await fetch(`/api/nfts?addresses=${encodeURIComponent(key)}`, { cache: 'no-store' });
        const data = await res.json();
        if (nftFetchSeq.current !== seq) return;
        setCreatorNfts(Array.isArray(data?.nfts) ? data.nfts : []);
        setMissedNfts(Array.isArray(data?.missed) ? data.missed : []);
        setUpcomingNfts(
          Array.isArray(data?.upcoming)
            ? data.upcoming.map((nft: any) => ({
                contractAddress: String(nft.contractAddress),
                title: String(nft.title ?? ''),
                description: nft.description ?? null,
                subtitle: nft.subtitle ?? null,
                startTime: nft.startTime ?? null,
                endTime: nft.endTime ?? null,
                timezone: nft.timezone ?? null,
                location: nft.location ?? null,
                image: nft.image ?? null,
                registrationUrl: String(nft.registrationUrl ?? ''),
                quickCheckoutUrl: nft.quickCheckoutUrl ?? null,
              }))
            : []
        );
        setCreatorNftsError(typeof data?.error === 'string' && data.error.length ? data.error : null);
        lastFetchedAddresses.current = key;
      } catch (err: any) {
        if (nftFetchSeq.current !== seq) return;
        setCreatorNftsError(err?.message || 'Failed to load NFTs');
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
    if (!authenticated || !walletLinked || membershipStatus !== 'active') {
      setAutoRenewMonths(null);
      setAutoRenewChecking(false);
      setCreatorNfts(null);
      setCreatorNftsLoading(false);
      setCreatorNftsError(null);
      lastFetchedAddresses.current = null;
      return;
    }
    if (!USDC_ADDRESS || !LOCK_ADDRESS) {
      setAutoRenewMonths(null);
      setAutoRenewChecking(false);
      return;
    }
    const addresses = addressList;
    if (!addresses.length) {
      setAutoRenewMonths(null);
      setAutoRenewChecking(false);
      setCreatorNfts(null);
      setCreatorNftsLoading(false);
      return;
    }

    const rpcUrl = BASE_RPC_URL;
    const networkId = BASE_NETWORK_ID;
    if (!Number.isFinite(networkId)) {
      setAutoRenewMonths(null);
      setAutoRenewChecking(false);
      return;
    }

    let cancelled = false;
    setAutoRenewChecking(true);
    (async () => {
      try {
        const provider = new JsonRpcProvider(rpcUrl, networkId);
        const erc20 = new Contract(
          USDC_ADDRESS,
          ['function allowance(address owner, address spender) view returns (uint256)'],
          provider
        );
        const lock = new Contract(
          LOCK_ADDRESS,
          ['function keyPrice() view returns (uint256)'],
          provider
        );
        let price: bigint = 0n;
        try {
          price = await lock.keyPrice();
        } catch {}
        if (price <= 0n) {
          price = 100000n;
        }
        if (price <= 0n) {
          if (!cancelled) setAutoRenewMonths(null);
          return;
        }

        let maxAllowance = 0n;
        for (const addr of addresses) {
          try {
            const allowance: bigint = await erc20.allowance(addr, LOCK_ADDRESS);
            if (allowance > maxAllowance) {
              maxAllowance = allowance;
            }
          } catch {}
        }
        if (cancelled) return;

        if (maxAllowance >= price) {
          const months = Number(maxAllowance / price);
          setAutoRenewMonths(months);
        } else {
          setAutoRenewMonths(0);
        }
      } catch {
        if (!cancelled) setAutoRenewMonths(null);
      } finally {
        if (!cancelled) setAutoRenewChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated, walletLinked, addressList, addressesKey, membershipStatus]);

  useEffect(() => {
    if (!authenticated || !walletLinked || membershipStatus !== 'active') return;
    if (!addressesKey) return;
    loadCreatorNfts(addressesKey);
  }, [authenticated, walletLinked, membershipStatus, addressesKey, loadCreatorNfts]);

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
      // If opted‑in, pre‑approve up to 12 periods BEFORE opening checkout so checkout only needs a single tx
      if (autoRenewOptIn && USDC_ADDRESS && LOCK_ADDRESS) {
        try {
          await ensureBaseNetwork(provider);
          const bp = new BrowserProvider(provider, BASE_NETWORK_ID);
          const signer = await bp.getSigner();
          const erc20 = new Contract(
            USDC_ADDRESS,
            [ 'function approve(address spender, uint256 amount) returns (bool)' ],
            signer
          );
          const erc20Reader = new Contract(
            USDC_ADDRESS,
            [ 'function allowance(address owner, address spender) view returns (uint256)' ],
            bp
          );
          const lock = new Contract(
            LOCK_ADDRESS,
            [ 'function keyPrice() view returns (uint256)' ],
            bp
          );
          // Fetch current key price and compute one‑year cap
          let price: bigint = 0n;
          try { price = await lock.keyPrice(); } catch {}
          if (price <= 0n) price = 100000n; // 0.10 USDC default
          const targetAllowance = price * 12n;
          const owner = await signer.getAddress();
          const current: bigint = await erc20Reader.allowance(owner, LOCK_ADDRESS);
          if (current < targetAllowance) {
            const tx = await erc20.approve(LOCK_ADDRESS, targetAllowance);
            await tx.wait();
          }
        } catch (e) {
          console.error('Pre‑checkout auto‑renew approval failed:', e);
          // Continue to checkout anyway; user can still purchase without the higher allowance
        }
      }

      await paywall.connect(provider);
      // Prevent Unlock from navigating; we'll control refresh ourselves.
      const checkoutConfig = { ...PAYWALL_CONFIG } as any;
      delete checkoutConfig.redirectUri;
      await paywall.loadCheckoutModal(checkoutConfig);

      // After the modal closes, verify purchase succeeded on-chain (retry briefly)
      const addresses = (wallets && wallets.length
        ? wallets
        : walletAddress
        ? [walletAddress]
        : []
      ).map((a) => String(a).toLowerCase());
      if (addresses.length) {
        for (let i = 0; i < 5; i++) {
          try {
            const resp = await fetch(`/api/membership/expiry?addresses=${encodeURIComponent(addresses.join(','))}`, { cache: 'no-store' });
            if (resp.ok) {
              const { status, expiry } = await resp.json();
              const nowSec = Math.floor(Date.now() / 1000);
              if (status === 'active' || (typeof expiry === 'number' && expiry > nowSec)) {
                break;
              }
            }
          } catch {}
          // small delay before retry
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
      // After the modal closes, refresh membership status in-place (no logout)
      try {
        await refreshMembership();
      } catch {}
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
      <AlertDialog open={!!quickCheckoutUrl} onOpenChange={(open) => { if (!open) setQuickCheckoutUrl(null); }}>
        <AlertDialogContent className="max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Quick Registration</AlertDialogTitle>
            <AlertDialogDescription>
              Complete your registration without leaving this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {quickCheckoutUrl ? (
            <iframe
              key={quickCheckoutUrl}
              src={quickCheckoutUrl}
              title="Unlock Protocol Checkout"
              className="h-[600px] w-full rounded-md border"
              loading="lazy"
              allow="payment"
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setQuickCheckoutUrl(null)}>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
            viewerUrl ? (
              <div className="grid gap-4 md:grid-cols-2">
                {/* Inline Viewer Only */}
                <div className="rounded-lg border md:col-span-2 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
                    <div className="text-sm text-muted-foreground truncate">Member Content Viewer</div>
                    <Button size="sm" variant="outline" onClick={() => setViewerUrl(null)}>
                      Close
                    </Button>
                  </div>
                  <iframe
                    title="Member content"
                    src={viewerUrl}
                    className="w-full h-[70vh]"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {/* Membership Card */}
                <div className="rounded-lg border p-4 space-y-2">
                  <h2 className="text-lg font-semibold">Membership</h2>
                  <p className="text-sm text-muted-foreground">
                    {typeof membershipExpiry === 'number' && membershipExpiry > 0
                      ? `Active until ${new Date(membershipExpiry * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                      : 'Active'}
                  </p>
                  {autoRenewChecking ? (
                    <p className="text-sm text-muted-foreground">Checking auto-renew allowance…</p>
                  ) : typeof autoRenewMonths === 'number' && autoRenewMonths > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Auto-renew approved for {autoRenewMonths === 1 ? '1 month' : `${autoRenewMonths} months`}.
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Your membership can renew automatically at expiration when your wallet holds enough USDC for the fee and a small amount of ETH for gas. You can enable or stop auto‑renew anytime from the Edit Profile page.
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
                        setViewerUrl(url);
                      }}
                    >
                      <a href="#">View Home</a>
                    </Button>
                    <Button
                      asChild
                      onClick={async (e) => {
                        e.preventDefault();
                        const url = await getContentUrl("guide.html");
                        setViewerUrl(url);
                      }}
                    >
                      <a href="#">View Guide</a>
                    </Button>
                    <Button
                      asChild
                      onClick={async (e) => {
                        e.preventDefault();
                        const url = await getContentUrl("faq.html");
                        setViewerUrl(url);
                      }}
                    >
                      <a href="#">View FAQ</a>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Experimental preview: these links stream HTML content that normally lives behind our member gate. We only fetch the page when you are logged in, the server-side API confirms your session and active membership, and it returns a short-lived, path-scoped CloudFront URL. That signed URL expires quickly, so the file stays private to authenticated members.
                  </p>
                </div>

                {upcomingNfts && upcomingNfts.length > 0 ? (
                  <div className="rounded-lg border p-4 space-y-3 md:col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-lg font-semibold">Upcoming PGP Meetings</h2>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={showUpcomingNfts}
                          onChange={(e) => setShowUpcomingNfts(e.target.checked)}
                        />
                        Show upcoming events
                      </label>
                    </div>
                    {showUpcomingNfts ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {[...upcomingNfts]
                          .sort((a, b) => {
                            const titleA = a.title?.toLowerCase() ?? '';
                            const titleB = b.title?.toLowerCase() ?? '';
                            if (titleA > titleB) return -1;
                            if (titleA < titleB) return 1;
                            return 0;
                          })
                          .map((nft) => {
                            return (
                              <div key={`upcoming-${nft.contractAddress}`} className="flex gap-3 rounded-md border bg-muted/40 p-3">
                                {nft.image ? (
                                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={nft.image} alt={nft.title} className="h-full w-full object-cover" />
                                  </div>
                                ) : (
                                  <div className="h-20 w-20 shrink-0 rounded-md bg-muted" />
                                )}
                                <div className="min-w-0 space-y-1">
                                  <div className="font-medium truncate">{nft.title}</div>
                                  {nft.subtitle ? (
                                    <div className="text-xs text-muted-foreground">Date: {nft.subtitle}</div>
                                  ) : null}
                                  {nft.startTime || nft.endTime ? (
                                    <div className="text-xs text-muted-foreground">
                                      Time: {nft.startTime ?? 'TBD'}
                                      {nft.endTime ? ` - ${nft.endTime}` : ''}
                                      {nft.timezone ? ` (${nft.timezone})` : ''}
                                    </div>
                                  ) : null}
                                  {nft.location ? (
                                    <div className="text-xs text-muted-foreground whitespace-pre-wrap">Location: {nft.location}</div>
                                  ) : null}
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <a
                                      href={nft.registrationUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-primary hover:underline"
                                    >
                                      View event details
                                    </a>
                                    {nft.quickCheckoutUrl ? (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        className="text-xs"
                                        onClick={() => setQuickCheckoutUrl(nft.quickCheckoutUrl as string)}
                                      >
                                        Quick Register
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Turn on to see upcoming meetings available for registration.</p>
                    )}
                  </div>
                ) : null}

                {/* NFT/POAPs (placeholder) */}
                <div className="rounded-lg border p-4 space-y-3 md:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold">
                      {showAllNfts ? 'All PGP NFTs' : 'Your PGP NFT Collection'}
                    </h2>
                    {missedNfts && missedNfts.length > 0 ? (
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={showAllNfts}
                          onChange={(e) => setShowAllNfts(e.target.checked)}
                        />
                        Show meetings you missed
                      </label>
                    ) : null}
                  </div>
                  {creatorNftsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading your collection…</p>
                  ) : creatorNftsError ? (
                    <p className="text-sm text-red-600 dark:text-red-400">{creatorNftsError}</p>
                  ) : creatorNfts && creatorNfts.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(showAllNfts && missedNfts
                        ? [...creatorNfts, ...missedNfts]
                            .sort((a, b) => {
                              const titleA = a.title?.toLowerCase() ?? '';
                              const titleB = b.title?.toLowerCase() ?? '';
                              if (titleA > titleB) return -1;
                              if (titleA < titleB) return 1;
                              const dateA = a.subtitle?.toLowerCase() ?? '';
                              const dateB = b.subtitle?.toLowerCase() ?? '';
                              if (dateA > dateB) return -1;
                              if (dateA < dateB) return 1;
                              const idA = a.tokenId?.toLowerCase() ?? '';
                              const idB = b.tokenId?.toLowerCase() ?? '';
                              if (idA > idB) return -1;
                              if (idA < idB) return 1;
                              return 0;
                            })
                        : creatorNfts).map((nft) => {
                        const displayId = nft.tokenId?.startsWith('0x')
                          ? (() => {
                              try {
                                return BigInt(nft.tokenId).toString();
                              } catch {
                                return nft.tokenId;
                              }
                            })()
                          : nft.tokenId ?? '';
                        const explorerBase = BASE_BLOCK_EXPLORER_URL.replace(/\/$/, "");
                        const explorerUrl = nft.tokenId
                          ? `${explorerBase}/token/${nft.contractAddress}?a=${encodeURIComponent(displayId)}`
                          : `${explorerBase}/address/${nft.contractAddress}`;
                        const isOwned = creatorNfts.some((owned) => owned.contractAddress === nft.contractAddress && owned.tokenId === nft.tokenId && owned.owner);
                        const subtitle = (() => {
                          const text = (nft.subtitle || nft.collectionName || nft.description || '').trim();
                          if (!text) return null;
                          const normalizedTitle = nft.title?.trim().toLowerCase();
                          const normalizedText = text.toLowerCase();
                          if (normalizedTitle && normalizedTitle === normalizedText) return null;
                          if (text.length > 80) return null;
                          return text;
                        })();
                        const shortenedDescription = (() => {
                          const source = (() => {
                            const desc = nft.description?.trim();
                            if (desc && desc.length) return desc;
                            const sub = nft.subtitle?.trim();
                            if (sub && sub.length) return sub;
                            const collection = nft.collectionName?.trim();
                            if (collection && collection.length) return collection;
                            return '';
                          })();
                          if (!source) return null;
                          const plain = stripMarkdown(source);
                          if (!plain) return null;
                          const preview = plain.length > 140 ? `${plain.slice(0, 140)}…` : plain;
                          const enrichedMarkdown = source.replace(/(^|\s)(https?:\/\/[^\s)]+)/g, (match, prefix, url, offset, str) => {
                            // Avoid wrapping existing markdown links
                            const before = str.slice(0, offset + prefix.length);
                            if (/\[[^\]]*$/.test(before)) return match;
                            return `${prefix}[${url}](${url})`;
                          });
                          return {
                            preview,
                            fullMarkdown: enrichedMarkdown,
                          } as const;
                        })();
                        const ownerKey = 'owner' in nft && nft.owner ? nft.owner : 'none';
                        const tokenIdKey = nft.tokenId ?? 'upcoming';
                        const descriptionKey = `${nft.contractAddress}-${tokenIdKey}-${ownerKey}-description`;
                        const isDescriptionOpen = openDescriptionKey === descriptionKey;
                        return (
                          <div
                            key={`${nft.contractAddress}-${tokenIdKey}-${ownerKey}`}
                            className={`flex gap-3 rounded-md border p-3 ${
                              isOwned ? '' : 'bg-slate-100 dark:bg-slate-800/40'
                            }`}
                          >
                            {nft.image ? (
                              <a
                                href={explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={nft.image} alt={nft.title} className="h-full w-full object-cover" />
                              </a>
                            ) : (
                              <a
                                href={explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="h-20 w-20 shrink-0 rounded-md bg-muted"
                              />
                            )}
                            <div className="min-w-0 space-y-1">
                              <div className="font-medium truncate">{nft.title}</div>
                              {subtitle ? (
                                <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
                              ) : null}
                              {displayId ? (
                                <div className="text-xs text-muted-foreground truncate">Token #{displayId}</div>
                              ) : null}
                              {shortenedDescription ? (
                                <div className="text-xs text-muted-foreground">
                                  {isDescriptionOpen ? (
                                    <div className="space-y-2">
                                      <div className="prose prose-sm dark:prose-invert max-w-none">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                          {shortenedDescription.fullMarkdown}
                                        </ReactMarkdown>
                                      </div>
                                      <button
                                        type="button"
                                        className="text-xs text-primary hover:underline focus-visible:outline-none"
                                        onClick={() => setOpenDescriptionKey(null)}
                                      >
                                        Hide description
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      className="text-left text-xs text-primary hover:underline focus-visible:outline-none"
                                      onClick={() => setOpenDescriptionKey(descriptionKey)}
                                    >
                                      {shortenedDescription.preview}
                                    </button>
                                  )}
                                </div>
                              ) : null}
                              {nft.videoUrl ? (
                                <div>
                                  <a
                                    href={nft.videoUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-primary hover:underline"
                                  >
                                    Watch Video
                                  </a>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
            </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No creator NFTs or POAPs detected yet. Join community events to start collecting!
                    </p>
                  )}
                </div>

                {/* News / Updates (placeholder) */}
                <div className="rounded-lg border p-4 space-y-2 md:col-span-2">
                  <h2 className="text-lg font-semibold">News & Updates</h2>
                  <p className="text-sm text-muted-foreground">Member announcements and updates will appear here.</p>
                </div>
              </div>
            )
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
            <label className="flex items-center gap-2 text-sm mt-2">
              <input
                type="checkbox"
                checked={autoRenewOptIn}
                onChange={(e) => setAutoRenewOptIn(e.target.checked)}
              />
              Enable auto‑renew (authorize up to one year of renewals)
            </label>
            {autoRenewOptIn && (
              <div className="text-xs text-muted-foreground">
                When enabled, you may see an approval prompt before checkout so the purchase can complete in a single transaction.
              </div>
            )}
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
