// This page interacts directly with the user's browser and wallet,
// so it needs to run on the client side rather than on the server.
"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react"; // React helpers for state and lifecycle
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { Paywall } from "@unlock-protocol/paywall";
import { networks } from "@unlock-protocol/networks";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DateTime } from "luxon";
import { createEvent } from "ics";
import {
  MEMBERSHIP_TIERS,
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  USDC_ADDRESS,
  BASE_CHAIN_ID_HEX,
  BASE_BLOCK_EXPLORER_URL,
} from "@/lib/config"; // Environment-specific constants
import { cloneMembershipPaywallConfig } from "@/lib/membership-paywall";
import type { MembershipSummary, TierMembershipSummary } from "@/lib/membership-server";
import {
  detectRecentlyActivatedTierId,
  findTierInSummary,
  normalizeTierId,
  pickFallbackDesiredTierId,
  pickHighestActiveTier,
  resolveTierLabel,
} from "@/lib/membership-tiers";
import { Button } from "@/components/ui/button";
import { signInWithSiwe } from "@/lib/siwe/client";
import { BadgeCheck, BellRing, HeartHandshake, ShieldCheck, TicketCheck, Wallet, Key as KeyIcon } from "lucide-react";
import { OnboardingChecklist } from "@/components/site/OnboardingChecklist";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

type MembershipSnapshot = {
  status: 'active' | 'expired' | 'none';
  expiry: number | null;
  summary?: MembershipSummary | null;
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

const formatAddressShort = (value: string | null | undefined): string => {
  if (!value) return 'N/A';
  const normalized = value.toLowerCase();
  if (normalized.length <= 10) return normalized;
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
};

const formatEventDisplay = (
  date?: string | null,
  startTime?: string | null,
  endTime?: string | null,
  timezone?: string | null
) => {
  if (!date) return { dateLabel: null, timeLabel: null };
  const zone = timezone || 'UTC';
  const dateObj = DateTime.fromISO(date, { zone });
  const dateLabel = dateObj.isValid
    ? dateObj.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)
    : date;

  let timeLabel: string | null = null;
  if (startTime) {
    const startDateTime = DateTime.fromISO(`${date}T${startTime}`, { zone });
    const startLabel = startDateTime.isValid
      ? startDateTime.toLocaleString(DateTime.TIME_SIMPLE)
      : startTime;
    if (endTime) {
      const endDateTime = DateTime.fromISO(`${date}T${endTime}`, { zone });
      const endLabel = endDateTime.isValid
        ? endDateTime.toLocaleString(DateTime.TIME_SIMPLE)
        : endTime;
      timeLabel = `${startLabel} - ${endLabel}`;
    } else {
      timeLabel = startLabel;
    }
    if (timeLabel && timezone) {
      timeLabel = `${timeLabel} (${timezone})`;
    }
  } else if (endTime) {
    const endDateTime = DateTime.fromISO(`${date}T${endTime}`, { zone });
    const endLabel = endDateTime.isValid
      ? endDateTime.toLocaleString(DateTime.TIME_SIMPLE)
      : endTime;
    timeLabel = `Ends at ${endLabel}${timezone ? ` (${timezone})` : ''}`;
  }

  return { dateLabel, timeLabel };
};

const buildCalendarLinks = (
  title: string,
  date?: string | null,
  startTime?: string | null,
  endTime?: string | null,
  timezone?: string | null,
  location?: string | null,
  description?: string | null
) => {
  if (!date) return { google: null as string | null, ics: null as string | null };

  const zone = timezone || 'UTC';
  const start = startTime
    ? DateTime.fromISO(`${date}T${startTime}`, { zone })
    : DateTime.fromISO(date, { zone }).startOf('day');
  if (!start.isValid) {
    return { google: null, ics: null };
  }

  const end = endTime
    ? DateTime.fromISO(`${date}T${endTime}`, { zone })
    : start.plus({ hours: startTime ? 1 : 24 });

  const googleParams = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details: description || '',
    location: location || '',
  });

  const startGoogle = start.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const endGoogle = end.isValid ? end.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'") : start.plus({ hours: 1 }).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  googleParams.set('dates', `${startGoogle}/${endGoogle}`);

  let ics: string | null = null;
  const eventConfig: any = {
    title,
    start: [start.year, start.month, start.day, start.hour, start.minute],
    location: location || undefined,
    description: description || undefined,
    productId: 'pgpforcrypto.org',
  };

  if (end.isValid) {
    eventConfig.end = [end.year, end.month, end.day, end.hour, end.minute];
  }

  const { error, value } = createEvent(eventConfig);
  if (!error && value) {
    ics = value;
  }

  return {
    google: `https://calendar.google.com/calendar/render?${googleParams.toString()}`,
    ics,
  };
};

