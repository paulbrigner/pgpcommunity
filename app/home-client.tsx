// This page interacts directly with the user's browser and wallet,
// so it needs to run on the client side rather than on the server.
"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react"; // React helpers for state and lifecycle
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { BrowserProvider, Contract } from "ethers";
import { useQueryClient } from "@tanstack/react-query";
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
import { type AllowanceState } from "@/lib/membership-state-service";
import { normalizeTierId, pickHighestActiveTier, resolveTierLabel } from "@/lib/membership-tiers";
import { useEventRegistration, type EventDetails } from "@/lib/hooks/use-event-registration";
import { useMemberNfts } from "@/lib/hooks/use-member-nfts";
import { useMembership } from "@/lib/hooks/use-membership";
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
  initialAllowancesLoaded?: boolean;
  initialNfts?: {
    creatorNfts: any[] | null;
    missedNfts: any[] | null;
    upcomingNfts: any[] | null;
    error?: string | null;
  } | null;
};

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

const isUserRejected = (error: any): boolean => {
  const code = error?.code ?? error?.error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return true;
  const msg =
    (typeof error?.message === 'string' && error.message) ||
    (typeof error?.error?.message === 'string' && error.error.message) ||
    '';
  const lower = msg.toLowerCase();
  return lower.includes('user rejected') || lower.includes('user denied') || lower.includes('rejected by user');
};

