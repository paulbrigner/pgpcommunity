// This page interacts directly with the user's browser and wallet,
// so it needs to run on the client side rather than on the server.
"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react"; // React helpers for state and lifecycle
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { BrowserProvider, Contract } from "ethers";
import {
  MEMBERSHIP_TIERS,
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  USDC_ADDRESS,
  BASE_CHAIN_ID_HEX,
  BASE_BLOCK_EXPLORER_URL,
} from "@/lib/config"; // Environment-specific constants
import { useUnlockCheckout } from "@/lib/unlock-checkout";
import type { MembershipSummary, TierMembershipSummary } from "@/lib/membership-server";
import { snapshotToMembershipSummary, type AllowanceState } from "@/lib/membership-state-service";
import { fetchMembershipStateSnapshot } from "@/app/actions/membership-state";
import { findTierInSummary, normalizeTierId, pickHighestActiveTier, resolveTierLabel } from "@/lib/membership-tiers";
import { useEventRegistration } from "@/lib/hooks/use-event-registration";
import { useMemberNfts } from "@/lib/hooks/use-member-nfts";
import { AutoRenewPendingPanel, AutoRenewPromptPanel, ActiveMemberPanel } from "@/components/home/MembershipPanels";
import { Button } from "@/components/ui/button";
import { signInWithSiwe } from "@/lib/siwe/client";
import { BadgeCheck, BellRing, HeartHandshake, ShieldCheck, TicketCheck, Wallet, Key as KeyIcon } from "lucide-react";
import { OnboardingChecklist } from "@/components/site/OnboardingChecklist";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

type HomeClientProps = {
  initialMembershipSummary: MembershipSummary | null;
  initialMembershipStatus?: "active" | "expired" | "none" | "unknown";
  initialMembershipExpiry?: number | null;
  initialAllowances?: Record<string, AllowanceState>;
  initialTokenIds?: Record<string, string[]>;
};

type MembershipSnapshot = {
  status: 'active' | 'expired' | 'none';
  expiry: number | null;
  summary?: MembershipSummary | null;
};

let lastKnownMembership: MembershipSnapshot | null = null;

const MAX_AUTO_RENEW_MONTHS = 12;
const SAFE_ALLOWANCE_CAP = 2n ** 200n;

const computeAutoRenewAllowance = (price: bigint): bigint => {
  if (price <= 0n) {
    throw new Error('Tier price unavailable');
  }
  const target = price * BigInt(MAX_AUTO_RENEW_MONTHS);
  if (target >= SAFE_ALLOWANCE_CAP) {
    throw new Error('Refusing to request an unlimited allowance. Please refresh and try again.');
  }
  return target;
};

const formatAddressShort = (value: string | null | undefined): string => {
  if (!value) return 'N/A';
  const normalized = value.toLowerCase();
  if (normalized.length <= 10) return normalized;
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
};

