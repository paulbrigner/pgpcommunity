"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import { Paywall } from "@unlock-protocol/paywall";
import { networks } from "@unlock-protocol/networks";
import {
  BASE_BLOCK_EXPLORER_URL,
  BASE_CHAIN_ID_HEX,
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  MEMBERSHIP_TIERS,
  USDC_ADDRESS,
} from "@/lib/config";
import { buildSingleLockCheckoutConfig } from "@/lib/membership-paywall";
import type { MembershipSummary, TierMembershipSummary } from "@/lib/membership-server";
import {
  detectRecentlyActivatedTierId,
  findTierInSummary,
  normalizeTierId,
  pickFallbackDesiredTierId,
  pickHighestActiveTier,
  resolveTierLabel,
} from "@/lib/membership-tiers";
import {
  clearPrefetchedMembership,
  loadPrefetchedMembershipFor,
  savePrefetchedMembership,
} from "@/lib/membership-prefetch";

const MAX_AUTO_RENEW_MONTHS: number = 12;

export default function MembershipSettingsPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const ready = status !== "loading";
  const authenticated = status === "authenticated";

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [autoRenewChecking, setAutoRenewChecking] = useState(false);
  const [autoRenewPrice, setAutoRenewPrice] = useState<bigint | null>(null);
  const [autoRenewMonths, setAutoRenewMonths] = useState<number | null>(null);
  const [enablingAutoRenew, setEnablingAutoRenew] = useState(false);
  const [tierSwitching, setTierSwitching] = useState(false);
  const [selectedTierAddress, setSelectedTierAddress] = useState<string>("");

  const sessionUser = session?.user as any | undefined;
  const sessionCurrentMembershipTierId =
    typeof sessionUser?.currentMembershipTierId === "string" && sessionUser.currentMembershipTierId.trim().length
      ? sessionUser.currentMembershipTierId.trim().toLowerCase()
      : null;
  const sessionDesiredMembershipTierId =
    typeof sessionUser?.lastMembershipTierId === "string" && sessionUser.lastMembershipTierId.trim().length
      ? sessionUser.lastMembershipTierId.trim().toLowerCase()
      : null;
  const wallets = useMemo(() => {
    const list = sessionUser?.wallets;
    return Array.isArray(list) ? list.map((item) => String(item)) : [];
  }, [sessionUser]);
  const walletAddress = sessionUser?.walletAddress as string | undefined;
  const membershipAddresses = useMemo(() => {
    const sources = wallets && wallets.length ? wallets : walletAddress ? [walletAddress] : [];
    return Array.from(
      new Set(
        sources
          .map((addr) => String(addr).trim().toLowerCase())
          .filter((addr) => addr.length > 0),
      ),
    );
  }, [walletAddress, wallets]);
  const prefetchedMembership = membershipAddresses.length ? loadPrefetchedMembershipFor(membershipAddresses) : null;

  const [currentTierOverride, setCurrentTierOverride] = useState<string | null | undefined>(undefined);
  const [desiredTierOverride, setDesiredTierOverride] = useState<string | null | undefined>(undefined);

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

  const sessionMembershipSummary = sessionUser?.membershipSummary as MembershipSummary | null | undefined;
  const sessionMembershipStatus = (sessionMembershipSummary?.status ?? sessionUser?.membershipStatus) as
    | "active"
    | "expired"
    | "none"
    | undefined;
  const sessionMembershipExpiry =
    sessionMembershipSummary?.expiry ?? (sessionUser?.membershipExpiry as number | null | undefined) ?? null;
  const initialSummary = sessionMembershipSummary ?? prefetchedMembership?.summary ?? null;
  const initialStatus = sessionMembershipStatus ?? prefetchedMembership?.status ?? "unknown";
  const initialExpiry =
    sessionMembershipSummary?.expiry ?? prefetchedMembership?.expiry ?? sessionMembershipExpiry ?? null;
  const [membershipSummary, setMembershipSummary] = useState<MembershipSummary | null>(initialSummary);
  const [membershipStatus, setMembershipStatus] = useState<"active" | "expired" | "none" | "unknown">(initialStatus);
  const [membershipExpiry, setMembershipExpiry] = useState<number | null>(initialExpiry);
  const [membershipChecking, setMembershipChecking] = useState(false);
  const previousSummaryRef = useRef<MembershipSummary | null>(sessionMembershipSummary ?? null);

  useEffect(() => {
    if (!prefetchedMembership) return;
    if (!membershipSummary && prefetchedMembership.summary) {
      setMembershipSummary(prefetchedMembership.summary);
    }
    if (membershipStatus === "unknown") {
      setMembershipStatus(prefetchedMembership.status);
    }
    if ((membershipExpiry === null || typeof membershipExpiry !== "number") && typeof prefetchedMembership.expiry === "number") {
      setMembershipExpiry(prefetchedMembership.expiry);
    }
  }, [membershipExpiry, membershipStatus, membershipSummary, prefetchedMembership]);

  const paywall = useMemo(() => {
    return new Paywall({
      ...networks,
      [BASE_NETWORK_ID]: {
        ...networks[BASE_NETWORK_ID],
        provider: BASE_RPC_URL,
      },
    });
  }, []);

  const persistAutoRenewPreference = useCallback(
    async (value: "enabled" | "skipped" | "clear") => {
      try {
        const resp = await fetch("/api/profile/auto-renew", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preference: value }),
        });
        if (!resp.ok) {
          console.error("Persist auto-renew preference failed", await resp.text());
        } else {
          await update({});
        }
      } catch (err) {
        console.error("Persist auto-renew preference error:", err);
      }
    },
    [update],
  );

  const persistTierSelection = useCallback(
    async (values: { currentTierId?: string | null; desiredTierId?: string | null }) => {
      if (!values || typeof values !== "object") return;
      const prevCurrent = currentTierOverride;
      const prevDesired = desiredTierOverride;
      const payload: Record<string, string | null> = {};
      let shouldUpdateCurrent = false;
      let shouldUpdateDesired = false;

      if (Object.prototype.hasOwnProperty.call(values, "currentTierId")) {
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

      if (Object.prototype.hasOwnProperty.call(values, "desiredTierId")) {
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
        const resp = await fetch("/api/profile/membership-tier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const detail = await resp.text().catch(() => null);
          console.error("Persist membership tier failed", detail || resp.statusText);
          if (shouldUpdateCurrent) setCurrentTierOverride(prevCurrent);
          if (shouldUpdateDesired) setDesiredTierOverride(prevDesired);
        } else {
          await update({});
        }
      } catch (err) {
        console.error("Persist membership tier error:", err);
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
    ],
  );

  const maxMonthsLabel = `${MAX_AUTO_RENEW_MONTHS} ${MAX_AUTO_RENEW_MONTHS === 1 ? "month" : "months"}`;
  const yearText = MAX_AUTO_RENEW_MONTHS === 12 ? "1 year" : null;
  const maxMonthsWithYear = yearText ? `${maxMonthsLabel} (${yearText})` : maxMonthsLabel;
  const formattedMembershipExpiry =
    typeof membershipExpiry === "number" && membershipExpiry > 0
      ? new Date(membershipExpiry * 1000).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : null;

  const effectiveCurrentTierId = currentTierOverride !== undefined ? currentTierOverride : sessionCurrentMembershipTierId;
  const effectiveDesiredTierId = desiredTierOverride !== undefined ? desiredTierOverride : sessionDesiredMembershipTierId;

  const currentTier = useMemo<TierMembershipSummary | null>(() => {
    const explicit = findTierInSummary(membershipSummary, effectiveCurrentTierId ?? undefined);
    if (explicit) return explicit;
    return pickHighestActiveTier(membershipSummary);
  }, [membershipSummary, effectiveCurrentTierId]);
  const currentTierAddress = currentTier?.tier.checksumAddress ?? null;
  const currentTierLabel = useMemo(
    () => resolveTierLabel(currentTier, effectiveCurrentTierId ?? sessionCurrentMembershipTierId),
    [currentTier, effectiveCurrentTierId, sessionCurrentMembershipTierId],
  );

  const desiredTier = useMemo<TierMembershipSummary | null>(() => {
    if (!effectiveDesiredTierId) return null;
    return findTierInSummary(membershipSummary, effectiveDesiredTierId);
  }, [effectiveDesiredTierId, membershipSummary]);
  const normalizedCurrentTierId = normalizeTierId(currentTier?.tier.id ?? currentTier?.tier.address ?? null) ?? null;
  const normalizedDesiredTierId = normalizeTierId(effectiveDesiredTierId ?? null) ?? null;
  const desiredTierLabel = useMemo(
    () => resolveTierLabel(desiredTier, effectiveDesiredTierId ?? sessionDesiredMembershipTierId),
    [desiredTier, effectiveDesiredTierId, sessionDesiredMembershipTierId],
  );
  const pendingTierLabel =
    (currentTier?.status === "active" || membershipStatus === "active") &&
    normalizedDesiredTierId &&
    normalizedDesiredTierId !== normalizedCurrentTierId &&
    desiredTierLabel
      ? desiredTierLabel
      : null;
  const tierSummaryText = pendingTierLabel
    ? `Tier: ${currentTierLabel ?? "None selected"} (switch to ${pendingTierLabel} pending upon expiration).`
    : `Tier: ${currentTierLabel ?? "None selected"}.`;

  const renewalTier = useMemo<TierMembershipSummary | null>(() => {
    if (desiredTier?.status === "active") return desiredTier;
    if (currentTier?.status === "active") return currentTier;
    return desiredTier?.status === "expired" ? desiredTier : null;
  }, [currentTier, desiredTier]);
  const renewalTierAddress = renewalTier?.tier.checksumAddress ?? null;
  const tierOptions = useMemo(() => {
    return MEMBERSHIP_TIERS.map((tier, index) => {
      const summary = membershipSummary?.tiers?.find(
        (entry) => entry.tier.checksumAddress.toLowerCase() === tier.checksumAddress.toLowerCase(),
      );
      const status = summary?.status ?? "none";
      const expiry = typeof summary?.expiry === "number" && Number.isFinite(summary.expiry) ? summary.expiry : null;
      const expiryLabel = expiry
        ? new Date(expiry * 1000).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : null;
      const baseLabel = tier.label || summary?.metadata?.name || `Tier ${index + 1}`;
      let detail = "Not owned yet";
      if (status === "active") {
        detail = expiryLabel ? `Active · expires ${expiryLabel}` : "Active";
      } else if (status === "expired") {
        detail = expiryLabel ? `Expired · ${expiryLabel}` : "Expired";
      }
      return {
        tier,
        summary: summary ?? null,
        value: tier.checksumAddress,
        label: `${baseLabel} — ${detail}`,
        detail,
        status,
        baseLabel,
      };
    });
  }, [membershipSummary]);

  const selectedTierOption = useMemo(() => {
    if (!selectedTierAddress) return null;
    return tierOptions.find((option) => option.value.toLowerCase() === selectedTierAddress.toLowerCase()) ?? null;
  }, [tierOptions, selectedTierAddress]);

  const refreshMembershipSummary = useCallback(async (): Promise<MembershipSummary | null> => {
    if (!authenticated) {
      return null;
    }
    const su: any = sessionUser || {};
    const addresses = membershipAddresses;

    if (!addresses.length) {
      setMembershipSummary(null);
      setMembershipStatus("none");
      setMembershipExpiry(null);
      setMembershipChecking(false);
      clearPrefetchedMembership();
      return null;
    }

    if (sessionMembershipSummary) {
      setMembershipSummary(sessionMembershipSummary);
      setMembershipStatus(sessionMembershipSummary.status);
      setMembershipExpiry(sessionMembershipSummary.expiry ?? null);
      savePrefetchedMembership({
        summary: sessionMembershipSummary,
        status: sessionMembershipSummary.status,
        expiry: sessionMembershipSummary.expiry ?? null,
        addresses,
      });
    } else if (su.membershipStatus) {
      const fallbackStatus =
        su.membershipStatus === "active" || su.membershipStatus === "expired" ? su.membershipStatus : "none";
      const fallbackExpiry = typeof su.membershipExpiry === "number" ? su.membershipExpiry : null;
      setMembershipStatus(fallbackStatus);
      setMembershipExpiry(fallbackExpiry);
      savePrefetchedMembership({
        summary: null,
        status: fallbackStatus,
        expiry: fallbackExpiry,
        addresses,
      });
    }

    setMembershipChecking(true);
    try {
      const resp = await fetch(`/api/membership/expiry?addresses=${encodeURIComponent(addresses.join(","))}`, {
        cache: "no-store",
      });
      if (resp.ok) {
        const payload = await resp.json();
        const summary: MembershipSummary | null =
          payload && typeof payload === "object" && Array.isArray(payload?.tiers) ? (payload as MembershipSummary) : null;
        if (summary) {
          setMembershipSummary(summary);
          setMembershipStatus(summary.status);
          setMembershipExpiry(summary.expiry ?? null);
          savePrefetchedMembership({
            summary,
            status: summary.status,
            expiry: summary.expiry ?? null,
            addresses,
          });
          return summary;
        } else {
          const status = (payload?.status ?? "none") as "active" | "expired" | "none";
          const expiry = typeof payload?.expiry === "number" ? payload.expiry : null;
          setMembershipSummary(null);
          setMembershipStatus(status);
          setMembershipExpiry(expiry);
          savePrefetchedMembership({
            summary: null,
            status,
            expiry,
            addresses,
          });
        }
      } else {
        clearPrefetchedMembership();
      }
    } catch (err) {
      console.error("Membership check failed:", err);
      clearPrefetchedMembership();
    } finally {
      setMembershipChecking(false);
    }

    return null;
  }, [authenticated, membershipAddresses, sessionMembershipSummary, sessionUser]);

  useEffect(() => {
    void refreshMembershipSummary();
  }, [refreshMembershipSummary]);

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
  }, [authenticated, membershipSummary, currentTierOverride, persistTierSelection, sessionCurrentMembershipTierId]);

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

  const checkAutoRenewStatus = useCallback(async () => {
    if (!authenticated) {
      setAutoRenewPrice(null);
      setAutoRenewMonths(null);
      setAutoRenewChecking(false);
      return;
    }
    if (!renewalTierAddress) {
      setAutoRenewPrice(null);
      setAutoRenewMonths(null);
      setAutoRenewChecking(false);
      return;
    }
    setAutoRenewChecking(true);
    try {
      if (!USDC_ADDRESS || !renewalTierAddress) throw new Error("Missing contract addresses");
      const owner = walletAddress || (wallets && wallets[0]) || null;
      if (!owner) {
        setAutoRenewPrice(null);
        setAutoRenewMonths(null);
        return;
      }
      const provider = new JsonRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
      const erc20 = new Contract(
        USDC_ADDRESS,
        ["function allowance(address owner, address spender) view returns (uint256)"],
        provider,
      );
      const lock = new Contract(
        renewalTierAddress,
        ["function keyPrice() view returns (uint256)"],
        provider,
      );
      let price: bigint = 0n;
      try {
        price = await lock.keyPrice();
      } catch {
        price = 100000n;
      }
      if (price <= 0n) {
        setAutoRenewPrice(null);
        setAutoRenewMonths(null);
        return;
      }
      const allowance: bigint = await erc20.allowance(owner, renewalTierAddress);
      const months = Number(allowance / price);
      setAutoRenewPrice(price);
      setAutoRenewMonths(months);
    } catch {
      setAutoRenewPrice(null);
      setAutoRenewMonths(null);
    } finally {
      setAutoRenewChecking(false);
    }
  }, [authenticated, renewalTierAddress, walletAddress, wallets]);

  useEffect(() => {
    void checkAutoRenewStatus();
  }, [checkAutoRenewStatus]);

  const ensureBaseNetwork = useCallback(async (eth: any) => {
    const targetHex = BASE_CHAIN_ID_HEX;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetHex }],
      });
    } catch (err: any) {
      const code = err?.code ?? err?.data?.originalError?.code;
      if (code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: targetHex,
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

  const disableAutoRenewForTier = useCallback(
    async (tierAddress: string | null | undefined) => {
      if (!USDC_ADDRESS || !tierAddress) {
        throw new Error("Missing contract addresses");
      }
      const eth = (globalThis as any).ethereum;
      if (!eth) {
        throw new Error("No wallet found in browser");
      }
      await ensureBaseNetwork(eth);
      const provider = new BrowserProvider(eth, BASE_NETWORK_ID);
      const signer = await provider.getSigner();
      const owner = await signer.getAddress();
      const erc20 = new Contract(
        USDC_ADDRESS,
        [
          "function allowance(address owner, address spender) view returns (uint256)",
          "function approve(address spender, uint256 amount) returns (bool)",
        ],
        signer,
      );
      const current: bigint = await erc20.allowance(owner, tierAddress);
      if (current === 0n) {
        return { changed: false, message: "Auto-renew is already disabled (no active approval)." };
      }
      const tx = await erc20.approve(tierAddress, 0n);
      await tx.wait();
      return { changed: true, message: "Auto-renew disabled. Future renewals will not occur." };
    },
    [ensureBaseNetwork],
  );

  const disableAutoRenewForCurrentTier = useCallback(
    () => disableAutoRenewForTier(currentTierAddress),
    [disableAutoRenewForTier, currentTierAddress],
  );

  const disableAutoRenewForDesiredTier = useCallback(
    () => disableAutoRenewForTier(renewalTierAddress),
    [disableAutoRenewForTier, renewalTierAddress],
  );

  const handleTierSwitch = useCallback(async () => {
    if (!selectedTierOption?.tier) {
      setError("Please select a membership tier to purchase.");
      return;
    }
    if (wallets.length === 0 && !walletAddress) {
      setError("Link a wallet before purchasing a membership tier.");
      return;
    }
    setError(null);
    setMessage(null);
    setTierSwitching(true);
    try {
      const previousTierAddress = currentTierAddress || null;
      const previousTierLabel = currentTierLabel || null;
      const targetTierAddress = selectedTierOption.tier.checksumAddress;
      const targetTierLower = targetTierAddress.toLowerCase();
      const switchingTier = Boolean(previousTierAddress && previousTierAddress.toLowerCase() !== targetTierLower);

      let disableMessage: string | null = null;
      let previousTierNote: string | null = null;

      if (switchingTier && currentTierAddress) {
        const result = await disableAutoRenewForCurrentTier();
        disableMessage = previousTierLabel ? `${result.message} (Tier: ${previousTierLabel}).` : result.message;
        setAutoRenewMonths(0);
        void persistAutoRenewPreference("skipped");
        void checkAutoRenewStatus();
      }

      const provider = (window as any)?.ethereum;
      if (!provider) {
        throw new Error("No wallet found in browser");
      }
      await paywall.connect(provider);
      const checkoutConfig = buildSingleLockCheckoutConfig(targetTierAddress);
      await paywall.loadCheckoutModal(checkoutConfig);

      let newTierDetected = false;
      const addresses = (wallets && wallets.length ? wallets : walletAddress ? [walletAddress] : [])
        .map((addr) => String(addr).toLowerCase());
      if (addresses.length) {
        for (let i = 0; i < 5; i++) {
          try {
            const resp = await fetch(`/api/membership/expiry?addresses=${encodeURIComponent(addresses.join(","))}`, {
              cache: "no-store",
            });
            if (resp.ok) {
              const payload = await resp.json();
              const summary: MembershipSummary | null =
                payload && typeof payload === "object" && Array.isArray(payload?.tiers) ? (payload as MembershipSummary) : null;
              if (summary?.tiers?.length) {
                const detected = summary.tiers.find((tier) => tier.tier.checksumAddress.toLowerCase() === targetTierLower);
                if (detected?.status === "active") {
                  newTierDetected = true;
                  break;
                }
              } else {
                const status = summary?.status ?? payload?.status;
                const expiry = typeof (summary?.expiry ?? payload?.expiry) === "number"
                  ? Number(summary?.expiry ?? payload?.expiry)
                  : null;
                const nowSec = Math.floor(Date.now() / 1000);
                if (status === "active" || (typeof expiry === "number" && expiry > nowSec)) {
                  break;
                }
              }
            }
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }

      let refreshedSummary: MembershipSummary | null = null;
      try {
        refreshedSummary = await refreshMembershipSummary();
      } catch {}

      const summaryForCheck = refreshedSummary ?? membershipSummary;
      if (!newTierDetected && summaryForCheck?.tiers?.length) {
        const detected = summaryForCheck.tiers.find((tier) => tier.tier.checksumAddress.toLowerCase() === targetTierLower);
        if (detected?.status === "active") {
          newTierDetected = true;
        }
      }

      if (switchingTier && previousTierLabel) {
        previousTierNote = newTierDetected
          ? `Your previous membership (${previousTierLabel}) will remain active until it expires.`
          : `We could not confirm your new membership yet. If checkout completed, your previous membership (${previousTierLabel}) will remain active until it expires.`;
      } else if (!newTierDetected) {
        previousTierNote =
          "We could not confirm your new membership yet. If checkout completed, your membership details will update shortly.";
      }

      if (newTierDetected) {
        void persistTierSelection({ desiredTierId: selectedTierOption.tier.id });
      }

      try {
        await update({});
      } catch {}

      const tierName = selectedTierOption.baseLabel;
      const parts: string[] = [];
      if (disableMessage) {
        parts.push(disableMessage);
      }
      if (previousTierNote) {
        parts.push(previousTierNote);
      }
      if (newTierDetected) {
        parts.push(`If you completed checkout for the ${tierName} tier, your membership details will update shortly.`);
      } else if (!previousTierNote) {
        parts.push(
          "We could not confirm your new membership yet. If checkout completed, your membership details will update shortly.",
        );
      }
      setMessage(parts.join(" "));
    } catch (err: any) {
      setError(err?.message || "Failed to start membership checkout");
    } finally {
      setTierSwitching(false);
    }
  }, [
    currentTierAddress,
    currentTierLabel,
    disableAutoRenewForCurrentTier,
    membershipSummary,
    paywall,
    persistAutoRenewPreference,
    persistTierSelection,
    checkAutoRenewStatus,
    refreshMembershipSummary,
    selectedTierOption,
    update,
    walletAddress,
    wallets,
  ]);

  if (!ready) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!authenticated) {
    return (
      <div className="space-y-4">
        <p>You need to sign in to manage your membership.</p>
        <Button onClick={() => router.push("/signin?callbackUrl=/settings/profile/membership")}>Sign in</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => router.push("/")}>
          ← Back to Home
        </Button>
      </div>
      {message && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <section className="space-y-4 rounded-lg border p-6 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Membership</h2>
          <p className="text-sm text-muted-foreground">
            Check your current Unlock membership status and manage auto-renewal approvals.
          </p>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{tierSummaryText}</p>
          <p>
            Current price: {autoRenewPrice !== null ? (Number(autoRenewPrice) / 1_000_000).toFixed(2) : "Unknown"} USDC per month
          </p>
          <p>
            {membershipChecking ? (
              "Checking membership status…"
            ) : membershipStatus === "active" ? (
              formattedMembershipExpiry ? `Membership active until ${formattedMembershipExpiry}.` : "Membership is currently active."
            ) : membershipStatus === "expired" ? (
              formattedMembershipExpiry ? `Membership expired on ${formattedMembershipExpiry}.` : "Membership has expired."
            ) : membershipStatus === "none" ? (
              "You do not have an active membership yet."
            ) : (
              "Membership status unavailable."
            )}
          </p>
          <p>
            To stop automatic renewals, revoke the USDC approval granted to the membership lock. This prevents future renewals;
            your current period remains active until it expires.
          </p>
        </div>
        <div className="text-sm">
          {autoRenewChecking ? (
            <span className="text-muted-foreground">Checking auto‑renew status…</span>
          ) : autoRenewMonths === null ? (
            <span className="text-muted-foreground">Auto‑renew status unavailable.</span>
          ) : autoRenewMonths > 0 ? (
            <span
              className={
                autoRenewMonths >= MAX_AUTO_RENEW_MONTHS
                  ? "text-green-600 dark:text-green-400"
                  : "text-amber-600 dark:text-amber-400"
              }
            >
              {autoRenewMonths >= MAX_AUTO_RENEW_MONTHS
                ? `Auto-renew is enabled for up to ${autoRenewMonths === 1 ? "1 month" : `${autoRenewMonths} months`} at the current price${
                    autoRenewMonths === MAX_AUTO_RENEW_MONTHS && yearText ? ` (${yearText} maximum).` : "."
                  }`
                : `Auto-renew approvals cover ${
                    autoRenewMonths === 1 ? "1 month" : `${autoRenewMonths} months`
                  }, which is below the ${MAX_AUTO_RENEW_MONTHS}-month maximum.`}
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">Auto‑renew is off (0 months approved).</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={
              canceling ||
              wallets.length === 0 ||
              autoRenewChecking ||
              (autoRenewMonths ?? 0) === 0 ||
              !renewalTierAddress
            }
            onClick={async () => {
              setError(null);
              setMessage(null);
              setCanceling(true);
            try {
              const result = await disableAutoRenewForDesiredTier();
              setMessage(result.message);
              setAutoRenewMonths(0);
              void persistAutoRenewPreference("skipped");
              void checkAutoRenewStatus();
            } catch (err: any) {
              setError(err?.message || "Failed to disable auto‑renew");
            } finally {
              setCanceling(false);
            }
            }}
          >
            {canceling ? "Disabling…" : "Disable auto‑renew"}
          </Button>
          <Button
            disabled={
              enablingAutoRenew ||
              autoRenewChecking ||
              wallets.length === 0 ||
              !renewalTierAddress ||
              !USDC_ADDRESS
            }
            onClick={async () => {
              setError(null);
              setMessage(null);
              setEnablingAutoRenew(true);
              try {
                const eth = (globalThis as any).ethereum;
                if (!eth) {
                  throw new Error("No wallet found in browser");
                }
                await ensureBaseNetwork(eth);
                const provider = new BrowserProvider(eth, BASE_NETWORK_ID);
                const signer = await provider.getSigner();
                const owner = await signer.getAddress();
                const erc20 = new Contract(
                  USDC_ADDRESS,
                  [
                    "function allowance(address owner, address spender) view returns (uint256)",
                    "function approve(address spender, uint256 amount) returns (bool)",
                  ],
                  signer,
                );
                if (!renewalTierAddress) {
                  throw new Error("No membership tier selected");
                }
                const lock = new Contract(renewalTierAddress, ["function keyPrice() view returns (uint256)"], signer);
                const price: bigint = await lock.keyPrice();
                if (price <= 0n) {
                  throw new Error("Tier price unavailable");
                }
                const desired = price * BigInt(MAX_AUTO_RENEW_MONTHS);
                const current: bigint = await erc20.allowance(owner, renewalTierAddress);
                if (current === desired) {
                  setMessage(`Auto-renew is already approved for ${maxMonthsWithYear}.`);
                } else {
                  const tx = await erc20.approve(renewalTierAddress, desired);
                  await tx.wait();
                  setMessage(
                    (autoRenewMonths ?? 0) > 0
                      ? `Auto-renew approvals topped up to ${maxMonthsWithYear}.`
                      : `Auto-renew enabled for ${maxMonthsWithYear}.`,
                  );
                }
                setAutoRenewMonths(MAX_AUTO_RENEW_MONTHS);
                void persistAutoRenewPreference("enabled");
                void checkAutoRenewStatus();
              } catch (err: any) {
                setError(err?.message || "Failed to enable auto‑renew");
              } finally {
                setEnablingAutoRenew(false);
              }
            }}
          >
            {enablingAutoRenew
              ? "Approving…"
              : (autoRenewMonths ?? 0) > 0
              ? `Top up auto‑renew to ${maxMonthsWithYear}`
              : `Enable auto‑renew (approve ${maxMonthsLabel}${yearText ? ` / ${yearText}` : ""})`}
          </Button>
        </div>
        <div className="mt-6 space-y-3 border-t pt-4">
          <div className="space-y-1">
            <h3 className="text-md font-semibold">Upgrade or downgrade your membership</h3>
            <p className="text-sm text-muted-foreground">
              Select a different tier to purchase. We&apos;ll disable auto-renew on your current tier before opening checkout for the new selection.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              className="w-full flex-1 rounded-md border px-3 py-2 text-sm dark:border-input dark:bg-input/30"
              value={selectedTierAddress}
              onChange={(event) => setSelectedTierAddress(event.target.value)}
            >
              <option value="">Select a tier…</option>
              {tierOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button
              onClick={handleTierSwitch}
              disabled={tierSwitching || !selectedTierOption || (wallets.length === 0 && !walletAddress)}
            >
              {tierSwitching
                ? "Preparing checkout…"
                : selectedTierOption
                ? `Open checkout for ${selectedTierOption.baseLabel}`
                : "Open checkout"}
            </Button>
          </div>
          {selectedTierOption ? (
            <p className="text-xs text-muted-foreground">{selectedTierOption.detail}</p>
          ) : null}
          {currentTierLabel ? (
            <p className="text-xs text-muted-foreground">
              Auto-renew will be disabled for your current tier ({currentTierLabel}) before checkout launches.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