export default function HomeClient({
  initialMembershipSummary,
  initialMembershipStatus = "unknown",
  initialMembershipExpiry = null,
  initialAllowances = {},
  initialTokenIds = {},
  initialAllowancesLoaded = true,
  initialNfts = null,
}: HomeClientProps) {
  // NextAuth session
  const { data: session, status, update } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const authenticated = status === "authenticated";
  const ready = status !== "loading";
  const sessionUser = session?.user as any | undefined;
  const walletAddress = sessionUser?.walletAddress as string | undefined;
  const wallets = useMemo(() => {
    const list = sessionUser?.wallets;
    return Array.isArray(list) ? list.map((item) => String(item)) : [];
  }, [sessionUser]);
  const addressList = useMemo(() => {
    const raw = wallets && wallets.length ? wallets : walletAddress ? [walletAddress] : [];
    return raw.map((a) => String(a).toLowerCase()).filter(Boolean);
  }, [wallets, walletAddress]);
  const addressesKey = useMemo(() => addressList.join(","), [addressList]);
  const firstName = sessionUser?.firstName as string | undefined;
  const lastName = sessionUser?.lastName as string | undefined;
  const profileComplete = !!(firstName && lastName);
  const walletLinked = !!(walletAddress || wallets.length > 0);
  // Membership state; 'unknown' avoids UI flicker until we hydrate from session/cache
  const {
    membershipStatus,
    membershipSummary,
    allowances,
    tokenIds,
    refreshMembership,
    allowancesLoaded,
  } = useMembership({
    ready,
    authenticated,
    walletAddress,
    wallets,
    addressesKey,
    initialMembershipSummary,
    initialMembershipStatus,
    initialMembershipExpiry,
    initialAllowances,
    initialTokenIds,
    initialAllowancesLoaded,
  });
  // Flags to show when purchase/renewal or funding actions are running
  const [isPurchasing, setIsPurchasing] = useState(false);

  const [autoRenewMonths, setAutoRenewMonths] = useState<number | null>(null);
  const [autoRenewStateReady, setAutoRenewStateReady] = useState(false);
  const [showAllNfts, setShowAllNfts] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [autoRenewPromptDismissed, setAutoRenewPromptDismissed] = useState(false);
  const [autoRenewProcessing, setAutoRenewProcessing] = useState(false);
  const [autoRenewMessage, setAutoRenewMessage] = useState<string | null>(null);
  const [memberClaimProcessing, setMemberClaimProcessing] = useState(false);
  const [memberClaimMessage, setMemberClaimMessage] = useState<string | null>(null);
  const [memberClaimError, setMemberClaimError] = useState<string | null>(null);
  const [memberClaimTxHash, setMemberClaimTxHash] = useState<string | null>(null);
  const memberClaimPollIdRef = useRef(0);
  const [eventRsvpProcessing, setEventRsvpProcessing] = useState(false);
  const [eventRsvpMessage, setEventRsvpMessage] = useState<string | null>(null);
  const [eventRsvpError, setEventRsvpError] = useState<string | null>(null);
  const [eventRsvpTxHash, setEventRsvpTxHash] = useState<string | null>(null);
  const eventRsvpPollIdRef = useRef(0);
  const [eventCancelProcessing, setEventCancelProcessing] = useState(false);
  const [eventCancelMessage, setEventCancelMessage] = useState<string | null>(null);
  const [eventCancelError, setEventCancelError] = useState<string | null>(null);
  const [eventCancelTxHash, setEventCancelTxHash] = useState<string | null>(null);
  const eventCancelPollIdRef = useRef(0);

  // Local auth error (e.g., SIWE with unlinked wallet)
  const [authError, setAuthError] = useState<string | null>(null);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  useEffect(() => {
    if (!authenticated || !walletLinked || !addressesKey) return;
    queryClient.prefetchQuery({
      queryKey: ["nfts", addressesKey],
      queryFn: async () => {
        const res = await fetch(`/api/nfts?addresses=${encodeURIComponent(addressesKey)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to prefetch NFTs (${res.status})`);
        const payload = await res.json();
        return {
          creatorNfts: Array.isArray(payload?.nfts) ? payload.nfts : [],
          missedNfts: Array.isArray(payload?.missed) ? payload.missed : [],
          upcomingNfts: Array.isArray(payload?.upcoming) ? payload.upcoming : [],
          error: typeof payload?.error === "string" && payload.error.length ? payload.error : null,
        };
      },
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 15,
    });
  }, [authenticated, walletLinked, addressesKey, queryClient]);

  const autoRenewEnabled = typeof autoRenewMonths === 'number' && autoRenewMonths > 0;
  const currentTier = useMemo<TierMembershipSummary | null>(() => pickHighestActiveTier(membershipSummary), [membershipSummary]);

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
  const selectedTierGasSponsored = selectedTierConfig?.gasSponsored === true;
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

  const currentTierLabel = useMemo(
    () => resolveTierLabel(currentTier, null),
    [currentTier]
  );
  const memberLevelLabel = useMemo(() => {
    const label = (currentTierLabel || '').trim();
    if (!label) return 'PGP';
    if (label.toLowerCase() === 'member') return 'community';
    return label;
  }, [currentTierLabel]);
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
  const autoRenewEligible = renewalTier?.tier?.renewable !== false && renewalTier?.tier?.neverExpires !== true;
  const autoRenewReady = autoRenewEligible && autoRenewStateReady && membershipStatus === 'active' && !!renewalTierAddress;
  const needsAutoRenewStep = autoRenewEligible && autoRenewReady && walletLinked && !autoRenewEnabled && !autoRenewPromptDismissed;
  const autoRenewPending =
    autoRenewEligible &&
    membershipStatus === 'active' &&
    walletLinked &&
    !autoRenewEnabled &&
    !autoRenewPromptDismissed &&
    !autoRenewReady;
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
  const memberClaimAlertNode = memberClaimMessage || memberClaimError ? (
    <Alert
      variant={memberClaimError ? "destructive" : undefined}
      className="glass-item border-[rgba(193,197,226,0.45)] bg-white/80 text-[var(--brand-navy)]"
    >
      <AlertDescription className="text-sm">
        {memberClaimError || memberClaimMessage}
        {memberClaimTxHash ? (
          <>
            {" "}
            <a
              href={`${BASE_BLOCK_EXPLORER_URL}/tx/${memberClaimTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              View transaction
            </a>
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  ) : null;
  const eventRsvpAlertNode = eventRsvpMessage || eventRsvpError ? (
    <Alert
      variant={eventRsvpError ? "destructive" : undefined}
      className="glass-item border-[rgba(193,197,226,0.45)] bg-white/80 text-[var(--brand-navy)]"
    >
      <AlertDescription className="text-sm">
        {eventRsvpError || eventRsvpMessage}
        {eventRsvpTxHash ? (
          <>
            {" "}
            <a
              href={`${BASE_BLOCK_EXPLORER_URL}/tx/${eventRsvpTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              View transaction
            </a>
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  ) : null;
  const eventCancelAlertNode = eventCancelMessage || eventCancelError ? (
    <Alert
      variant={eventCancelError ? "destructive" : undefined}
      className="glass-item border-[rgba(193,197,226,0.45)] bg-white/80 text-[var(--brand-navy)]"
    >
      <AlertDescription className="text-sm">
        {eventCancelError || eventCancelMessage}
        {eventCancelTxHash ? (
          <>
            {" "}
            <a
              href={`${BASE_BLOCK_EXPLORER_URL}/tx/${eventCancelTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              View transaction
            </a>
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  ) : null;

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

  const {
    openMembershipCheckout,
    openEventCheckout: openEventCheckoutWallet,
    checkoutPortal,
    status: checkoutStatus,
  } = useUnlockCheckout({
    onMembershipComplete: async (target, completion) => {
      try {
        if (addressesKey) {
          await fetch("/api/membership/invalidate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ addresses: addressList, chainId: BASE_NETWORK_ID }),
          }).catch(() => {});
        }
        await refreshMembership({ forceRefresh: true });
      } catch (err) {
        console.error('Membership refresh after checkout failed:', err);
      }
      try {
        const targetKeys = [target?.id, target?.lockAddress, target?.checksumAddress]
          .map((value) => (value ? String(value).toLowerCase() : ""))
          .filter(Boolean);
        const completedTier =
          MEMBERSHIP_TIERS.find((tier) => {
            const keys = [tier.id, tier.address, tier.checksumAddress]
              .map((value) => (value ? String(value).toLowerCase() : ""))
              .filter(Boolean);
            return targetKeys.some((key) => keys.includes(key));
          }) ?? null;
        const paidTierCompleted = !!completedTier && completedTier.renewable !== false && completedTier.neverExpires !== true;
        if (!paidTierCompleted) return;
        if (!addressList.length) return;

        const ownerLower = completion?.owner ? String(completion.owner).toLowerCase() : null;
        const recipient =
          ownerLower && addressList.includes(ownerLower)
            ? ownerLower
            : addressList[0] || null;
        if (!recipient) return;

        await fetch("/api/membership/claim-member", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient }),
        }).catch(() => {});
        await refreshMembership({ forceRefresh: true });
      } catch (err) {
        console.error("Member claim after paid checkout failed:", err);
      }
    },
    onEventComplete: async () => {
      if (!addressesKey) return;
      try {
        await refresh();
      } catch (err) {
        console.error('Event refresh after checkout failed:', err);
      }
    },
  }, tokenIds);

  useEffect(() => {
    const busy = checkoutStatus === 'loading' || checkoutStatus === 'ready' || checkoutStatus === 'processing';
    setIsPurchasing(busy);
  }, [checkoutStatus]);

  // Membership state handled via useMembership

  const {
    creatorNfts,
    missedNfts,
    upcomingNfts,
    creatorNftsLoading,
    creatorNftsError,
    displayNfts,
    missedKeySet,
    refresh,
  } = useMemberNfts(
    addressesKey,
    authenticated && walletLinked && membershipStatus === 'active',
    showAllNfts,
    initialNfts as any
  );

  const openEventCheckout = useCallback(
    async (lockAddress: string, eventDetails?: EventDetails | null) => {
      if (eventRsvpProcessing) return;
      const pollId = eventRsvpPollIdRef.current + 1;
      eventRsvpPollIdRef.current = pollId;
      setEventRsvpError(null);
      setEventRsvpMessage(null);
      setEventRsvpTxHash(null);

      if (!authenticated) {
        setEventRsvpError("Sign in before RSVP'ing for events.");
        return;
      }
      if (!walletLinked || addressList.length === 0) {
        setEventRsvpError("Link your wallet before RSVP'ing for events.");
        return;
      }

      const normalizedLock = String(lockAddress || "").trim();
      if (!normalizedLock) {
        setEventRsvpError("Invalid event lock.");
        return;
      }

      setEventRsvpProcessing(true);
      try {
        const res = await fetch("/api/events/rsvp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockAddress: normalizedLock, recipient: addressList[0] }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          const code = typeof payload?.code === "string" ? payload.code : null;
          const message = typeof payload?.error === "string" && payload.error.length
            ? payload.error
            : "Unable to RSVP for this event.";
          if (code === "EVENT_NOT_FREE") {
            setEventRsvpMessage("This event requires an on-chain checkout. Opening wallet checkout…");
            openEventCheckoutWallet(normalizedLock, eventDetails ?? null);
            return;
          }
          throw new Error(message);
        }

        const txHash = typeof payload?.txHash === "string" && payload.txHash.length ? payload.txHash : null;
        setEventRsvpTxHash(txHash);
        setEventRsvpMessage(
          payload?.status === "already-registered"
            ? "You're already registered for this event."
            : "RSVP submitted. It will appear in your collection once confirmed on Base.",
        );

        await refresh();

        if (payload?.status !== "already-registered") {
          void (async () => {
            const lockLower = normalizedLock.toLowerCase();
            const delaysMs = [1500, 2500, 4000, 6500, 10000, 15000];
            for (const delay of delaysMs) {
              await new Promise((resolve) => setTimeout(resolve, delay));
              if (eventRsvpPollIdRef.current !== pollId) return;
              try {
                const result = await refresh();
                const upcoming = (result as any)?.data?.upcomingNfts;
                const stillUpcoming = Array.isArray(upcoming)
                  ? upcoming.some((entry: any) => String(entry?.contractAddress ?? "").toLowerCase() === lockLower)
                  : false;
                if (!stillUpcoming) {
                  setEventRsvpMessage("RSVP confirmed. You're registered!");
                  return;
                }
              } catch {}
            }
          })();
        }
      } catch (err: any) {
        setEventRsvpError(err?.message || "Failed to RSVP for event.");
      } finally {
        setEventRsvpProcessing(false);
      }
    },
    [eventRsvpProcessing, authenticated, walletLinked, addressList, openEventCheckoutWallet, refresh],
  );

  const cancelEventRsvp = useCallback(
    async (params: { lockAddress: string; recipient: string; tokenId: string }) => {
      if (eventCancelProcessing) return;
      const ok = window.confirm("Cancel your RSVP for this meeting?");
      if (!ok) return;

      const pollId = eventCancelPollIdRef.current + 1;
      eventCancelPollIdRef.current = pollId;
      setEventCancelError(null);
      setEventCancelMessage(null);
      setEventCancelTxHash(null);

      if (!authenticated) {
        setEventCancelError("Sign in before canceling an RSVP.");
        return;
      }
      if (!walletLinked || addressList.length === 0) {
        setEventCancelError("Link your wallet before canceling an RSVP.");
        return;
      }

      const normalizedLock = String(params.lockAddress || "").trim();
      if (!normalizedLock) {
        setEventCancelError("Invalid event lock.");
        return;
      }
      const recipient = String(params.recipient || "").trim().toLowerCase();
      if (!recipient) {
        setEventCancelError("Missing RSVP wallet address.");
        return;
      }

      setEventCancelProcessing(true);
      try {
        const res = await fetch("/api/events/cancel-rsvp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockAddress: normalizedLock, recipient, tokenId: params.tokenId }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || "Failed to cancel RSVP.");
        }

        const txHash = typeof payload?.txHash === "string" && payload.txHash.length ? payload.txHash : null;
        setEventCancelTxHash(txHash);
        setEventCancelMessage(
          payload?.status === "already-canceled"
            ? "RSVP is already canceled."
            : "Cancellation submitted. It will update once confirmed on Base.",
        );

        await refresh();

        if (payload?.status !== "already-canceled") {
          void (async () => {
            const lockLower = normalizedLock.toLowerCase();
            const tokenId = String(params.tokenId || "").trim();
            const delaysMs = [1500, 2500, 4000, 6500, 10000, 15000];
            for (const delay of delaysMs) {
              await new Promise((resolve) => setTimeout(resolve, delay));
              if (eventCancelPollIdRef.current !== pollId) return;
              try {
                const result = await refresh();
                const owned = (result as any)?.data?.creatorNfts;
                const stillOwned = Array.isArray(owned)
                  ? owned.some((entry: any) =>
                      String(entry?.contractAddress ?? "").toLowerCase() === lockLower &&
                      (tokenId ? String(entry?.tokenId ?? "") === tokenId : true),
                    )
                  : false;
                if (!stillOwned) {
                  setEventCancelMessage("RSVP canceled.");
                  return;
                }
              } catch {}
            }
          })();
        }
      } catch (err: any) {
        setEventCancelError(err?.message || "Failed to cancel RSVP.");
      } finally {
        setEventCancelProcessing(false);
      }
    },
    [eventCancelProcessing, authenticated, walletLinked, addressList, refresh],
  );

  const handleQuickRegister = useEventRegistration(
    (value) => setSelectedTierId(value),
    openMembershipCheckout,
    openEventCheckout,
  );
  useEffect(() => {
    if (!authenticated || !walletLinked || membershipStatus !== 'active' || !renewalTierAddress) {
      setAutoRenewMonths(null);
      setAutoRenewStateReady(false);
      return;
    }
    if (!allowancesLoaded) {
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
  }, [authenticated, walletLinked, membershipStatus, renewalTierAddress, allowancesLoaded, allowances]);

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
    if (!autoRenewEligible) {
      setAutoRenewMessage('Auto-renew is unavailable for this membership tier.');
      return;
    }
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
      await refreshMembership({ forceRefresh: true });
    } catch (err: any) {
      if (isUserRejected(err)) {
        // Treat wallet rejection as a user cancel; no error banner.
        setAutoRenewMessage('Auto-renew was canceled.');
      } else {
        console.error('Auto-renew enable failed:', err);
        const message = err?.message || 'Failed to enable auto-renew. Please try again from Edit Profile later.';
        setAutoRenewMessage(message);
      }
    } finally {
      setAutoRenewProcessing(false);
    }
  }, [autoRenewProcessing, autoRenewEligible, ensureBaseNetwork, refreshMembership, renewalTierAddress, renewalTierLabel]);

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

  const claimMemberTier = useCallback(async () => {
    if (memberClaimProcessing) return;
    const pollId = memberClaimPollIdRef.current + 1;
    memberClaimPollIdRef.current = pollId;
    setMemberClaimError(null);
    setMemberClaimMessage(null);
    setMemberClaimTxHash(null);

    if (!authenticated) {
      setMemberClaimError("Sign in before claiming the free membership.");
      return;
    }
    if (!walletLinked || addressList.length === 0) {
      setMemberClaimError("Link your wallet before claiming the free membership.");
      return;
    }

    setMemberClaimProcessing(true);
    try {
      const res = await fetch("/api/membership/claim-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: addressList[0] }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to claim free membership.");
      }

      const txHash = typeof payload?.txHash === "string" && payload.txHash.length ? payload.txHash : null;
      setMemberClaimTxHash(txHash);
      setMemberClaimMessage(
        payload?.status === "already-member"
          ? "Free membership is already active."
          : "Transaction submitted. Your membership will activate once confirmed on Base.",
      );
      setConfirmOpen(false);

      await refreshMembership({ forceRefresh: true });

      if (payload?.status !== "already-member") {
        void (async () => {
          const delaysMs = [1500, 2500, 4000, 6500, 10000, 15000];
          for (const delay of delaysMs) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            if (memberClaimPollIdRef.current !== pollId) return;
            try {
              const result = await refreshMembership({ forceRefresh: true });
              const status = result?.data?.summary?.status;
              const expiry = result?.data?.summary?.expiry;
              const nowSec = Math.floor(Date.now() / 1000);
              const isActive =
                status === "active" ||
                (typeof expiry === "number" && Number.isFinite(expiry) && expiry > nowSec);
              if (isActive) {
                setMemberClaimMessage("Free membership is active.");
                return;
              }
            } catch {}
          }
        })();
      }
    } catch (err: any) {
      setMemberClaimError(err?.message || "Failed to claim free membership.");
    } finally {
      setMemberClaimProcessing(false);
    }
  }, [memberClaimProcessing, authenticated, walletLinked, addressList, refreshMembership]);

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
        {memberClaimAlertNode}
        {eventRsvpAlertNode}
        {eventCancelAlertNode}
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
            upcomingNfts={upcomingNfts}
            onRsvp={handleQuickRegister}
            rsvpProcessing={eventRsvpProcessing}
            onCancelRsvp={cancelEventRsvp}
            cancelRsvpProcessing={eventCancelProcessing}
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
                  const expiryDisplay =
                    statusLabel !== 'none'
                      ? statusLabel === 'active' && tier.neverExpires
                        ? ' • never expires'
                        : summaryTier?.expiry && summaryTier.expiry > 0
                          ? ` • expires ${new Date(summaryTier.expiry * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                          : ''
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
                  const priceDisplay = (() => {
                    const metaDisplay = formatUsdcPrice(summaryTier?.metadata?.price);
                    if (metaDisplay) return metaDisplay;
                    const key = tier.checksumAddress?.toLowerCase();
                    if (key && allowances[key]?.keyPrice) {
                      const allowanceDisplay = formatUsdcPrice(allowances[key].keyPrice);
                      if (allowanceDisplay) return allowanceDisplay;
                    }
                    if (tier.neverExpires && tier.renewable === false) return 'Free';
                    return "USDC price shown at checkout";
                  })();
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
                      <div className="flex w-full flex-col gap-1">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium text-[var(--brand-navy)]">{label}</span>
                          <span className="text-xs text-[var(--brand-navy)]">{priceDisplay}</span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
	          <WalletReadyNote
	            membershipSummary={membershipSummary}
	            selectedTierId={normalizedSelectedTierId}
	            tiers={MEMBERSHIP_TIERS}
	            allowances={allowances}
	          />
	            {memberClaimError ? (
	              <Alert variant="destructive">
	                <AlertDescription className="space-y-3">
                    <div>{memberClaimError}</div>
                    {selectedTierGasSponsored ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={memberClaimProcessing}
                        onClick={() => {
                          setConfirmOpen(false);
                          purchaseMembership();
                        }}
                      >
                        Claim manually (requires Base ETH gas)
                      </Button>
                    ) : null}
                  </AlertDescription>
	              </Alert>
	            ) : null}
		          <AlertDialogFooter>
		            <AlertDialogCancel disabled={memberClaimProcessing}>Cancel</AlertDialogCancel>
		            <AlertDialogAction
		              disabled={
                  memberClaimProcessing ||
                  (MEMBERSHIP_TIERS.length > 0 && !selectedTierConfig && !normalizedSelectedTierId)
                }
	              onClick={(event) => {
                  event.preventDefault();
                  if (selectedTierGasSponsored) {
                    void claimMemberTier();
                    return;
                  }
	                setConfirmOpen(false);
	                purchaseMembership();
	              }}
	            >
	              {selectedTierGasSponsored
                  ? memberClaimProcessing
                    ? "Claiming…"
                    : "Claim Free Membership (Sponsored)"
                  : "Continue"}
	            </AlertDialogAction>
		          </AlertDialogFooter>
	        </AlertDialogContent>
	      </AlertDialog>
      
      </div>
    </>
  );
}

type WalletReadyNoteProps = {
  membershipSummary: MembershipSummary | null;
  selectedTierId: string | null | undefined;
  tiers: typeof MEMBERSHIP_TIERS;
  allowances: Record<string, AllowanceState>;
};

const formatUsdcPrice = (raw: string | number | null | undefined): string | null => {
  if (raw === null || raw === undefined) return null;

  const formatValue = (value: number) => {
    if (value <= 0) return 'Free';
    return `${value.toFixed(2)} USDC`;
  };

  // If it's a finite number already
  const maybeNum = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(maybeNum)) {
    // Heuristic: values greater than 1,000 are probably base units (6 decimals for USDC)
    if (maybeNum > 1000) {
      const converted = maybeNum / 1_000_000;
      if (Number.isFinite(converted)) return formatValue(converted);
    }
    return formatValue(maybeNum);
  }

  // Try BigInt conversion (covers large base-unit strings)
  try {
    const asBig = BigInt(String(raw));
    const whole = Number(asBig) / 1_000_000;
    if (Number.isFinite(whole)) {
      return formatValue(whole);
    }
  } catch {
    // ignore parse errors
  }
  return null;
};

function WalletReadyNote({ membershipSummary, selectedTierId, tiers, allowances }: WalletReadyNoteProps) {
  const selectedTierConfig = useMemo(() => {
    if (!selectedTierId) return null;
    const normalized = selectedTierId.toLowerCase();
    return (
      tiers.find((tier) => {
        const keys = [tier.id, tier.address, tier.checksumAddress].map((value) => (value ? String(value).toLowerCase() : ""));
        return keys.includes(normalized);
      }) ?? null
    );
  }, [tiers, selectedTierId]);
  const selectedTierSummary = useMemo(() => {
    if (!selectedTierId) return null;
    const normalized = selectedTierId.toLowerCase();
    return (
      membershipSummary?.tiers?.find((entry) => {
        const keys = [entry.tier.id, entry.tier.address, entry.tier.checksumAddress]
          .map((value) => (value ? String(value).toLowerCase() : ""));
        return keys.includes(normalized);
      }) ?? null
    );
  }, [membershipSummary, selectedTierId]);

  const fallbackTier = tiers[0] || null;
  const selectedLabel =
    selectedTierSummary?.tier?.label ||
    selectedTierSummary?.metadata?.name ||
    (fallbackTier ? fallbackTier.label || fallbackTier.id : "membership");

	  const priceDisplay = useMemo(() => {
	    const rawMeta = selectedTierSummary?.metadata?.price;
	    const metaDisplay = formatUsdcPrice(rawMeta);
	    if (metaDisplay) return metaDisplay;
    const key = selectedTierSummary?.tier.checksumAddress?.toLowerCase();
    if (key && allowances[key]?.keyPrice) {
      const allowancePrice = formatUsdcPrice(allowances[key].keyPrice);
      if (allowancePrice) return allowancePrice;
    }
	    if (selectedTierConfig?.neverExpires && selectedTierConfig?.renewable === false) return 'Free';
	    return "USDC price shown at checkout";
	  }, [selectedTierSummary, allowances, selectedTierConfig]);
	  const isFreeTier = priceDisplay === 'Free';
	  const gasSponsored = selectedTierConfig?.gasSponsored === true;

	  return (
	    <div className="space-y-2 rounded-lg border border-[rgba(193,197,226,0.45)] bg-white/70 p-4 text-left text-[var(--muted-ink)]">
	      <div className="text-sm font-semibold text-[var(--brand-navy)]">What to have in your wallet</div>
	      <ul className="list-disc space-y-1 pl-4 text-sm">
        {isFreeTier ? (
          <li>
            Cost: <span className="font-medium text-[var(--brand-navy)]">Free</span> for the selected tier{selectedLabel ? ` (${selectedLabel})` : ""}.
          </li>
	        ) : (
	          <li>
	            USDC (Base): <span className="font-medium text-[var(--brand-navy)]">{priceDisplay}</span> for the selected tier{selectedLabel ? ` (${selectedLabel})` : ""}.
	          </li>
	        )}
	        {isFreeTier && gasSponsored ? (
	          <li>ETH (Base): not required (gas is sponsored).</li>
	        ) : (
	          <li>ETH (Base): a small amount for gas. Keep ~0.00002–0.0001 ETH to cover approval + purchase.</li>
	        )}
	      </ul>
	      <div className="text-xs text-[var(--muted-ink)]">
	        {isFreeTier && gasSponsored
	          ? "Free membership claims use a sponsored on-chain transaction (requires verified email)."
	          : "First purchase may prompt an approval then a purchase. You can enable auto-renew later from Edit Profile."}
	      </div>
	    </div>
	  );
	}