export default function HomeClient({
  initialMembershipSummary,
  initialMembershipStatus = "unknown",
  initialMembershipExpiry = null,
  initialAllowances = {},
  initialTokenIds = {},
}: HomeClientProps) {
  // NextAuth session
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const authenticated = status === "authenticated";
  const ready = status !== "loading";
  const sessionUser = session?.user as any | undefined;
  const [currentTierOverride, setCurrentTierOverride] = useState<string | null | undefined>(undefined);
  const [allowances, setAllowances] = useState<Record<string, AllowanceState>>(initialAllowances ?? {});
  const [tokenIds, setTokenIds] = useState<Record<string, string[]>>(initialTokenIds ?? {});
  const walletAddress = sessionUser?.walletAddress as string | undefined;
  const wallets = useMemo(() => {
    const list = sessionUser?.wallets;
    return Array.isArray(list) ? list.map((item) => String(item)) : [];
  }, [sessionUser]);
  const firstName = sessionUser?.firstName as string | undefined;
  const lastName = sessionUser?.lastName as string | undefined;
  const profileComplete = !!(firstName && lastName);
  const walletLinked = !!(walletAddress || wallets.length > 0);
  // Membership state; 'unknown' avoids UI flicker until we hydrate from session/cache
const [membershipStatus, setMembershipStatus] = useState<
  "active" | "expired" | "none" | "unknown"
>(initialMembershipStatus ?? 'unknown');
// Flags to show when purchase/renewal or funding actions are running
const [isPurchasing, setIsPurchasing] = useState(false);

const [membershipSummary, setMembershipSummary] = useState<MembershipSummary | null>(initialMembershipSummary ?? null);
const [membershipExpiry, setMembershipExpiry] = useState<number | null>(initialMembershipExpiry ?? null);
  const [autoRenewMonths, setAutoRenewMonths] = useState<number | null>(null);
  const [autoRenewStateReady, setAutoRenewStateReady] = useState(false);
  const [showAllNfts, setShowAllNfts] = useState(false);
  const [showUpcomingNfts, setShowUpcomingNfts] = useState(true);
  const refreshSeq = useRef(0);
  const prevStatusRef = useRef<"active" | "expired" | "none">("none");
  const membershipResolvedRef = useRef(false);
  const previousSummaryRef = useRef<MembershipSummary | null>(initialMembershipSummary ?? null);
  const initialMembershipAppliedRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [autoRenewPromptDismissed, setAutoRenewPromptDismissed] = useState(false);
  const [autoRenewProcessing, setAutoRenewProcessing] = useState(false);
  const [autoRenewMessage, setAutoRenewMessage] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  // Local auth error (e.g., SIWE with unlinked wallet)
  const [authError, setAuthError] = useState<string | null>(null);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);

  const addressList = useMemo(() => {
    const raw = wallets && wallets.length
      ? wallets
      : walletAddress
      ? [walletAddress]
      : [];
    return raw.map((a) => String(a).toLowerCase()).filter(Boolean);
  }, [wallets, walletAddress]);
  const addressesKey = useMemo(() => addressList.join(','), [addressList]);

  const autoRenewEnabled = typeof autoRenewMonths === 'number' && autoRenewMonths > 0;
  const effectiveCurrentTierId = currentTierOverride !== undefined ? currentTierOverride : null;
  const currentTier = useMemo<TierMembershipSummary | null>(() => {
    const explicit = findTierInSummary(membershipSummary, effectiveCurrentTierId ?? undefined);
    if (explicit) return explicit;
    return pickHighestActiveTier(membershipSummary);
  }, [membershipSummary, effectiveCurrentTierId]);

  const normalizedSelectedTierId = useMemo(() => normalizeTierId(selectedTierId ?? null), [selectedTierId]);
  const selectedTierConfig = useMemo(() => {
    if (!normalizedSelectedTierId) return null;
    return (
      MEMBERSHIP_TIERS.find((tier) => {
        const keys = [tier.id, tier.address, tier.checksumAddress]
          .map((value) => (value ? String(value).toLowerCase() : ""))
          .filter(Boolean);
        return keys.includes(normalizedSelectedTierId);
      }) ?? null
    );
  }, [normalizedSelectedTierId]);
  useEffect(() => {
    if (!MEMBERSHIP_TIERS.length) return;
    if (selectedTierConfig && normalizedSelectedTierId) return;

    const highest = pickHighestActiveTier(membershipSummary);
    const fallback =
      normalizeTierId(
        highest?.tier.id ??
          highest?.tier.address ??
          MEMBERSHIP_TIERS[0]?.id ??
          MEMBERSHIP_TIERS[0]?.address ??
          null,
      ) ?? null;
    if (fallback && fallback !== normalizedSelectedTierId) {
      setSelectedTierId(fallback);
    }
  }, [membershipSummary, normalizedSelectedTierId, selectedTierConfig]);

  useEffect(() => {
    setAllowances(initialAllowances ?? {});
    setTokenIds(initialTokenIds ?? {});
  }, [initialAllowances, initialTokenIds]);
  const currentTierLabel = useMemo(
    () => resolveTierLabel(currentTier, effectiveCurrentTierId),
    [currentTier, effectiveCurrentTierId]
  );
  const memberLevelLabel = currentTierLabel || 'PGP';
  const renewalTier = useMemo<TierMembershipSummary | null>(() => {
    if (currentTier?.status === 'active') return currentTier;
    return null;
  }, [currentTier]);
  const renewalTierAddress = renewalTier?.tier.checksumAddress ?? null;
  const renewalTierLabel = resolveTierLabel(renewalTier, renewalTier?.tier.id);
  const dismissAutoRenewMessage = useCallback(() => {
    setAutoRenewMessage(null);
    setAutoRenewPromptDismissed(true);
  }, []);
  const persistTierSelection = useCallback(
    (values: { currentTierId?: string | null }) => {
      if (!values || typeof values !== 'object') return;

      if (Object.prototype.hasOwnProperty.call(values, 'currentTierId')) {
        const normalized = normalizeTierId(values.currentTierId ?? null);
        if (normalized !== undefined) {
          const target = normalized ?? null;
          const pending = currentTierOverride !== undefined ? currentTierOverride ?? null : null;
          if (target !== pending) {
            setCurrentTierOverride(target);
          }
        }
      }
    },
    [currentTierOverride]
  );
  const autoRenewReady = autoRenewStateReady && membershipStatus === 'active' && !!renewalTierAddress;
  const needsAutoRenewStep = autoRenewReady && walletLinked && !autoRenewEnabled && !autoRenewPromptDismissed;
  const autoRenewPending = membershipStatus === 'active' && walletLinked && !autoRenewEnabled && !autoRenewPromptDismissed && !autoRenewReady;
  const showAutoRenewAlert = Boolean(autoRenewMessage);
  const autoRenewMessageNode = showAutoRenewAlert ? (
    <Alert className="glass-item border-[rgba(67,119,243,0.35)] bg-[rgba(67,119,243,0.15)] text-[var(--brand-navy)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <AlertDescription className="text-sm">{autoRenewMessage}</AlertDescription>
        <Button size="sm" variant="secondary" className="shadow-[0_10px_22px_-14px_rgba(67,119,243,0.55)]" onClick={dismissAutoRenewMessage}>
          {"Let's go!"}
        </Button>
      </div>
    </Alert>
  ) : null;

  useEffect(() => {
    if (!authenticated) {
      lastKnownMembership = null;
    }
  }, [authenticated]);

  useEffect(() => {
    if (autoRenewEnabled) {
      setAutoRenewPromptDismissed(true);
    }
  }, [autoRenewEnabled]);


  // Ensure wallet is on Base before any post‑purchase approvals
  const ensureBaseNetwork = useCallback(async (eth: any) => {
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
  }, []);

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
      const snapshot = await fetchMembershipStateSnapshot({ addresses, forceRefresh: true });
      const { summary, allowances: snapshotAllowances, tokenIds: snapshotTokenIds } = snapshotToMembershipSummary(snapshot);
      setAllowances(snapshotAllowances);
      setTokenIds(snapshotTokenIds || {});
      const status = summary.status;
      const expiry = typeof summary.expiry === 'number' ? summary.expiry : null;
      // Only apply if this is the latest refresh
      if (seq === refreshSeq.current) {
        const nowSec = Math.floor(Date.now() / 1000);
        const previousSummary = lastKnownMembership?.summary ?? membershipSummary ?? null;
        const previousTier = pickHighestActiveTier(previousSummary);
        const previousExpiry = typeof previousTier?.expiry === 'number' ? previousTier.expiry : null;
        const previousStillActive =
          !!previousTier &&
          previousTier.status === 'active' &&
          (previousExpiry === null || previousExpiry > nowSec);
        const currentTierStillActiveInIncoming = previousTier
          ? findTierInSummary(summary, previousTier.tier.checksumAddress)?.status === 'active'
          : false;

        if (previousStillActive && !currentTierStillActiveInIncoming) {
          // Ignore stale downgrade responses when we still have an active membership from a higher tier
          const activeExpiry = previousExpiry ?? membershipExpiry ?? null;
          setMembershipStatus('active');
          setMembershipExpiry(activeExpiry ?? null);
          if (previousSummary) {
            setMembershipSummary(previousSummary);
          }
          membershipResolvedRef.current = true;
          prevStatusRef.current = 'active';
          lastKnownMembership = { status: 'active', expiry: activeExpiry, summary: previousSummary };
          try {
            const cache = {
              status: 'active',
              expiry: activeExpiry,
              at: Math.floor(Date.now() / 1000),
              addresses: addresses.join(','),
            };
            localStorage.setItem('membershipCache', JSON.stringify(cache));
          } catch {}
          return;
        }

        // Prefer fresh expiry if present; otherwise keep prior future-dated expiry
        const preservedExpiry =
          (typeof expiry === 'number' && expiry > 0)
            ? expiry
            : (membershipExpiry && membershipExpiry * 1000 > Date.now() ? membershipExpiry : null);

        setMembershipExpiry(preservedExpiry);
        setMembershipSummary(summary);
        const derived = typeof preservedExpiry === 'number' && preservedExpiry > 0
          ? (preservedExpiry > nowSec ? 'active' : 'expired')
          : undefined;
        let effectiveStatus = (derived ?? status) as "active" | "expired" | "none";
        // Avoid downgrading to 'none' on transient RPC failures if we previously knew better
        if (effectiveStatus === 'none' && prevStatusRef.current !== 'none') {
          effectiveStatus = prevStatusRef.current;
        }
        setMembershipStatus(effectiveStatus);
        membershipResolvedRef.current = true;
        // Persist a short-lived client cache to minimize re-checks
        try {
          const cache = { status: effectiveStatus, expiry: preservedExpiry, at: Math.floor(Date.now()/1000), addresses: addresses.join(',') };
          localStorage.setItem('membershipCache', JSON.stringify(cache));
        } catch {}
        prevStatusRef.current = effectiveStatus;
        lastKnownMembership = { status: effectiveStatus, expiry: preservedExpiry ?? null, summary: summary ?? null };
      } else {
        // stale refresh, ignore
      }
    } catch (error) {
      console.error("Membership check failed:", error);
    } finally {
    }
  }, [ready, authenticated, walletAddress, wallets, membershipExpiry, membershipSummary]);

  const {
    openMembershipCheckout,
    openEventCheckout,
    checkoutPortal,
    status: checkoutStatus,
  } = useUnlockCheckout({
    onMembershipComplete: async () => {
      try {
        await refreshMembership();
      } catch (err) {
        console.error('Membership refresh after checkout failed:', err);
      }
    },
    onEventComplete: async () => {
      if (!addressesKey) return;
      try {
        await refresh(true);
      } catch (err) {
        console.error('Event refresh after checkout failed:', err);
      }
    },
  }, tokenIds);

  useEffect(() => {
    const busy = checkoutStatus === 'loading' || checkoutStatus === 'ready' || checkoutStatus === 'processing';
    setIsPurchasing(busy);
  }, [checkoutStatus]);

  const handleQuickRegister = useEventRegistration(
    (value) => setSelectedTierId(value),
    openMembershipCheckout,
    openEventCheckout,
  );

  useEffect(() => {
    // Prefer server-provided membership data via session; fall back to client cache; otherwise fetch in background
    if (!ready || !authenticated) return;
    const addresses = addressList;

    // If no linked wallets yet, we know membership cannot be verified; show onboarding immediately.
    if (!addresses.length) {
      setMembershipStatus('none');
      setMembershipExpiry(null);
      setMembershipSummary(null);
      lastKnownMembership = { status: 'none', expiry: null, summary: null };
      membershipResolvedRef.current = true;
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
        lastKnownMembership = { status: summaryStatus, expiry: summaryExpiry, summary: initialMembershipSummary };
        try {
          if (summaryStatus !== 'none') {
            prevStatusRef.current = summaryStatus;
          }
          const cache = { status: summaryStatus, expiry: summaryExpiry ?? null, at: Math.floor(Date.now() / 1000), addresses: addressesKey };
          localStorage.setItem('membershipCache', JSON.stringify(cache));
        } catch {}
        membershipResolvedRef.current = true;
        initialMembershipAppliedRef.current = true;
        return;
      }

      if (initialMembershipStatus && initialMembershipStatus !== 'unknown') {
        const expiry = typeof initialMembershipExpiry === 'number' ? initialMembershipExpiry : null;
        setMembershipStatus(initialMembershipStatus);
        setMembershipExpiry(expiry);
        if (initialMembershipStatus === 'active') {
          try { prevStatusRef.current = 'active'; } catch {}
        }
        lastKnownMembership = { status: initialMembershipStatus, expiry, summary: null };
        try {
          const cache = { status: initialMembershipStatus, expiry: expiry ?? null, at: Math.floor(Date.now() / 1000), addresses: addressesKey };
          localStorage.setItem('membershipCache', JSON.stringify(cache));
        } catch {}
        membershipResolvedRef.current = true;
        initialMembershipAppliedRef.current = true;
        if (initialMembershipStatus === 'active') {
          return;
        }
      } else {
        initialMembershipAppliedRef.current = true;
      }
    }

    if (membershipResolvedRef.current) {
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
          // Preserve last known good status to prevent transient downgrades
          try { if (cache.status !== 'none') { prevStatusRef.current = cache.status; } } catch {}
          lastKnownMembership = { status: cache.status, expiry: typeof cache.expiry === 'number' ? cache.expiry : null, summary: null };
          // Background refresh without changing checked flag
          membershipResolvedRef.current = false;
          void refreshMembership();
          return;
        }
      }
    } catch {}

    // No session value and no usable cache: do a foreground fetch once
    membershipResolvedRef.current = false;
    void refreshMembership();
  }, [
    ready,
    authenticated,
    initialMembershipStatus,
    initialMembershipExpiry,
    initialMembershipSummary,
    initialAllowances,
    addressList,
    addressesKey,
    refreshMembership,
  ]);
  useEffect(() => {
    if (!authenticated) return;
    if (!membershipSummary?.tiers?.length) return;
    if (currentTierOverride !== undefined) return;
    const highest = pickHighestActiveTier(membershipSummary);
    const bestId = normalizeTierId(highest?.tier.id ?? highest?.tier.address ?? null) ?? null;
    if (bestId) {
      void persistTierSelection({ currentTierId: bestId });
    } else {
      void persistTierSelection({ currentTierId: null });
    }
  }, [
    authenticated,
    membershipSummary,
    currentTierOverride,
    persistTierSelection,
  ]);

  useEffect(() => {
    if (!authenticated) {
      previousSummaryRef.current = membershipSummary ?? null;
      return;
    }
    previousSummaryRef.current = membershipSummary ?? null;
  }, [
    authenticated,
    membershipSummary,
  ]);

  const {
    creatorNfts,
    missedNfts,
    upcomingNfts,
    creatorNftsLoading,
    creatorNftsError,
    displayNfts,
    missedKeySet,
    refresh,
  } = useMemberNfts(addressesKey, authenticated && walletLinked && membershipStatus === 'active', showAllNfts);
  useEffect(() => {
    if (!authenticated || !walletLinked || membershipStatus !== 'active' || !renewalTierAddress) {
      setAutoRenewMonths(null);
      setAutoRenewStateReady(false);
      return;
    }
    const entry = allowances[renewalTierAddress.toLowerCase()];
    if (!entry) {
      setAutoRenewMonths(0);
      setAutoRenewStateReady(true);
      return;
    }
    if (entry.isUnlimited) {
      setAutoRenewMonths(MAX_AUTO_RENEW_MONTHS);
    } else {
      const amount = (() => {
        try {
          return BigInt(entry.amount || '0');
        } catch {
          return 0n;
        }
      })();
      const price = (() => {
        try {
          return entry.keyPrice ? BigInt(entry.keyPrice) : 0n;
        } catch {
          return 0n;
        }
      })();
      if (price > 0n) {
        setAutoRenewMonths(Number(amount / price));
      } else {
        setAutoRenewMonths(null);
      }
    }
    setAutoRenewStateReady(true);
  }, [authenticated, walletLinked, membershipStatus, renewalTierAddress, allowances]);

  useEffect(() => {
    if (!authenticated || !walletLinked || membershipStatus !== 'active') return;
    if (!addressesKey) return;
    refresh();
  }, [authenticated, walletLinked, membershipStatus, addressesKey, refresh]);

  useEffect(() => {
    if (!autoRenewReady) return;
    if (!autoRenewEnabled) return;
    if (!autoRenewPromptDismissed) {
      setAutoRenewPromptDismissed(true);
    }
  }, [autoRenewReady, autoRenewEnabled, autoRenewPromptDismissed]);

  useEffect(() => {
    if (membershipStatus === 'active') return;
    setAutoRenewProcessing(false);
    setAutoRenewMessage(null);
    setAutoRenewStateReady(false);
    if (membershipStatus === 'none') {
      setAutoRenewPromptDismissed(false);
    }
  }, [membershipStatus]);

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
  const enableAutoRenew = useCallback(async () => {
    if (autoRenewProcessing) return;
    setAutoRenewMessage(null);
    if (!USDC_ADDRESS || !renewalTierAddress) {
      setAutoRenewMessage('Auto-renew is unavailable. No eligible membership tier detected.');
      return;
    }
    const provider = (window as any)?.ethereum;
    if (!provider) {
      setAutoRenewMessage('No wallet provider detected. Open this site in a wallet-enabled browser.');
      return;
    }
    setAutoRenewProcessing(true);
    try {
      await ensureBaseNetwork(provider);
      const browserProvider = new BrowserProvider(provider, BASE_NETWORK_ID);
      const signer = await browserProvider.getSigner();
      const erc20 = new Contract(
        USDC_ADDRESS,
        ['function approve(address spender, uint256 amount) returns (bool)'],
        signer
      );
      const erc20Reader = new Contract(
        USDC_ADDRESS,
        ['function allowance(address owner, address spender) view returns (uint256)'],
        browserProvider
      );
      const lock = new Contract(
        renewalTierAddress,
        ['function keyPrice() view returns (uint256)'],
        browserProvider
      );
      let price: bigint = 0n;
      try {
        price = await lock.keyPrice();
      } catch {}
      if (price <= 0n) {
        price = 100000n;
      }
      const owner = await signer.getAddress();
      const current: bigint = await erc20Reader.allowance(owner, renewalTierAddress);
      let targetAllowance: bigint;
      try {
        targetAllowance = computeAutoRenewAllowance(price);
      } catch (err: any) {
        setAutoRenewMessage(err?.message || 'Unable to calculate auto-renew approval amount.');
        setAutoRenewProcessing(false);
        return;
      }
      const tierLabelForMessage = renewalTierLabel ? `the ${renewalTierLabel} tier` : 'your membership';
      if (current >= targetAllowance) {
        setAutoRenewMessage(`Auto-renew is already enabled for ${tierLabelForMessage} for up to 12 months at the current price.`);
      } else {
        const tx = await erc20.approve(renewalTierAddress, targetAllowance);
        await tx.wait();
        setAutoRenewMessage(`Auto-renew enabled for ${tierLabelForMessage}. We'll attempt renewals automatically (up to 12 months).`);
      }
      setAutoRenewPromptDismissed(true);
      await refreshMembership();
    } catch (err: any) {
      console.error('Auto-renew enable failed:', err);
      const message = err?.message || 'Failed to enable auto-renew. Please try again from Edit Profile later.';
      setAutoRenewMessage(message);
    } finally {
      setAutoRenewProcessing(false);
    }
  }, [autoRenewProcessing, ensureBaseNetwork, refreshMembership, renewalTierAddress, renewalTierLabel]);

  const handleSkipAutoRenew = useCallback(() => {
    setAutoRenewPromptDismissed(true);
    setAutoRenewMessage('You can enable auto-renew anytime from the Edit Profile page.');
  }, []);

  const purchaseMembership = useCallback(() => {
    if (!walletAddress && !(wallets && wallets.length)) {
      console.error('No wallet connected.');
      return;
    }
    const fallbackTierId =
      normalizedSelectedTierId ??
      normalizeTierId(
        membershipSummary?.highestActiveTier?.tier?.id ??
          membershipSummary?.highestActiveTier?.tier?.address ??
          MEMBERSHIP_TIERS[0]?.id ??
          MEMBERSHIP_TIERS[0]?.address ??
          null,
      ) ??
      null;
    const targetTier =
      selectedTierConfig ??
      (fallbackTierId
        ? MEMBERSHIP_TIERS.find((tier) => {
            const keys = [tier.id, tier.address, tier.checksumAddress]
              .map((value) => (value ? String(value).toLowerCase() : ''))
              .filter(Boolean);
            return keys.includes(fallbackTierId);
          }) ?? null
        : null) ??
      null;
    const targetId = targetTier?.checksumAddress ?? targetTier?.id ?? fallbackTierId ?? undefined;
    openMembershipCheckout(targetId);
  }, [walletAddress, wallets, normalizedSelectedTierId, membershipSummary, selectedTierConfig, openMembershipCheckout]);

  return (
    <>
      {checkoutPortal}
      <div className="relative mx-auto w-full max-w-6xl space-y-12 px-4 md:px-6">
      <section className="community-hero p-8 md:p-12">
        <div className="community-hero__frame">
          <div className="community-hero__content mx-auto flex w-full max-w-4xl flex-col items-center gap-8 text-center md:flex-row md:items-stretch md:gap-12 md:text-left">
            <div className="flex flex-1 flex-col gap-5 md:max-w-xl">
              <p className="section-eyebrow text-[var(--brand-cloud)]/80">Pretty Good Policy Member Portal</p>
              <div className="space-y-3">
                <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">PGP* Community</h1>
                <p className="mx-auto max-w-2xl text-sm leading-relaxed text-[var(--brand-cloud)] md:mx-0 md:text-base md:leading-relaxed">
                  A Web3-native portal to manage your membership, collect meeting NFTs, and stay current on Pretty Good Policy for Crypto.
                </p>
              </div>
            </div>
            <div className="mx-auto flex-shrink-0 rounded-[1.9rem] border border-white/20 bg-white/10 p-[6px] shadow-[0_28px_48px_-28px_rgba(11,11,67,0.55)] backdrop-blur-lg md:mx-0 md:self-center">
              <div className="relative h-28 w-28 overflow-hidden rounded-[1.6rem] md:h-40 md:w-40">
                <Image
                  src="/pgp_profile_image.png"
                  alt="PGP Community profile"
                  fill
                  sizes="(min-width: 768px) 160px, 112px"
                  className="object-cover"
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Scenario-driven UI based on auth, wallet linking, and membership */}
      {!ready ? (
        <div className="glass-surface p-8 text-center text-lg text-[var(--brand-navy)]/85">Loading…</div>
      ) : !authenticated ? (
        // Not logged in yet — Landing & Benefits
        <div className="space-y-10">
          <section className="glass-surface space-y-6 p-6 text-center shadow-[0_28px_48px_-28px_rgba(11,11,67,0.45)] md:p-10 md:text-left">
            <p className="text-base leading-relaxed text-[var(--muted-ink)] md:text-lg">
              Join a community of privacy and crypto enthusiasts. Support PGP efforts, collect meeting NFTs, and get insider updates.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row md:justify-start">
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
                className="w-full sm:w-auto shadow-[0_18px_36px_-20px_rgba(67,119,243,0.65)]"
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
                className="w-full border-[rgba(11,11,67,0.2)] bg-white/60 text-[var(--brand-navy)] shadow-[0_10px_24px_-16px_rgba(11,11,67,0.35)] transition hover:bg-white/80 sm:w-auto"
              >
                Sign up with Email
              </Button>
            </div>
            {authError && (
              <p className="text-sm text-red-600 dark:text-red-400">{authError}</p>
            )}
          </section>

          <section className="grid gap-5 sm:grid-cols-2">
            <div className="glass-item flex items-start gap-3 p-5 text-left">
              <HeartHandshake className="mt-1 h-5 w-5 text-[var(--brand-denim)]" />
              <div>
                <h3 className="text-base font-semibold text-[var(--brand-navy)]">Support the PGP Community</h3>
                <p className="text-sm leading-relaxed text-[var(--muted-ink)]">Your membership helps sustain open, privacy‑preserving tooling and community events.</p>
              </div>
            </div>
            <div className="glass-item flex items-start gap-3 p-5 text-left">
              <TicketCheck className="mt-1 h-5 w-5 text-[var(--brand-denim)]" />
              <div>
                <h3 className="text-base font-semibold text-[var(--brand-navy)]">Track Meeting POAPs/NFTs</h3>
                <p className="text-sm leading-relaxed text-[var(--muted-ink)]">Automatically collect and showcase proof of attendance and meeting NFTs.</p>
              </div>
            </div>
            <div className="glass-item flex items-start gap-3 p-5 text-left">
              <BellRing className="mt-1 h-5 w-5 text-[var(--brand-denim)]" />
              <div>
                <h3 className="text-base font-semibold text-[var(--brand-navy)]">Insider Updates</h3>
                <p className="text-sm leading-relaxed text-[var(--muted-ink)]">Be first to hear about upcoming meetings, demos, and releases.</p>
              </div>
            </div>
            <div className="glass-item flex items-start gap-3 p-5 text-left">
              <ShieldCheck className="mt-1 h-5 w-5 text-[var(--brand-denim)]" />
              <div>
                <h3 className="text-base font-semibold text-[var(--brand-navy)]">Member‑Only Content</h3>
                <p className="text-sm leading-relaxed text-[var(--muted-ink)]">Access gated guides, recordings, and resources when your membership is active.</p>
              </div>
            </div>
          </section>

          <section className="glass-surface space-y-4 p-6 md:p-8">
            <h3 className="text-xl font-semibold text-[var(--brand-navy)]">How it works</h3>
            <ul className="grid gap-4 text-sm sm:grid-cols-2 md:grid-cols-3">
              <li className="glass-item flex items-start gap-3 p-4">
                <BadgeCheck className="mt-1 h-5 w-5 shrink-0 text-[var(--brand-denim)]" />
                <div>
                  <div className="font-semibold text-[var(--brand-navy)]">Create your account</div>
                  <div className="text-[var(--muted-ink)]">Sign in with your wallet or email.</div>
                </div>
              </li>
              <li className="glass-item flex items-start gap-3 p-4">
                <Wallet className="mt-1 h-5 w-5 shrink-0 text-[var(--brand-denim)]" />
                <div>
                  <div className="font-semibold text-[var(--brand-navy)]">Link a wallet</div>
                  <div className="text-[var(--muted-ink)]">Use it for NFTs, donations, and access.</div>
                </div>
              </li>
              <li className="glass-item flex items-start gap-3 p-4">
                <KeyIcon className="mt-1 h-5 w-5 shrink-0 text-[var(--brand-denim)]" />
                <div>
                  <div className="font-semibold text-[var(--brand-navy)]">Activate membership</div>
                  <div className="text-[var(--muted-ink)]">Purchase the PGP Unlock membership.</div>
                </div>
              </li>
            </ul>
            <div className="text-sm leading-relaxed text-[var(--muted-ink)]">
              This site uses the open‑source, Web3‑based Unlock Protocol to issue and verify memberships. When you buy a membership, Unlock mints a time‑limited key (NFT) to your wallet. We verify your active key on‑chain to grant access to member‑only pages and features. When your key expires, you can renew to continue access.{' '}
              <a className="text-[var(--brand-denim)] underline underline-offset-4 hover:text-white" href="https://unlock-protocol.com/" target="_blank" rel="noreferrer">
                Learn more about Unlock Protocol
              </a>
            </div>
          </section>
        </div>
      ) : membershipStatus === "unknown" ? (
        !walletLinked ? (
          <div className="glass-surface space-y-6 p-6 md:p-8">
            <div className="text-center text-[var(--muted-ink)]">
              Hello {firstName || (session?.user as any)?.email || "there"}! Link your wallet to continue.
            </div>
            <OnboardingChecklist
              walletLinked={false}
              profileComplete={!!(firstName && lastName)}
              membershipStatus="none"
            />
          </div>
        ) : (
          <div className="glass-surface p-6 text-center text-[var(--muted-ink)] md:p-8">
            Checking your membership status…
          </div>
        )
      ) : membershipStatus === "active" ? (
        autoRenewPending ? (
          <AutoRenewPendingPanel />
        ) : needsAutoRenewStep ? (
          <AutoRenewPromptPanel
            greetingName={firstName || (session?.user as any)?.email || walletAddress || "member"}
            walletLinked={walletLinked}
            profileComplete={!!(firstName && lastName)}
            membershipStatus={membershipStatus as 'active' | 'expired' | 'none'}
            autoRenewReady={autoRenewReady}
            autoRenewEnabled={autoRenewEnabled}
            autoRenewProcessing={autoRenewProcessing}
            autoRenewDismissed={autoRenewPromptDismissed}
            onEnableAutoRenew={enableAutoRenew}
            onSkipAutoRenew={handleSkipAutoRenew}
            autoRenewMessageNode={autoRenewMessageNode}
          />
        ) : (
          <ActiveMemberPanel
            greetingName={firstName || (session?.user as any)?.email || walletAddress || "member"}
            memberLevelLabel={memberLevelLabel}
            autoRenewMessageNode={autoRenewMessageNode}
            walletLinked={walletLinked}
            profileComplete={profileComplete}
            viewerUrl={viewerUrl}
            onCloseViewer={() => setViewerUrl(null)}
            upcomingNfts={upcomingNfts}
            showUpcomingNfts={showUpcomingNfts}
            onToggleUpcoming={setShowUpcomingNfts}
            onRsvp={handleQuickRegister}
            displayNfts={displayNfts}
            showAllNfts={showAllNfts}
            onToggleShowAll={setShowAllNfts}
            missedNfts={missedNfts}
            missedKeySet={missedKeySet}
            creatorNftsLoading={creatorNftsLoading}
            creatorNftsError={creatorNftsError}
            creatorNfts={creatorNfts}
          />
        )
      ) : !walletLinked ? (
        // Authenticated but wallet not linked (after hydration)
        <div className="glass-surface space-y-6 p-6 md:p-8">
          <div className="text-center text-[var(--muted-ink)]">
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
        <div className="space-y-8">
          <section className="glass-surface space-y-4 p-6 text-center text-[var(--muted-ink)] md:p-8">
            <p>
              Hello, {firstName || walletAddress || (session?.user as any)?.email}! {membershipStatus === "expired" ? "Your membership has expired." : "You need a membership."}
            </p>
          </section>
          <section className="glass-surface p-6 md:p-8">
            <OnboardingChecklist
              walletLinked={walletLinked}
              profileComplete={!!(firstName && lastName)}
              membershipStatus={membershipStatus}
              onPurchaseMembership={() => setConfirmOpen(true)}
              purchasing={isPurchasing}
            />
          </section>
          {MEMBERSHIP_TIERS.length ? (
            <section className="glass-surface space-y-4 p-6 text-sm text-[var(--muted-ink)] md:p-8">
              <div className="text-base font-semibold text-[var(--brand-navy)]">Available tiers</div>
              <ul className="space-y-3">
                {MEMBERSHIP_TIERS.map((tier) => {
                  const summaryTier = membershipSummary?.tiers?.find((entry) => entry.tier.id === tier.id);
                  const label = tier.label || summaryTier?.metadata?.name || formatAddressShort(tier.checksumAddress);
                  const statusLabel = summaryTier?.status ?? 'none';
                  const statusDisplay =
                    statusLabel === 'active'
                      ? 'Active'
                      : statusLabel === 'expired'
                      ? 'Expired'
                      : 'Not owned';
                  const expiryDisplay = summaryTier?.expiry && summaryTier.expiry > 0
                    ? ` • expires ${new Date(summaryTier.expiry * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                    : '';
                  return (
                    <li key={tier.id} className="flex flex-col gap-2 rounded-xl border border-[rgba(193,197,226,0.45)] bg-white/80 px-4 py-3 md:flex-row md:items-center md:justify-between">
                      <span className="font-medium text-[var(--brand-navy)]">{label}</span>
                      <span className={statusLabel === 'active' ? 'text-emerald-600' : statusLabel === 'expired' ? 'text-amber-600' : 'text-[var(--muted-ink)]'}>
                        {statusDisplay}
                        {statusLabel !== 'none' ? expiryDisplay : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      )}
      {/* Purchase/Renew prerequisites dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="glass-surface space-y-4 p-6 md:p-8">
          <AlertDialogHeader>
            <AlertDialogTitle>Before you continue</AlertDialogTitle>
            <AlertDialogDescription>
              Review wallet requirements before continuing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {MEMBERSHIP_TIERS.length ? (
            <div className="space-y-3 rounded-lg border border-[rgba(193,197,226,0.6)] bg-white/80 p-4 text-sm text-[var(--brand-navy)]">
              <div className="text-sm font-semibold text-[var(--brand-navy)]">Choose your membership tier</div>
              <div className="space-y-2">
                {MEMBERSHIP_TIERS.map((tier, index) => {
                  const optionId =
                    normalizeTierId(tier.id) ??
                    normalizeTierId(tier.address) ??
                    normalizeTierId(tier.checksumAddress) ??
                    tier.id;
                  const summaryTier =
                    membershipSummary?.tiers?.find((entry) => {
                      const keys = [entry.tier.id, entry.tier.address, entry.tier.checksumAddress]
                        .map((value) => (value ? String(value).toLowerCase() : ""))
                        .filter(Boolean);
                      return optionId ? keys.includes(optionId) : false;
                    }) ?? null;
                  const label =
                    tier.label ||
                    summaryTier?.metadata?.name ||
                    formatAddressShort(tier.checksumAddress) ||
                    `Tier ${index + 1}`;
                  const priceDisplay =
                    (summaryTier?.metadata?.price && summaryTier.metadata.price.length
                      ? summaryTier.metadata.price
                      : null) || "Price shown at checkout";
                  const expiryLabel =
                    summaryTier?.expiry && summaryTier.expiry > 0
                      ? new Date(summaryTier.expiry * 1000).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : null;
                  const statusLabel = summaryTier?.status ?? "none";
                  const statusText =
                    statusLabel === "active"
                      ? `Active${expiryLabel ? ` · expires ${expiryLabel}` : ""}`
                      : statusLabel === "expired"
                      ? `Expired${expiryLabel ? ` · ${expiryLabel}` : ""}`
                      : "Not owned yet";
                  const benefit =
                    summaryTier?.metadata?.description ||
                    "Renews monthly; you can manage auto-renew after purchase.";
                  const isSelected = normalizedSelectedTierId
                    ? normalizedSelectedTierId === optionId
                    : index === 0;

                  return (
                    <label
                      key={tier.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-left transition ${
                        isSelected
                          ? "border-[rgba(67,119,243,0.45)] bg-[rgba(67,119,243,0.08)] shadow-[0_10px_30px_-24px_rgba(67,119,243,0.45)]"
                          : "border-[rgba(193,197,226,0.6)] bg-white/70"
                      }`}
                    >
                      <input
                        type="radio"
                        className="mt-1"
                        name="tier-selection"
                        value={optionId ?? tier.checksumAddress}
                        checked={isSelected}
                        onChange={() => setSelectedTierId(optionId ?? tier.checksumAddress ?? tier.id)}
                      />
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{label}</span>
                          <span className="text-xs text-[var(--brand-navy)]">{priceDisplay}</span>
                        </div>
                        <div className="text-xs text-[var(--muted-ink)]">{statusText}</div>
                        {benefit ? <div className="text-xs text-[var(--muted-ink)]">{benefit}</div> : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="space-y-2 text-left text-[var(--muted-ink)]">
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
            <div className="text-xs text-[var(--muted-ink)]">
              Note: After purchase you can enable auto-renew so renewals happen automatically, or skip it and set it up later from Edit Profile.
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={MEMBERSHIP_TIERS.length > 0 && !selectedTierConfig && !normalizedSelectedTierId}
              onClick={() => {
                setConfirmOpen(false);
                purchaseMembership();
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      </div>
    </>
  );
}