const downloadIcs = (ics: string, title: string) => {
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeTitle = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  link.href = url;
  link.download = `${safeTitle || 'event'}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
  const sessionCurrentMembershipTierId =
    typeof sessionUser?.currentMembershipTierId === "string" && sessionUser.currentMembershipTierId.trim().length
      ? sessionUser.currentMembershipTierId.trim().toLowerCase()
      : null;
  const sessionDesiredMembershipTierId =
    typeof sessionUser?.lastMembershipTierId === "string" && sessionUser.lastMembershipTierId.trim().length
      ? sessionUser.lastMembershipTierId.trim().toLowerCase()
      : null;
  const [currentTierOverride, setCurrentTierOverride] = useState<string | null | undefined>(undefined);
  const [desiredTierOverride, setDesiredTierOverride] = useState<string | null | undefined>(undefined);
  const walletAddress = sessionUser?.walletAddress as string | undefined;
  const wallets = useMemo(() => {
    const list = sessionUser?.wallets;
    return Array.isArray(list) ? list.map((item) => String(item)) : [];
  }, [sessionUser]);
  const firstName = sessionUser?.firstName as string | undefined;
  const lastName = sessionUser?.lastName as string | undefined;
  const sessionMembershipSummary = sessionUser?.membershipSummary as MembershipSummary | null | undefined;
  const sessionMembershipStatus = (sessionMembershipSummary?.status ?? sessionUser?.membershipStatus) as
    | 'active'
    | 'expired'
    | 'none'
    | undefined;
  const sessionMembershipExpiry = (sessionMembershipSummary?.expiry ?? (sessionUser?.membershipExpiry as number | null | undefined)) ?? null;
  const profileComplete = !!(firstName && lastName);
  const walletLinked = !!(walletAddress || wallets.length > 0);
  // Membership state; 'unknown' avoids UI flicker until we hydrate from session/cache
const [membershipStatus, setMembershipStatus] = useState<
  "active" | "expired" | "none" | "unknown"
>(sessionMembershipStatus ?? 'unknown');
// Flags to show when purchase/renewal or funding actions are running
const [isPurchasing, setIsPurchasing] = useState(false);

const [membershipSummary, setMembershipSummary] = useState<MembershipSummary | null>(sessionMembershipSummary ?? null);
const [membershipExpiry, setMembershipExpiry] = useState<number | null>(sessionMembershipExpiry);
  const [autoRenewMonths, setAutoRenewMonths] = useState<number | null>(null);
  const [autoRenewChecking, setAutoRenewChecking] = useState(false);
  const [autoRenewStateReady, setAutoRenewStateReady] = useState(false);
  const [creatorNfts, setCreatorNfts] = useState<Array<{
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
  }> | null>(null);
  const [creatorNftsLoading, setCreatorNftsLoading] = useState(false);
  const [creatorNftsError, setCreatorNftsError] = useState<string | null>(null);
  const [openDescriptionKey, setOpenDescriptionKey] = useState<string | null>(null);
  const [missedNfts, setMissedNfts] = useState<Array<{
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
  }> | null>(null);
  const [upcomingNfts, setUpcomingNfts] = useState<Array<{
    contractAddress: string;
    title: string;
    description: string | null;
    subtitle?: string | null;
    eventDate?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    timezone?: string | null;
    location?: string | null;
    image: string | null;
    registrationUrl: string;
    quickCheckoutConfig: Record<string, unknown> | null;
    sortKey?: number;
  }> | null>(null);
  const [showAllNfts, setShowAllNfts] = useState(false);
  const [showUpcomingNfts, setShowUpcomingNfts] = useState(true);
  const refreshSeq = useRef(0);
  const prevStatusRef = useRef<"active" | "expired" | "none">("none");
  const membershipResolvedRef = useRef(false);
  const previousSummaryRef = useRef<MembershipSummary | null>(sessionMembershipSummary ?? null);
  const nftFetchSeq = useRef(0);
  const lastFetchedAddresses = useRef<string | null>(null);
  const autoRenewClearedRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [autoRenewPromptDismissed, setAutoRenewPromptDismissed] = useState(false);
  const [autoRenewProcessing, setAutoRenewProcessing] = useState(false);
  const [autoRenewMessage, setAutoRenewMessage] = useState<string | null>(null);
  const [autoRenewRefreshKey, setAutoRenewRefreshKey] = useState(0);
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
    if (currentTierOverride === undefined) return;
    if ((currentTierOverride ?? null) === (sessionCurrentMembershipTierId ?? null)) {
      setCurrentTierOverride(undefined);
    }
  }, [currentTierOverride, sessionCurrentMembershipTierId]);

  useEffect(() => {
    if (desiredTierOverride === undefined) return;
    if ((desiredTierOverride ?? null) === (sessionDesiredMembershipTierId ?? null)) {
      setDesiredTierOverride(undefined);
    }
  }, [desiredTierOverride, sessionDesiredMembershipTierId]);
const autoRenewEnabled = typeof autoRenewMonths === 'number' && autoRenewMonths > 0;
const autoRenewPreference = (sessionUser?.autoRenewPreference ?? null) as 'enabled' | 'skipped' | null;
  const effectiveCurrentTierId = currentTierOverride !== undefined ? currentTierOverride : sessionCurrentMembershipTierId;
  const effectiveDesiredTierId = desiredTierOverride !== undefined ? desiredTierOverride : sessionDesiredMembershipTierId;
  const currentTier = useMemo<TierMembershipSummary | null>(() => {
    const explicit = findTierInSummary(membershipSummary, effectiveCurrentTierId ?? undefined);
    if (explicit) return explicit;
    return pickHighestActiveTier(membershipSummary);
  }, [membershipSummary, effectiveCurrentTierId]);
  const desiredTier = useMemo<TierMembershipSummary | null>(() => {
    if (!effectiveDesiredTierId) return null;
    return findTierInSummary(membershipSummary, effectiveDesiredTierId);
  }, [effectiveDesiredTierId, membershipSummary]);
  const normalizedCurrentTierId = normalizeTierId(currentTier?.tier.id ?? currentTier?.tier.address ?? null) ?? null;
  const normalizedDesiredTierId = normalizeTierId(effectiveDesiredTierId ?? null) ?? null;
  const currentTierLabel = useMemo(
    () => resolveTierLabel(currentTier, effectiveCurrentTierId ?? sessionCurrentMembershipTierId),
    [currentTier, effectiveCurrentTierId, sessionCurrentMembershipTierId]
  );
  const desiredTierLabel = useMemo(
    () => resolveTierLabel(desiredTier, effectiveDesiredTierId ?? sessionDesiredMembershipTierId),
    [desiredTier, effectiveDesiredTierId, sessionDesiredMembershipTierId]
  );
  const pendingTierLabel =
    (currentTier?.status === 'active' || membershipStatus === 'active') &&
    normalizedDesiredTierId &&
    normalizedDesiredTierId !== normalizedCurrentTierId &&
    desiredTierLabel
      ? desiredTierLabel
      : null;
  const tierSummaryText = pendingTierLabel
    ? `Tier: ${currentTierLabel ?? 'None selected'} (switch to ${pendingTierLabel} pending upon expiration).`
    : `Tier: ${currentTierLabel ?? 'None selected'}.`;
  const renewalTier = useMemo<TierMembershipSummary | null>(() => {
    if (desiredTier?.status === 'active') return desiredTier;
    if (currentTier?.status === 'active') return currentTier;
    return desiredTier?.status === 'expired' ? desiredTier : null;
  }, [currentTier, desiredTier]);
  const renewalTierAddress = renewalTier?.tier.checksumAddress ?? null;
  const renewalTierLabel = resolveTierLabel(renewalTier, renewalTier?.tier.id);
  const dismissAutoRenewMessage = useCallback(() => {
    setAutoRenewMessage(null);
    setAutoRenewPromptDismissed(true);
  }, []);
  const persistAutoRenewPreference = useCallback(
    async (value: 'enabled' | 'skipped' | 'clear') => {
      try {
        const resp = await fetch('/api/profile/auto-renew', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preference: value }),
        });
        if (!resp.ok) {
          console.error('Persist auto-renew preference failed', await resp.text());
        } else {
          await update({});
        }
      } catch (err) {
        console.error('Persist auto-renew preference error:', err);
      }
    },
    [update]
  );
  const persistTierSelection = useCallback(
    async (values: { currentTierId?: string | null; desiredTierId?: string | null }) => {
      if (!values || typeof values !== 'object') return;
      const prevCurrent = currentTierOverride;
      const prevDesired = desiredTierOverride;
      const payload: Record<string, string | null> = {};
      let shouldUpdateCurrent = false;
      let shouldUpdateDesired = false;

      if (Object.prototype.hasOwnProperty.call(values, 'currentTierId')) {
        const normalized = normalizeTierId(values.currentTierId ?? null);
        if (normalized !== undefined) {
          const target = normalized ?? null;
          const pending = currentTierOverride !== undefined ? currentTierOverride ?? null : sessionCurrentMembershipTierId ?? null;
          if (target !== pending) {
            payload.currentTierId = normalized ?? null;
            shouldUpdateCurrent = true;
            setCurrentTierOverride(target);
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(values, 'desiredTierId')) {
        const normalized = normalizeTierId(values.desiredTierId ?? null);
        if (normalized !== undefined) {
          const target = normalized ?? null;
          const pending = desiredTierOverride !== undefined ? desiredTierOverride ?? null : sessionDesiredMembershipTierId ?? null;
          if (target !== pending) {
            payload.desiredTierId = normalized ?? null;
            shouldUpdateDesired = true;
            setDesiredTierOverride(target);
          }
        }
      }

      if (!shouldUpdateCurrent && !shouldUpdateDesired) {
        return;
      }

      try {
        const resp = await fetch('/api/profile/membership-tier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const detail = await resp.text().catch(() => null);
          console.error('Persist membership tier failed', detail || resp.statusText);
          if (shouldUpdateCurrent) setCurrentTierOverride(prevCurrent);
          if (shouldUpdateDesired) setDesiredTierOverride(prevDesired);
        } else {
          await update({});
        }
      } catch (err) {
        console.error('Persist membership tier error:', err);
        if (shouldUpdateCurrent) setCurrentTierOverride(prevCurrent);
        if (shouldUpdateDesired) setDesiredTierOverride(prevDesired);
      }
    },
    [
      currentTierOverride,
      desiredTierOverride,
      sessionCurrentMembershipTierId,
      sessionDesiredMembershipTierId,
      update,
    ]
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
    if (autoRenewPreference === 'enabled' || autoRenewPreference === 'skipped') {
      setAutoRenewPromptDismissed(true);
    } else if (autoRenewPreference === null && membershipStatus !== 'active') {
      setAutoRenewPromptDismissed(false);
    }
  }, [autoRenewPreference, membershipStatus]);

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
                quickCheckoutConfig: nft.quickCheckoutConfig ?? null,
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

  const handleQuickRegister = useCallback(
    async (checkoutConfig: Record<string, unknown>) => {
      try {
        await paywall.loadCheckoutModal(checkoutConfig);
        if (addressesKey) {
          await loadCreatorNfts(addressesKey, true);
        }
      } catch (err) {
        console.error('Quick register failed', err);
      }
    },
    [paywall, addressesKey, loadCreatorNfts]
  );

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
      // initiate refresh via server API
      const resp = await fetch(`/api/membership/expiry?addresses=${encodeURIComponent(addresses.join(','))}`, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`expiry API: ${resp.status}`);
      const payload = await resp.json();
      const summary: MembershipSummary | null = payload && typeof payload === 'object' && Array.isArray(payload?.tiers)
        ? (payload as MembershipSummary)
        : null;
      const status = (summary?.status ?? payload?.status ?? 'none') as 'active' | 'expired' | 'none';
      const expiry = typeof (summary?.expiry ?? payload?.expiry) === 'number'
        ? Number(summary?.expiry ?? payload?.expiry)
        : null;
      // Only apply if this is the latest refresh
      if (seq === refreshSeq.current) {
        // Prefer fresh expiry if present; otherwise keep prior future-dated expiry
        const preservedExpiry =
          (typeof expiry === 'number' && expiry > 0)
            ? expiry
            : (membershipExpiry && membershipExpiry * 1000 > Date.now() ? membershipExpiry : null);

        setMembershipExpiry(preservedExpiry);
        if (summary) {
          setMembershipSummary(summary);
        }
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
      setMembershipSummary(null);
      lastKnownMembership = { status: 'none', expiry: null, summary: null };
      membershipResolvedRef.current = true;
      return;
    }

    if (sessionMembershipStatus) {
      const sessionStatus = sessionMembershipStatus;
      const sessionExpiry = typeof sessionMembershipExpiry === 'number' ? sessionMembershipExpiry : null;
      const fallback = lastKnownMembership;

      if (sessionStatus === 'active') {
        setMembershipStatus('active');
        setMembershipExpiry(sessionExpiry);
        if (sessionMembershipSummary) {
          setMembershipSummary(sessionMembershipSummary);
        }
        lastKnownMembership = { status: 'active', expiry: sessionExpiry, summary: sessionMembershipSummary ?? fallback?.summary ?? null };
        try { prevStatusRef.current = 'active'; } catch {}
        try {
          const cache = { status: 'active', expiry: sessionExpiry ?? null, at: Math.floor(Date.now()/1000), addresses: addressesKey };
          localStorage.setItem('membershipCache', JSON.stringify(cache));
        } catch {}
        membershipResolvedRef.current = true;
        if (sessionMembershipSummary) {
          return;
        }
      }

      if (fallback?.status === 'active') {
        // Keep showing the last confirmed active state while we re-verify.
        setMembershipStatus('active');
        setMembershipExpiry(fallback.expiry ?? null);
        if (fallback.summary) {
          setMembershipSummary(fallback.summary);
        }
      } else {
        // Unknown while we re-check to avoid flashing onboarding prematurely.
        setMembershipStatus('unknown');
        setMembershipExpiry(sessionExpiry);
        if (sessionMembershipSummary) {
          setMembershipSummary(sessionMembershipSummary);
        }
        membershipResolvedRef.current = false;
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
    sessionMembershipStatus,
    sessionMembershipExpiry,
    sessionMembershipSummary,
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
    const stored = sessionCurrentMembershipTierId ?? null;
    if ((bestId ?? null) === (stored ?? null)) return;
    if (bestId) {
      void persistTierSelection({ currentTierId: bestId });
    } else if (stored) {
      void persistTierSelection({ currentTierId: null });
    }
  }, [
    authenticated,
    membershipSummary,
    currentTierOverride,
    persistTierSelection,
    sessionCurrentMembershipTierId,
  ]);

  useEffect(() => {
    if (!authenticated) {
      previousSummaryRef.current = membershipSummary ?? null;
      return;
    }
    if (!membershipSummary) {
      previousSummaryRef.current = membershipSummary ?? null;
      return;
    }
    if (desiredTierOverride !== undefined) {
      previousSummaryRef.current = membershipSummary ?? null;
      return;
    }

    const knownDesired = sessionDesiredMembershipTierId ?? null;
    const detected = detectRecentlyActivatedTierId(membershipSummary, previousSummaryRef.current);
    let candidate: string | null = null;
    if (detected) {
      candidate = detected;
    } else if (!knownDesired) {
      candidate = pickFallbackDesiredTierId(membershipSummary);
    }

    if (candidate && candidate !== knownDesired) {
      void persistTierSelection({ desiredTierId: candidate });
    }

    previousSummaryRef.current = membershipSummary ?? null;
  }, [
    authenticated,
    membershipSummary,
    desiredTierOverride,
    sessionDesiredMembershipTierId,
    persistTierSelection,
  ]);
  useEffect(() => {
    if (!ready || !authenticated) return;
    if (!walletLinked) return;
    if (membershipStatus === 'active') {
      autoRenewClearedRef.current = false;
      return;
    }
    if (membershipStatus === 'unknown') return;
    if (!membershipResolvedRef.current) return;
    if (autoRenewPreference === null) return;
    if (autoRenewClearedRef.current) return;
    autoRenewClearedRef.current = true;
    void persistAutoRenewPreference('clear');
  }, [
    ready,
    authenticated,
    walletLinked,
    membershipStatus,
    autoRenewPreference,
    persistAutoRenewPreference,
  ]);

  const displayNfts = useMemo(() => {
    const owned = Array.isArray(creatorNfts) ? creatorNfts : [];
    const missedList = Array.isArray(missedNfts) ? missedNfts : [];
    const includeMissed = showAllNfts && missedList.length > 0;
    const source = includeMissed ? [...owned, ...missedList] : [...owned];
    if (!source.length) return [] as typeof owned;

    const enriched = source.map((nft) => {
      const sortValue = (() => {
        if (typeof nft.sortKey === 'number' && Number.isFinite(nft.sortKey)) {
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

    return includeMissed
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
  }, [creatorNfts, missedNfts, showAllNfts]);
  useEffect(() => {
    if (!authenticated || !walletLinked || membershipStatus !== 'active' || !renewalTierAddress) {
      setAutoRenewMonths(null);
      setAutoRenewChecking(false);
      setAutoRenewStateReady(false);
      setCreatorNfts(null);
      setCreatorNftsLoading(false);
      setCreatorNftsError(null);
      lastFetchedAddresses.current = null;
      return;
    }
    if (!USDC_ADDRESS) {
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
    setAutoRenewStateReady(false);
    (async () => {
      try {
        const provider = new JsonRpcProvider(rpcUrl, networkId);
        const erc20 = new Contract(
          USDC_ADDRESS,
          ['function allowance(address owner, address spender) view returns (uint256)'],
          provider
        );
        const lock = new Contract(
          renewalTierAddress,
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
            const allowance: bigint = await erc20.allowance(addr, renewalTierAddress);
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
        if (!cancelled) {
          setAutoRenewChecking(false);
          setAutoRenewStateReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated, walletLinked, addressList, addressesKey, membershipStatus, autoRenewRefreshKey, renewalTierAddress]);

  useEffect(() => {
    if (!authenticated || !walletLinked || membershipStatus !== 'active') return;
    if (!addressesKey) return;
    loadCreatorNfts(addressesKey);
  }, [authenticated, walletLinked, membershipStatus, addressesKey, loadCreatorNfts]);

  useEffect(() => {
    if (!autoRenewReady) return;
    if (!autoRenewEnabled) return;
    if (autoRenewPreference !== 'enabled') {
      void persistAutoRenewPreference('enabled');
    }
    if (!autoRenewPromptDismissed) {
      setAutoRenewPromptDismissed(true);
    }
  }, [autoRenewReady, autoRenewEnabled, autoRenewPreference, autoRenewPromptDismissed, persistAutoRenewPreference]);

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
      const targetAllowance = price * 12n;
      const tierLabelForMessage = renewalTierLabel ? `the ${renewalTierLabel} tier` : 'your membership';
      if (current >= targetAllowance) {
        setAutoRenewMessage(`Auto-renew is already enabled for ${tierLabelForMessage} for up to 12 months at the current price.`);
      } else {
        const tx = await erc20.approve(renewalTierAddress, targetAllowance);
        await tx.wait();
        setAutoRenewMessage(`Auto-renew enabled for ${tierLabelForMessage}. We'll attempt renewals automatically (up to 12 months).`);
      }
      setAutoRenewPromptDismissed(true);
      void persistAutoRenewPreference('enabled');
    } catch (err: any) {
      console.error('Auto-renew enable failed:', err);
      const message = err?.message || 'Failed to enable auto-renew. Please try again from Edit Profile later.';
      setAutoRenewMessage(message);
    } finally {
      setAutoRenewProcessing(false);
      setAutoRenewRefreshKey((value) => value + 1);
    }
  }, [autoRenewProcessing, ensureBaseNetwork, persistAutoRenewPreference, renewalTierAddress, renewalTierLabel]);

  const handleSkipAutoRenew = useCallback(() => {
    setAutoRenewPromptDismissed(true);
    setAutoRenewMessage('You can enable auto-renew anytime from the Edit Profile page.');
    void persistAutoRenewPreference('skipped');
  }, [persistAutoRenewPreference]);

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
      const checkoutConfig = cloneMembershipPaywallConfig() as any;
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
              const payload = await resp.json();
              const summary: MembershipSummary | null = payload && typeof payload === 'object' && Array.isArray(payload?.tiers)
                ? (payload as MembershipSummary)
                : null;
              const status = summary?.status ?? payload?.status;
              const expiry = typeof (summary?.expiry ?? payload?.expiry) === 'number'
                ? Number(summary?.expiry ?? payload?.expiry)
                : null;
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
          <div className="glass-surface space-y-3 p-6 text-center text-[var(--muted-ink)] md:p-8">
            <h2 className="text-xl font-semibold text-[var(--brand-navy)]">Just a moment…</h2>
            <p className="text-sm">
              Confirming your membership and renewal options. This should only take a second.
            </p>
          </div>
        ) : needsAutoRenewStep ? (
          <div className="glass-surface space-y-6 p-6 md:p-8">
            <div className="text-center text-[var(--muted-ink)]">
              Hello {firstName || (session?.user as any)?.email || walletAddress || "member"}! Your membership is active—finish setup by enabling auto-renew or skip it for now.
            </div>
            <OnboardingChecklist
              walletLinked={walletLinked}
              profileComplete={!!(firstName && lastName)}
              membershipStatus={membershipStatus as 'active' | 'expired' | 'none'}
              autoRenewReady={autoRenewReady}
              autoRenewEnabled={autoRenewEnabled}
              autoRenewProcessing={autoRenewProcessing}
              autoRenewDismissed={autoRenewPromptDismissed}
              onEnableAutoRenew={enableAutoRenew}
              onSkipAutoRenew={handleSkipAutoRenew}
            />
            {autoRenewMessageNode}
          </div>
        ) : (
          // Scenario 1: linked wallet has a valid membership -> authorized
          <div className="space-y-8">
            <section className="glass-surface p-6 text-center text-[var(--muted-ink)] md:p-8 md:text-left">
              <p>
                Hello {firstName || (session?.user as any)?.email || walletAddress || "member"}! You’re a member.
              </p>
            </section>
            {autoRenewMessageNode}
            {walletLinked && profileComplete ? (
              viewerUrl ? (
                <section className="glass-surface p-0">
                  <div className="muted-card overflow-hidden">
                    <div className="flex items-center justify-between gap-2 border-b border-[rgba(193,197,226,0.35)] bg-white/80 px-5 py-3">
                      <div className="truncate text-sm font-medium text-[var(--muted-ink)]">Member Content Viewer</div>
                      <Button size="sm" variant="outline" onClick={() => setViewerUrl(null)}>
                        Close
                      </Button>
                    </div>
                    <iframe
                      title="Member content"
                      src={viewerUrl}
                      className="h-[70vh] w-full"
                      sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                    />
                  </div>
                </section>
              ) : (
                <section className="grid gap-5 md:grid-cols-2">
                  {/* Membership Card */}
                  <div className="glass-item space-y-2 p-5">
                    <h2 className="text-lg font-semibold text-[var(--brand-navy)]">Membership</h2>
                    <p className="text-sm text-[var(--muted-ink)]">
                      {typeof membershipExpiry === 'number' && membershipExpiry > 0
                        ? `Active until ${new Date(membershipExpiry * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                        : 'Active'}
                    </p>
                    <p className="text-sm text-[var(--muted-ink)]">{tierSummaryText}</p>
                    {autoRenewChecking ? (
                      <p className="text-sm text-[var(--muted-ink)]">Checking auto-renew allowance…</p>
                    ) : typeof autoRenewMonths === 'number' && autoRenewMonths > 0 ? (
                      <p className="text-sm text-[var(--muted-ink)]">
                        Auto-renew approved for {autoRenewMonths === 1 ? '1 month' : `${autoRenewMonths} months`}.
                      </p>
                    ) : null}
                    <p className="text-xs text-[var(--muted-ink)]">
                      Your membership can renew automatically at expiration when your wallet holds enough USDC for the fee and a small amount of ETH for gas. You can enable or stop auto‑renew anytime from the Edit Profile page.
                    </p>
                  </div>

                  {/* Member Tools (temporarily hidden)
                  <div className="glass-item space-y-3 p-5">
                    <h2 className="text-lg font-semibold text-[var(--brand-navy)]">Member Tools</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        asChild
                        className="shadow-[0_12px_24px_-18px_rgba(67,119,243,0.5)]"
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
                        className="shadow-[0_12px_24px_-18px_rgba(67,119,243,0.5)]"
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
                        className="shadow-[0_12px_24px_-18px_rgba(67,119,243,0.5)]"
                        onClick={async (e) => {
                          e.preventDefault();
                          const url = await getContentUrl("faq.html");
                          setViewerUrl(url);
                        }}
                      >
                        <a href="#">View FAQ</a>
                      </Button>
                    </div>
                    <p className="text-xs text-[var(--muted-ink)]">
                      Experimental preview: these links stream HTML content that normally lives behind our member gate. We only fetch the page when you are logged in, the server-side API confirms your session and active membership, and it returns a short-lived, path-scoped CloudFront URL. That signed URL expires quickly, so the file stays private to authenticated members.
                    </p>
                  </div>
                  */}

                  {upcomingNfts && upcomingNfts.length > 0 ? (
                    <div className="glass-item space-y-4 p-5 md:col-span-2">
                      <div className="flex items-center justify-between gap-2 text-[var(--muted-ink)]">
                        <h2 className="text-lg font-semibold text-[var(--brand-navy)]">Upcoming PGP Meetings</h2>
                        <label className="flex items-center gap-2 text-xs">
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
                                <div
                                  key={`upcoming-${nft.contractAddress}`}
                                  className="muted-card flex gap-3 p-3"
                                >
                                  {nft.image ? (
                                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-white/40">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={nft.image} alt={nft.title} className="h-full w-full object-cover" />
                                    </div>
                                  ) : (
                                    <div className="h-20 w-20 shrink-0 rounded-md bg-white/50" />
                                  )}
                                  <div className="min-w-0 space-y-1">
                                    <div className="font-medium truncate text-[var(--brand-navy)]">{nft.title}</div>
                                    {nft.subtitle ? (
                                      <div className="text-xs text-[var(--muted-ink)]">Date: {nft.subtitle}</div>
                                    ) : null}
                                    {nft.startTime || nft.endTime ? (
                                      <div className="text-xs text-[var(--muted-ink)]">
                                        Time: {nft.startTime ?? 'TBD'}
                                        {nft.endTime ? ` - ${nft.endTime}` : ''}
                                        {nft.timezone ? ` (${nft.timezone})` : ''}
                                      </div>
                                    ) : null}
                                    {nft.location ? (
                                      <div className="text-xs text-[var(--muted-ink)] whitespace-pre-wrap">Location: {nft.location}</div>
                                    ) : null}
                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                      <a
                                        href={nft.registrationUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[var(--brand-denim)] hover:underline"
                                      >
                                        View event details
                                      </a>
                                      {nft.quickCheckoutConfig ? (
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          className="text-xs"
                                          onClick={() => handleQuickRegister(nft.quickCheckoutConfig as Record<string, unknown>)}
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
                        <p className="text-sm text-[var(--muted-ink)]">Turn on to see upcoming meetings available for registration.</p>
                      )}
                    </div>
                  ) : null}

                  {/* NFT/POAPs (placeholder) */}
                  <div className="glass-item space-y-4 p-5 md:col-span-2">
                    <div className="flex items-center justify-between gap-2 text-[var(--muted-ink)]">
                      <h2 className="text-lg font-semibold text-[var(--brand-navy)]">
                        {showAllNfts ? 'All PGP NFTs' : 'Your PGP NFT Collection'}
                      </h2>
                      {missedNfts && missedNfts.length > 0 ? (
                        <label className="flex items-center gap-1 text-xs">
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
                      <p className="text-sm text-[var(--muted-ink)]">Loading your collection…</p>
                    ) : creatorNftsError ? (
                      <p className="text-sm text-red-600 dark:text-red-400">{creatorNftsError}</p>
                    ) : displayNfts.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {displayNfts.map((nft) => {
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
                          const isOwned = Array.isArray(creatorNfts)
                            && creatorNfts.some((owned) => owned.contractAddress === nft.contractAddress && owned.tokenId === nft.tokenId && owned.owner);
                          const eventStart = (() => {
                            if (!nft.eventDate) return null;
                            const zone = nft.timezone || 'UTC';
                            const rawDate = DateTime.fromISO(String(nft.eventDate), { zone });
                            if (rawDate.isValid) {
                              if (nft.startTime) {
                                const combined = DateTime.fromISO(`${rawDate.toISODate()}T${nft.startTime}`, { zone });
                                if (combined.isValid) return combined;
                              }
                              if (String(nft.eventDate).includes('T')) {
                                return rawDate;
                              }
                              return rawDate.endOf('day');
                            }
                            if (nft.startTime) {
                              const fallback = DateTime.fromISO(`${nft.eventDate}T${nft.startTime}`, { zone });
                              if (fallback.isValid) return fallback;
                            }
                            return null;
                          })();
                          const futureTimeMs = (() => {
                            if (eventStart) return eventStart.toUTC().toMillis();
                            const dateParsed = nft.eventDate ? Date.parse(String(nft.eventDate)) : NaN;
                            if (Number.isFinite(dateParsed)) return dateParsed;
                            const subtitleParsed = nft.subtitle ? Date.parse(String(nft.subtitle)) : NaN;
                            if (Number.isFinite(subtitleParsed)) return subtitleParsed;
                            return null;
                          })();
                          const isFutureMeeting = typeof futureTimeMs === 'number' && futureTimeMs > Date.now();
                          const isUpcomingRegistration = isFutureMeeting && isOwned;
                          const eventLabels = formatEventDisplay(
                            nft.eventDate,
                            nft.startTime,
                            nft.endTime,
                            nft.timezone
                          );
                          const showEventDetails = isFutureMeeting && (eventLabels.dateLabel || eventLabels.timeLabel || nft.location);
                          const calendarLinks = showEventDetails
                            ? buildCalendarLinks(
                                nft.title ?? 'PGP Event',
                                nft.eventDate,
                                nft.startTime,
                                nft.endTime,
                                nft.timezone,
                                nft.location,
                                nft.description ?? null
                              )
                            : { google: null, ics: null };
                          const subtitle = showEventDetails
                            ? null
                            : (() => {
                                const text = (nft.subtitle || nft.collectionName || nft.description || '').trim();
                                if (!text) return null;
                                const normalizedTitle = nft.title?.trim().toLowerCase();
                                const normalizedText = text.toLowerCase();
                                if (normalizedTitle && normalizedTitle === normalizedText) return null;
                                if (text.length > 80) return null;
                                return text;
                              })();
                          const shortenedDescription = showEventDetails
                            ? null
                            : (() => {
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
                          const handleDownloadIcs = () => {
                            if (calendarLinks.ics) {
                              downloadIcs(calendarLinks.ics, nft.title || 'PGP Event');
                            }
                          };
                          const ownerKey = 'owner' in nft && nft.owner ? nft.owner : 'none';
                          const tokenIdKey = nft.tokenId ?? 'upcoming';
                          const descriptionKey = `${nft.contractAddress}-${tokenIdKey}-${ownerKey}-description`;
                          const isDescriptionOpen = openDescriptionKey === descriptionKey;
                          return (
                            <div
                              key={`${nft.contractAddress}-${tokenIdKey}-${ownerKey}`}
                              className={`muted-card flex gap-3 p-3 ${
                                isUpcomingRegistration ? 'ring-2 ring-[rgba(67,119,243,0.45)]' : ''
                              } ${isOwned ? '' : 'opacity-80'}`}
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
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="max-w-full truncate font-medium text-[var(--brand-navy)]">{nft.title}</div>
                                  {isUpcomingRegistration ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-100">
                                      <BadgeCheck className="h-3 w-3" /> You&apos;re Registered!
                                    </span>
                                  ) : null}
                                </div>
                                {subtitle ? (
                                  <div className="truncate text-xs text-[var(--muted-ink)]">{subtitle}</div>
                                ) : null}
                                {displayId ? (
                                  <div className="truncate text-xs text-[var(--muted-ink)]">Token #{displayId}</div>
                                ) : null}
                                {showEventDetails ? (
                                  <div className="space-y-1 text-xs text-[var(--muted-ink)]">
                                    {eventLabels.dateLabel ? <div>Date: {eventLabels.dateLabel}</div> : null}
                                    {eventLabels.timeLabel ? <div>Time: {eventLabels.timeLabel}</div> : null}
                                    {nft.location ? (
                                      <div className="whitespace-pre-wrap">Location: {nft.location}</div>
                                    ) : null}
                                    {(calendarLinks.google || calendarLinks.ics) ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                    {calendarLinks.google ? (
                                          <Button asChild size="sm" variant="secondary">
                                            <a
                                              href={calendarLinks.google}
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              Add to Google Calendar
                                            </a>
                                          </Button>
                                        ) : null}
                                        {calendarLinks.ics ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={handleDownloadIcs}
                                          >
                                            Download .ics
                                          </Button>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                                {shortenedDescription ? (
                                  <div className="text-xs text-[var(--muted-ink)]">
                                    {isDescriptionOpen ? (
                                      <div className="space-y-2">
                                        <div className="prose prose-sm dark:prose-invert max-w-none">
                                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {shortenedDescription.fullMarkdown}
                                          </ReactMarkdown>
                                        </div>
                                        <button
                                          type="button"
                                          className="text-xs text-[var(--brand-denim)] hover:underline focus-visible:outline-none"
                                          onClick={() => setOpenDescriptionKey(null)}
                                        >
                                          Hide description
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        className="text-left text-xs text-[var(--brand-denim)] hover:underline focus-visible:outline-none"
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
                                      className="text-xs text-[var(--brand-denim)] hover:underline"
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
                      <p className="text-sm text-[var(--muted-ink)]">
                        No creator NFTs or POAPs detected yet. Join community events to start collecting!
                      </p>
                    )}
                  </div>

                  {/* News / Updates (placeholder) */}
                  <div className="glass-item space-y-2 p-5 md:col-span-2">
                    <h2 className="text-lg font-semibold text-[var(--brand-navy)]">News & Updates</h2>
                    <p className="text-sm text-[var(--muted-ink)]">Member announcements and updates will appear here.</p>
                  </div>
                </section>
              )
            ) : (
              <OnboardingChecklist
                walletLinked={walletLinked}
                profileComplete={profileComplete}
                membershipStatus="active"
                autoRenewReady={autoRenewReady}
                autoRenewEnabled={autoRenewEnabled}
                autoRenewProcessing={autoRenewProcessing}
                autoRenewDismissed={autoRenewPromptDismissed}
                onEnableAutoRenew={enableAutoRenew}
                onSkipAutoRenew={handleSkipAutoRenew}
              />
            )}
          </div>
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
            <AlertDialogAction onClick={() => { setConfirmOpen(false); purchaseMembership(); }}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
    </div>
  );
}
