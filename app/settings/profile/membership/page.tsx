"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { BrowserProvider, Contract } from "ethers";
import {
  BASE_BLOCK_EXPLORER_URL,
  BASE_CHAIN_ID_HEX,
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  MEMBERSHIP_TIERS,
  USDC_ADDRESS,
} from "@/lib/config";
import { useUnlockCheckout, type UnlockCheckoutCompletionContext } from "@/lib/unlock-checkout";
import type { MembershipSummary, TierMembershipSummary } from "@/lib/membership-server";
import { snapshotToMembershipSummary, type AllowanceState } from "@/lib/membership-state-service";
import { findTierInSummary, normalizeTierId, pickHighestActiveTier, pickNextActiveTier, resolveTierLabel } from "@/lib/membership-tiers";
import { fetchMembershipStateSnapshot } from "@/app/actions/membership-state";

const MAX_AUTO_RENEW_MONTHS: number = 12;
const SAFE_ALLOWANCE_CAP = 2n ** 200n;

const computeAutoRenewAllowance = (price: bigint): bigint => {
  if (price <= 0n) {
    throw new Error("Tier price unavailable");
  }
  const target = price * BigInt(MAX_AUTO_RENEW_MONTHS);
  if (target >= SAFE_ALLOWANCE_CAP) {
    throw new Error("Refusing to request an unlimited allowance. Please retry after reloading price data.");
  }
  return target;
};

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
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [refundMessage, setRefundMessage] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundStatus, setRefundStatus] = useState<"pending" | "processing" | "completed" | "rejected" | null>(null);
  const [refundPostCancelPreference, setRefundPostCancelPreference] = useState<"keep-free" | "cancel-all">("keep-free");
  const [memberCanceling, setMemberCanceling] = useState(false);
  const [memberCancelPending, setMemberCancelPending] = useState(false);
  const [memberCancelMessage, setMemberCancelMessage] = useState<string | null>(null);
  const [memberCancelError, setMemberCancelError] = useState<string | null>(null);
  const [memberCancelTxHash, setMemberCancelTxHash] = useState<string | null>(null);
  const memberCancelPollIdRef = useRef(0);
  const memberEnsureAttemptedRef = useRef(false);
  const [memberEnsureProcessing, setMemberEnsureProcessing] = useState(false);
  const [memberEnsureMessage, setMemberEnsureMessage] = useState<string | null>(null);
  const [memberEnsureError, setMemberEnsureError] = useState<string | null>(null);

  const sessionUser = session?.user as any | undefined;
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
  const [currentTierOverride, setCurrentTierOverride] = useState<string | null | undefined>(undefined);
  const [allowances, setAllowances] = useState<Record<string, AllowanceState>>({});

  const sessionMembershipSummary = sessionUser?.membershipSummary as MembershipSummary | null | undefined;
  const sessionMembershipStatus = (sessionMembershipSummary?.status ?? sessionUser?.membershipStatus) as
    | "active"
    | "expired"
    | "none"
    | undefined;
  const sessionMembershipExpiry =
    sessionMembershipSummary?.expiry ?? (sessionUser?.membershipExpiry as number | null | undefined) ?? null;
  const initialSummary = sessionMembershipSummary ?? null;
  const initialStatus = sessionMembershipStatus ?? "unknown";
  const initialExpiry = sessionMembershipSummary?.expiry ?? sessionMembershipExpiry ?? null;
  const [membershipSummary, setMembershipSummary] = useState<MembershipSummary | null>(initialSummary);
  const [membershipStatus, setMembershipStatus] = useState<"active" | "expired" | "none" | "unknown">(initialStatus);
  const [membershipExpiry, setMembershipExpiry] = useState<number | null>(initialExpiry);
  const [membershipChecking, setMembershipChecking] = useState(false);
  const previousSummaryRef = useRef<MembershipSummary | null>(sessionMembershipSummary ?? null);
  const pendingTierSwitchRef = useRef<{
    targetTierAddress: string;
    targetTierLower: string;
    targetTierId: string;
    targetTierLabel: string;
    disableMessage: string | null;
    previousTierLabel: string | null;
    switchingTier: boolean;
    addresses: string[];
  } | null>(null);


  const persistTierSelection = useCallback(
    (values: { currentTierId?: string | null }) => {
      if (!values || typeof values !== "object") return;

      if (Object.prototype.hasOwnProperty.call(values, "currentTierId")) {
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
    [currentTierOverride],
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

  const effectiveCurrentTierId = currentTierOverride !== undefined ? currentTierOverride : null;

  const currentTier = useMemo<TierMembershipSummary | null>(() => {
    const explicit = findTierInSummary(membershipSummary, effectiveCurrentTierId ?? undefined);
    if (explicit) return explicit;
    return pickHighestActiveTier(membershipSummary);
  }, [membershipSummary, effectiveCurrentTierId]);
  const nextTier = useMemo<TierMembershipSummary | null>(() => pickNextActiveTier(membershipSummary), [membershipSummary]);
  const currentTierAddress = currentTier?.tier.checksumAddress ?? null;
  const currentTierLabel = useMemo(
    () => resolveTierLabel(currentTier, effectiveCurrentTierId),
    [currentTier, effectiveCurrentTierId],
  );

  const normalizedCurrentTierId = normalizeTierId(currentTier?.tier.id ?? currentTier?.tier.address ?? null) ?? null;
  const nextTierLabel = useMemo(() => {
    if (!nextTier) return null;
    const autoRenewEnabled = typeof autoRenewMonths === "number" && autoRenewMonths > 0;
    if (autoRenewEnabled) return null;
    const currentExpiry = typeof currentTier?.expiry === "number" ? currentTier.expiry : null;
    const nextExpiry = typeof nextTier.expiry === "number" ? nextTier.expiry : null;
    if (currentExpiry && nextExpiry && nextExpiry <= currentExpiry) return null;
    const nextId = normalizeTierId(nextTier.tier.id ?? nextTier.tier.address ?? null);
    if (nextId && nextId === normalizedCurrentTierId) return null;
    return resolveTierLabel(nextTier, nextTier?.tier.id);
  }, [nextTier, normalizedCurrentTierId, autoRenewMonths, currentTier?.expiry]);
  const memberTierActiveForSummaryText =
    membershipStatus === "active" && currentTier?.tier?.renewable === false && currentTier?.tier?.neverExpires === true;
  const tierSummaryText = memberCancelPending && memberTierActiveForSummaryText
    ? nextTierLabel
      ? `Tier: ${currentTierLabel ?? "None selected"} (cancellation pending). Next after expiry: ${nextTierLabel}.`
      : `Tier: ${currentTierLabel ?? "None selected"} (cancellation pending).`
    : nextTierLabel
      ? `Tier: ${currentTierLabel ?? "None selected"}. Next after expiry: ${nextTierLabel}.`
      : `Tier: ${currentTierLabel ?? "None selected"}.`;

  const requestRefund = async () => {
    setRefundSubmitting(true);
    setRefundMessage(null);
    setRefundError(null);
    try {
      const res = await fetch("/api/membership/refund-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: refundReason, postCancelPreference: refundPostCancelPreference }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to request refund");
      }
      setRefundMessage("Refund request submitted. An admin will process it.");
      setRefundReason("");
      setRefundStatus("pending");
    } catch (err: any) {
      setRefundError(err?.message || "Failed to request refund");
    } finally {
      setRefundSubmitting(false);
    }
  };

  useEffect(() => {
    const fetchRefundStatus = async () => {
      try {
        const res = await fetch("/api/membership/refund-request/status", { cache: "no-store" });
        const data = await res.json();
        if (res.ok && data?.latest) {
          setRefundStatus(data.latest.status as any);
        } else {
          setRefundStatus(null);
        }
      } catch {
        setRefundStatus(null);
      }
    };
    if (authenticated) {
      void fetchRefundStatus();
    }
  }, [authenticated]);

  const renewalTier = useMemo<TierMembershipSummary | null>(() => {
    if (currentTier?.status === "active") return currentTier;
    return null;
  }, [currentTier]);
  const renewalTierAddress = renewalTier?.tier.checksumAddress ?? null;
  const autoRenewEligible = renewalTier?.tier?.renewable !== false && renewalTier?.tier?.neverExpires !== true;
  const refundableTierActive = membershipStatus === "active" && currentTier?.tier?.renewable !== false && currentTier?.tier?.neverExpires !== true;
  const memberTierActive = membershipStatus === "active" && currentTier?.tier?.renewable === false && currentTier?.tier?.neverExpires === true;
  const memberTierConfig = useMemo(
    () =>
      MEMBERSHIP_TIERS.find((tier) => tier.id === "member") ??
      MEMBERSHIP_TIERS.find((tier) => tier.renewable === false && tier.neverExpires === true) ??
      null,
    [],
  );
  const memberTierAddressLower = memberTierConfig?.checksumAddress?.toLowerCase?.() ?? null;
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
      const baseLabel = summary?.metadata?.name || tier.label || `Tier ${index + 1}`;
      let detail = "Not owned yet";
      const isMemberOption = memberTierAddressLower
        ? tier.checksumAddress.toLowerCase() === memberTierAddressLower
        : tier.renewable === false && tier.neverExpires === true;
      if (status === "active") {
        if (memberCancelPending && isMemberOption) {
          detail = "Canceling…";
        } else {
          detail = tier.neverExpires ? "Active · never expires" : expiryLabel ? `Active · expires ${expiryLabel}` : "Active";
        }
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
  }, [membershipSummary, memberCancelPending, memberTierAddressLower]);

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
      setAllowances({});
      return null;
    }

    if (sessionMembershipSummary) {
      setMembershipSummary(sessionMembershipSummary);
      setMembershipStatus(sessionMembershipSummary.status);
      setMembershipExpiry(sessionMembershipSummary.expiry ?? null);
    } else if (su.membershipStatus) {
      const fallbackStatus =
        su.membershipStatus === "active" || su.membershipStatus === "expired" ? su.membershipStatus : "none";
      const fallbackExpiry = typeof su.membershipExpiry === "number" ? su.membershipExpiry : null;
      setMembershipStatus(fallbackStatus);
      setMembershipExpiry(fallbackExpiry);
    }

    setMembershipChecking(true);
    try {
      const snapshot = await fetchMembershipStateSnapshot({ addresses, forceRefresh: true });
      const { summary, allowances: snapshotAllowances } = snapshotToMembershipSummary(snapshot);
      setMembershipSummary(summary);
      setMembershipStatus(summary.status);
      setMembershipExpiry(summary.expiry ?? null);
      setAllowances(snapshotAllowances);
      return summary;
    } catch (err) {
      console.error("Membership check failed:", err);
      setAllowances({});
    } finally {
      setMembershipChecking(false);
    }

    return null;
  }, [authenticated, membershipAddresses, sessionMembershipSummary, sessionUser]);

  const cancelFreeMembership = useCallback(async () => {
    if (memberCanceling || memberCancelPending) return;
    if (!authenticated) {
      setMemberCancelError("Sign in to manage your membership.");
      return;
    }
    const recipient = membershipAddresses[0] || null;
    if (!recipient) {
      setMemberCancelError("No wallet linked.");
      return;
    }
    setMemberCancelError(null);
    setMemberCancelMessage(null);
    setMemberCancelTxHash(null);
    setMemberCanceling(true);
    try {
      if (typeof window !== "undefined") {
        const ok = window.confirm("Cancel your free membership? This will remove member access.");
        if (!ok) {
          setMemberCanceling(false);
          return;
        }
      }
      const res = await fetch("/api/membership/cancel-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to cancel free membership");
      }
      const txHash = typeof data?.txHash === "string" && data.txHash.length ? data.txHash : null;
      setMemberCancelTxHash(txHash);
      const pollId = memberCancelPollIdRef.current + 1;
      memberCancelPollIdRef.current = pollId;
      const isAlreadyCanceled = data?.status === "already-canceled";
      setMemberCancelPending(!isAlreadyCanceled);
      setMemberCancelMessage(
        isAlreadyCanceled
          ? "Free membership is already canceled."
          : "Cancellation submitted. Waiting for confirmation on Base…",
      );
      try {
        await refreshMembershipSummary();
      } catch {}
      try {
        await update({});
      } catch {}
      if (isAlreadyCanceled) {
        void persistTierSelection({ currentTierId: null });
      }

      if (!isAlreadyCanceled) {
        void (async () => {
          const delaysMs = [1500, 2500, 4000, 6500, 10000, 15000];
          for (const delay of delaysMs) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            if (memberCancelPollIdRef.current !== pollId) return;
            try {
              const refreshed = await refreshMembershipSummary();
              if (!refreshed) continue;
              const memberTier = memberTierAddressLower
                ? refreshed?.tiers?.find(
                    (tier) => tier.tier.checksumAddress.toLowerCase() === memberTierAddressLower,
                  )
                : null;
              const stillActive = memberTier ? memberTier.status === "active" : refreshed?.status === "active";
              if (!stillActive) {
                setMemberCancelPending(false);
                setMemberCancelMessage("Free membership canceled.");
                setMessage("Free membership canceled.");
                void persistTierSelection({ currentTierId: null });
                try {
                  await update({});
                } catch {}
                return;
              }
            } catch {}
          }

          if (memberCancelPollIdRef.current !== pollId) return;
          setMemberCancelPending(false);
        })();
      }
    } catch (err: any) {
      setMemberCancelError(err?.message || "Failed to cancel free membership");
      setMemberCancelPending(false);
    } finally {
      setMemberCanceling(false);
    }
  }, [
    authenticated,
    membershipAddresses,
    refreshMembershipSummary,
    update,
    memberCanceling,
    memberCancelPending,
    memberTierAddressLower,
    persistTierSelection,
  ]);

  const handleMembershipCheckoutComplete = useCallback(async (target: any, completion?: UnlockCheckoutCompletionContext) => {
    const context = pendingTierSwitchRef.current;
    pendingTierSwitchRef.current = null;
    try {
      let newTierDetected = false;
      if (context) {
        const { addresses, targetTierLower } = context;
        if (addresses.length) {
          for (let i = 0; i < 5; i++) {
            try {
              const snapshot = await fetchMembershipStateSnapshot({ addresses, forceRefresh: true });
              const { summary, allowances: snapshotAllowances } = snapshotToMembershipSummary(snapshot);
              setAllowances(snapshotAllowances);
              if (summary?.tiers?.length) {
                const detected = summary.tiers.find((tier) => tier.tier.checksumAddress.toLowerCase() === targetTierLower);
                if (detected?.status === "active") {
                  newTierDetected = true;
                  break;
                }
              } else {
                const status = summary?.status;
                const expiry = typeof summary?.expiry === "number" ? summary.expiry : null;
                const nowSec = Math.floor(Date.now() / 1000);
                if (status === "active" || (typeof expiry === "number" && expiry > nowSec)) {
                  break;
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
          const detected = summaryForCheck.tiers.find((tier) => tier.tier.checksumAddress.toLowerCase() === context.targetTierLower);
          if (detected?.status === "active") {
            newTierDetected = true;
          }
        }

        try {
          await update({});
        } catch {}

        const parts: string[] = [];
        if (context.disableMessage) {
          parts.push(context.disableMessage);
        }

        let previousTierNote: string | null = null;
        if (context.switchingTier && context.previousTierLabel) {
          previousTierNote = newTierDetected
            ? `Your previous membership (${context.previousTierLabel}) will remain active until it expires.`
            : `We could not confirm your new membership yet. If checkout completed, your previous membership (${context.previousTierLabel}) will remain active until it expires.`;
        } else if (!newTierDetected) {
          previousTierNote =
            "We could not confirm your new membership yet. If checkout completed, your membership details will update shortly.";
        }

        if (previousTierNote) {
          parts.push(previousTierNote);
        }

        if (newTierDetected) {
          parts.push(`If you completed checkout for the ${context.targetTierLabel} tier, your membership details will update shortly.`);
        } else if (!previousTierNote) {
          parts.push(
            "We could not confirm your new membership yet. If checkout completed, your membership details will update shortly.",
          );
        }

        setMessage(parts.join(" "));
        setError(null);
      } else {
        try {
          await refreshMembershipSummary();
        } catch {}
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
        const ownerLower = completion?.owner ? String(completion.owner).toLowerCase() : null;
        const recipient =
          ownerLower && membershipAddresses.includes(ownerLower)
            ? ownerLower
            : membershipAddresses[0] || null;
        if (paidTierCompleted && recipient) {
          await fetch("/api/membership/claim-member", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipient }),
          }).catch(() => {});
        }
      } catch (err) {
        console.error("Member claim after paid checkout failed:", err);
      }
    } finally {
      setTierSwitching(false);
    }
  }, [membershipAddresses, membershipSummary, refreshMembershipSummary, update]);

  const tokenIdMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const tier of membershipSummary?.tiers || []) {
      if (tier?.tier?.checksumAddress && Array.isArray(tier?.tokenIds)) {
        map[tier.tier.checksumAddress.toLowerCase()] = tier.tokenIds;
      }
    }
    return map;
  }, [membershipSummary]);

  const selectedTierHasKey = useMemo(() => {
    if (!selectedTierAddress) return false;
    const ids = tokenIdMap[selectedTierAddress.toLowerCase()] ?? [];
    return Array.isArray(ids) && ids.length > 0;
  }, [selectedTierAddress, tokenIdMap]);

  const {
    openMembershipCheckout,
    checkoutPortal,
    status: checkoutStatus,
  } = useUnlockCheckout({
    onMembershipComplete: handleMembershipCheckoutComplete,
  }, tokenIdMap);

  useEffect(() => {
    const busy = checkoutStatus === 'loading' || checkoutStatus === 'ready' || checkoutStatus === 'processing';
    if (busy) {
      setTierSwitching(true);
    } else if (!busy && pendingTierSwitchRef.current === null) {
      setTierSwitching(false);
    }
  }, [checkoutStatus]);

  useEffect(() => {
    void refreshMembershipSummary();
  }, [refreshMembershipSummary]);

  useEffect(() => {
    if (!authenticated) return;
    if (memberEnsureAttemptedRef.current) return;
    if (memberEnsureProcessing) return;
    if (membershipChecking) return;
    if (!membershipSummary?.tiers?.length) return;

    const hasActivePaidTier = membershipSummary.tiers.some(
      (tier) => tier.status === "active" && tier.tier?.renewable !== false && tier.tier?.neverExpires !== true,
    );
    if (!hasActivePaidTier) return;

    const memberTierEntry = findTierInSummary(membershipSummary, memberTierConfig?.id ?? "member");
    const memberAlreadyActive = memberTierEntry?.status === "active";
    if (memberAlreadyActive) return;

    const primaryWalletLower = walletAddress ? String(walletAddress).trim().toLowerCase() : null;
    const recipient =
      primaryWalletLower && membershipAddresses.includes(primaryWalletLower)
        ? primaryWalletLower
        : membershipAddresses[0] || null;
    if (!recipient) return;

    memberEnsureAttemptedRef.current = true;
    setMemberEnsureProcessing(true);
    setMemberEnsureMessage("We’re adding your free Member pass (paid members automatically get one).");
    setMemberEnsureError(null);

    void (async () => {
      try {
        const res = await fetch("/api/membership/claim-member", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Unable to add the free Member pass automatically.");
        }

        setMemberEnsureMessage(
          data?.status === "already-member"
            ? "Your free Member pass is already active."
            : "Free Member pass submitted. It will appear once confirmed on Base.",
        );
        try {
          await refreshMembershipSummary();
        } catch {}
        try {
          await update({});
        } catch {}
      } catch (err: any) {
        setMemberEnsureError(err?.message || "Unable to add the free Member pass automatically.");
      } finally {
        setMemberEnsureProcessing(false);
      }
    })();
  }, [
    authenticated,
    memberEnsureProcessing,
    membershipChecking,
    membershipSummary,
    membershipAddresses,
    memberTierConfig,
    refreshMembershipSummary,
    update,
    walletAddress,
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
  }, [authenticated, membershipSummary, currentTierOverride, persistTierSelection]);

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

  const checkAutoRenewStatus = useCallback(() => {
    setAutoRenewChecking(true);
    if (!authenticated || membershipStatus !== "active" || !renewalTierAddress) {
      setAutoRenewPrice(null);
      setAutoRenewMonths(null);
      setAutoRenewChecking(false);
      return;
    }
    if (!autoRenewEligible) {
      setAutoRenewPrice(null);
      setAutoRenewMonths(0);
      setAutoRenewChecking(false);
      return;
    }
    const entry = allowances[renewalTierAddress.toLowerCase()];
    if (!entry) {
      setAutoRenewPrice(null);
      setAutoRenewMonths(0);
      setAutoRenewChecking(false);
      return;
    }
    let price: bigint | null = null;
    try {
      price = entry.keyPrice ? BigInt(entry.keyPrice) : null;
    } catch {
      price = null;
    }
    if (price && price > 0n) {
      setAutoRenewPrice(price);
    } else {
      setAutoRenewPrice(null);
    }

    let months = 0;
    if (entry.isUnlimited) {
      months = MAX_AUTO_RENEW_MONTHS;
    } else if (price && price > 0n) {
      try {
        const allowanceAmount = BigInt(entry.amount || "0");
        months = Number(allowanceAmount / price);
      } catch {
        months = 0;
      }
    } else {
      months = 0;
    }
    setAutoRenewMonths(months);
    setAutoRenewChecking(false);
  }, [authenticated, allowances, membershipStatus, renewalTierAddress, autoRenewEligible]);

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
      if (switchingTier && currentTierAddress) {
        const result = await disableAutoRenewForCurrentTier();
        disableMessage = previousTierLabel
          ? `${result.message} (Tier: ${previousTierLabel}).`
          : result.message;
        setAutoRenewMonths(0);
        await refreshMembershipSummary();
      }

      const addresses = (wallets && wallets.length ? wallets : walletAddress ? [walletAddress] : [])
        .map((addr) => String(addr).toLowerCase());

      pendingTierSwitchRef.current = {
        targetTierAddress,
        targetTierLower,
        targetTierId: selectedTierOption.tier.id,
        targetTierLabel: selectedTierOption.baseLabel,
        disableMessage,
        previousTierLabel,
        switchingTier,
        addresses,
      };

      openMembershipCheckout(targetTierAddress);
    } catch (err: any) {
      pendingTierSwitchRef.current = null;
      setTierSwitching(false);
      setError(err?.message || "Failed to start membership checkout");
    }
  }, [
    currentTierAddress,
    currentTierLabel,
    disableAutoRenewForCurrentTier,
    openMembershipCheckout,
    refreshMembershipSummary,
    selectedTierOption,
    setAutoRenewMonths,
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
    <>
      {checkoutPortal}
      <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => router.push("/")}>
          ← Back to Home
        </Button>
      </div>
      {(memberEnsureMessage || memberEnsureError) && (
        <Alert variant={memberEnsureError ? "destructive" : undefined}>
          {memberEnsureError ? <AlertCircle className="h-4 w-4" /> : null}
          <AlertTitle>Free Member pass</AlertTitle>
          <AlertDescription>{memberEnsureError || memberEnsureMessage}</AlertDescription>
        </Alert>
      )}
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
            Check your current Unlock membership status, manage tier changes, and review auto-renewal approvals for paid tiers.
          </p>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className={membershipChecking || membershipStatus === "unknown" ? "animate-pulse" : ""}>
            {membershipChecking || membershipStatus === "unknown" ? "Loading membership details…" : tierSummaryText}
          </p>
          <p className={membershipChecking || autoRenewChecking ? "animate-pulse" : ""}>
            {membershipChecking || autoRenewChecking
              ? "Loading price…"
              : currentTier?.tier?.neverExpires || currentTier?.tier?.renewable === false
                ? "Current price: Free (no renewal)."
                : `Current price: ${
                    autoRenewPrice !== null ? (Number(autoRenewPrice) / 1_000_000).toFixed(2) : "Unknown"
                  } USDC per month`}
          </p>
          <p>
            {membershipChecking ? (
              <span className="animate-pulse">Checking membership status…</span>
            ) : memberCancelPending ? (
              "Cancellation pending. Your membership will update once confirmed on Base."
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
          {membershipStatus === "active" && !autoRenewEligible ? (
            <p>This membership tier does not support auto-renew.</p>
          ) : (
            <p>
              To stop automatic renewals, revoke the USDC approval granted to the membership lock. This prevents future renewals;
              your current period remains active until it expires.
            </p>
          )}
        </div>
        {memberTierActive ? (
          <div className="rounded-md border border-[rgba(11,11,67,0.1)] bg-white/80 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#0b0b43]">Cancel free membership</p>
                <p className="text-xs text-muted-foreground">
                  This will terminate your free Member key on-chain. No refund is associated with this tier.
                </p>
              </div>
              <Button variant="outline" onClick={cancelFreeMembership} disabled={memberCanceling || memberCancelPending}>
                {memberCanceling ? "Canceling…" : memberCancelPending ? "Waiting for confirmation…" : "Cancel free membership"}
              </Button>
            </div>
            {memberCancelMessage || memberCancelError ? (
              <Alert variant={memberCancelError ? "destructive" : undefined} className="mt-3">
                {memberCancelError ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                <AlertTitle>{memberCancelError ? "Error" : "Submitted"}</AlertTitle>
                <AlertDescription>
                  {memberCancelError || memberCancelMessage}
                  {memberCancelTxHash ? (
                    <>
                      {" "}
                      <a
                        href={`${BASE_BLOCK_EXPLORER_URL}/tx/${memberCancelTxHash}`}
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
            ) : null}
          </div>
        ) : null}
        {refundableTierActive ? (
          <div className="rounded-md border border-[rgba(11,11,67,0.1)] bg-white/80 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#0b0b43]">Request cancellation & refund</p>
                <p className="text-xs text-muted-foreground">
                  We will cancel your membership and process a full refund for the current period. An admin will review and complete it.
                </p>
              </div>
            </div>
            {refundStatus === "pending" || refundStatus === "processing" ? (
              <Alert className="mt-3">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Request received</AlertTitle>
                <AlertDescription>Your cancellation/refund request is {refundStatus}. An admin will complete it.</AlertDescription>
              </Alert>
            ) : refundStatus === "completed" ? (
              <Alert className="mt-3">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Refund completed</AlertTitle>
                <AlertDescription>Your membership was canceled and refunded.</AlertDescription>
              </Alert>
            ) : (
              <>
                {refundMessage ? (
                  <Alert className="mt-3">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Submitted</AlertTitle>
                    <AlertDescription>{refundMessage}</AlertDescription>
                  </Alert>
                ) : null}
                {refundError ? (
                  <Alert variant="destructive" className="mt-3">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{refundError}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="mt-3 space-y-2">
                  <label htmlFor="refund-reason" className="text-sm font-medium text-[#0b0b43]">
                    Reason (optional)
                  </label>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-[#0b0b43]">After cancellation</p>
                    <label className="flex items-start gap-2 text-xs text-muted-foreground">
                      <input
                        type="radio"
                        name="refund-post-cancel-preference"
                        value="keep-free"
                        checked={refundPostCancelPreference === "keep-free"}
                        onChange={() => setRefundPostCancelPreference("keep-free")}
                        disabled={refundSubmitting}
                      />
                      <span>
                        Refund paid membership and keep free Member access.
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-muted-foreground">
                      <input
                        type="radio"
                        name="refund-post-cancel-preference"
                        value="cancel-all"
                        checked={refundPostCancelPreference === "cancel-all"}
                        onChange={() => setRefundPostCancelPreference("cancel-all")}
                        disabled={refundSubmitting}
                      />
                      <span>
                        Refund paid membership and cancel all memberships (including free).
                      </span>
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Refund processing is the same either way. If you choose “cancel all”, the free Member key will be terminated after the paid cancellation is completed.
                    </p>
                  </div>
                  <textarea
                    id="refund-reason"
                    rows={3}
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    className="w-full rounded-md border border-[rgba(11,11,67,0.15)] px-3 py-2 text-sm text-[#0b0b43] shadow-inner focus:border-[rgba(67,119,243,0.5)] focus:outline-none focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
                    placeholder="Tell us why you want to cancel"
                  />
                  <div className="flex gap-2">
                    <Button variant="outlined-primary" onClick={requestRefund} isLoading={refundSubmitting}>
                      {refundSubmitting ? "Submitting…" : "Request cancellation & refund"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}
        <div className="text-sm">
          {!autoRenewEligible && membershipStatus === "active" ? (
            <span className="text-muted-foreground">Auto‑renew is not available for this membership tier.</span>
          ) : autoRenewChecking ? (
            <span className="text-muted-foreground animate-pulse">Checking auto‑renew status…</span>
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
        {autoRenewEligible ? (
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
                await refreshMembershipSummary();
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
                  const desired = computeAutoRenewAllowance(price);
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
                  await refreshMembershipSummary();
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
        ) : null}
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
              disabled={
                tierSwitching ||
                !selectedTierOption ||
                (wallets.length === 0 && !walletAddress) ||
                (selectedTierHasKey && (!tokenIdMap[selectedTierAddress.toLowerCase()] || tokenIdMap[selectedTierAddress.toLowerCase()]?.length === 0))
              }
            >
              {tierSwitching
                ? "Preparing checkout…"
                : selectedTierHasKey
                ? selectedTierOption
                  ? `Renew ${selectedTierOption.baseLabel}`
                  : "Renew tier"
                : selectedTierOption
                ? `Purchase ${selectedTierOption.baseLabel}`
                : "Open checkout"}
            </Button>
          </div>
          {selectedTierOption ? (
            <p className="text-xs text-muted-foreground">{selectedTierOption.detail}</p>
          ) : null}
          {autoRenewEligible && currentTierLabel ? (
            <p className="text-xs text-muted-foreground">
              Auto-renew will be disabled for your current tier ({currentTierLabel}) before checkout launches.
            </p>
          ) : null}
        </div>
      </section>
      </div>
    </>
  );
}
