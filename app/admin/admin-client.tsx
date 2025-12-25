"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { AlertTriangle, ArrowUpDown, MailCheck, MailQuestion, RefreshCcw, Wallet } from "lucide-react";
import type { AdminMember, AdminRoster } from "@/lib/admin/roster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BASE_BLOCK_EXPLORER_URL, BASE_CHAIN_ID_HEX, BASE_NETWORK_ID, MEMBERSHIP_TIERS, USDC_ADDRESS } from "@/lib/config";
import { parseUnits } from "ethers";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

type Props = {
  initialRoster: AdminRoster | null;
  currentAdminId?: string | null;
};

// Toggle automatic detail hydration; keep off to avoid unintended requeue loops.
const AUTO_DETAIL_ENABLED = false;
const DEBUG_DETAILS = process.env.NEXT_PUBLIC_DEBUG_ADMIN_DETAILS === "true";

type SortKey = "last-name" | "joined" | "expiry";
type SortDirection = "asc" | "desc";

const autoRenewClasses: Record<string, string> = {
  on: "border-emerald-200 bg-emerald-50 text-emerald-800",
  off: "border-rose-200 bg-rose-50 text-rose-800",
  na: "border-slate-200 bg-slate-100 text-slate-700",
};

function formatWallet(address: string | null) {
  if (!address) return "No wallet";
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const walletLink = (address: string | null) =>
  address ? `${BASE_BLOCK_EXPLORER_URL.replace(/\/$/, "")}/address/${address}` : null;

const normalizeTierKey = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

const TIER_LABELS_BY_KEY = (() => {
  const map = new Map<string, string>();
  for (const tier of MEMBERSHIP_TIERS) {
    const label = tier.label || tier.id || tier.checksumAddress;
    [tier.id, tier.address, tier.checksumAddress].forEach((key) => {
      const normalized = normalizeTierKey(key);
      if (normalized && label) {
        map.set(normalized, label);
      }
    });
  }
  return map;
})();

const TIER_FILTERS = MEMBERSHIP_TIERS.map((tier) => ({
  value: tier.id,
  label: tier.label || tier.id || tier.checksumAddress,
  keys: [tier.id, tier.address, tier.checksumAddress]
    .map((value) => normalizeTierKey(value))
    .filter((value): value is string => !!value),
}));

const NON_RENEWABLE_TIER_KEYS = new Set(
  MEMBERSHIP_TIERS.filter((tier) => tier.renewable === false || tier.neverExpires === true)
    .flatMap((tier) => [tier.id, tier.address, tier.checksumAddress])
    .map((value) => normalizeTierKey(value))
    .filter((value): value is string => !!value),
);

const isNonRenewableTierMember = (member: AdminMember) => {
  const candidates = [
    normalizeTierKey(member.highestActiveTierId),
    normalizeTierKey(member.highestActiveTierLock),
  ].filter((value): value is string => !!value);
  return candidates.some((key) => NON_RENEWABLE_TIER_KEYS.has(key));
};

const resolveMemberTierKey = (member: AdminMember): string | null =>
  normalizeTierKey(member.highestActiveTierId) || normalizeTierKey(member.highestActiveTierLock) || null;

const resolveMemberTierLabel = (member: AdminMember): string => {
  if (member.highestActiveTierLabel) return member.highestActiveTierLabel;
  const key = resolveMemberTierKey(member);
  if (key && TIER_LABELS_BY_KEY.has(key)) {
    return TIER_LABELS_BY_KEY.get(key) as string;
  }
  if (member.membershipStatus === "none") return "No membership";
  return "—";
};

const getLastName = (member: AdminMember): string => {
  const last = member.lastName?.trim();
  if (last) return last;
  const name = member.name?.trim();
  if (!name) return "";
  const parts = name.split(/\s+/);
  return parts.length ? parts[parts.length - 1] : name;
};

const getFirstName = (member: AdminMember): string => {
  const first = member.firstName?.trim();
  if (first) return first;
  const name = member.name?.trim();
  if (!name) return "";
  const parts = name.split(/\s+/);
  return parts[0] || "";
};

function formatExpiry(expiry: number | null) {
  if (!expiry) return { label: "No expiry", detail: null };
  const dt = DateTime.fromSeconds(expiry);
  if (!dt.isValid) return { label: "Unknown", detail: null };
  return {
    label: dt.toLocaleString(DateTime.DATE_MED),
    detail: dt.toRelative(),
  };
}

function formatJoinDate(joined: number | null) {
  if (!joined) return { label: "—", detail: "" };
  const dt = DateTime.fromSeconds(joined);
  if (!dt.isValid) return { label: "Unknown", detail: "" };
  return {
    label: dt.toLocaleString(DateTime.DATE_MED),
    detail: dt.toRelative() || "",
  };
}

const compareOptionalNumber = (a: number | null, b: number | null, direction: SortDirection) => {
  const aValid = typeof a === "number" && Number.isFinite(a);
  const bValid = typeof b === "number" && Number.isFinite(b);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  return direction === "asc" ? a - b : b - a;
};

const compareStrings = (a: string, b: string, direction: SortDirection) => {
  const comparison = a.localeCompare(b, undefined, { sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
};

function formatBalance(value: string | null, symbol: string) {
  if (!value) return `- ${symbol}`;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return `${value} ${symbol}`;
  if (parsed === 0) return `0 ${symbol}`;
  if (parsed < 0.01) return `<0.01 ${symbol}`;
  return `${parsed.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 })} ${symbol}`;
}

function emailStatus(member: AdminMember) {
  if (member.welcomeEmailSentAt) {
    const sent = DateTime.fromISO(member.welcomeEmailSentAt);
    const label = sent.isValid ? sent.toRelative() : "Sent";
    return { label, icon: MailCheck, tone: "success" as const };
  }
  return { label: "Welcome not sent", icon: MailQuestion, tone: "muted" as const };
}

export default function AdminClient({ initialRoster, currentAdminId }: Props) {
  const filteredInitialRoster = useMemo(() => {
    if (!initialRoster) return null;
    if (!currentAdminId) return initialRoster;
    return {
      ...initialRoster,
      members: initialRoster.members.filter((m) => m.id !== currentAdminId),
    };
  }, [initialRoster, currentAdminId]);

  const [roster, setRoster] = useState<AdminRoster | null>(filteredInitialRoster);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!filteredInitialRoster);
  const [error, setError] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState<Record<string, boolean>>({});
  const [emailNotice, setEmailNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailModalMember, setEmailModalMember] = useState<AdminMember | null>(null);
  const [emailModalMode, setEmailModalMode] = useState<"welcome" | "custom" | null>(null);
  const [emailSubject, setEmailSubject] = useState("PGP Community update");
  const [emailBody, setEmailBody] = useState("Hello,\n\n");
  const [emailModalError, setEmailModalError] = useState<string | null>(null);
  const [adminUpdating, setAdminUpdating] = useState<Record<string, boolean>>({});
  const [adminError, setAdminError] = useState<string | null>(null);
  const [testMemberUpdating, setTestMemberUpdating] = useState<Record<string, boolean>>({});
  const [testMemberError, setTestMemberError] = useState<string | null>(null);
  const [refundProcessing, setRefundProcessing] = useState<Record<string, boolean>>({});
  const [refundConfirmOpen, setRefundConfirmOpen] = useState(false);
  const [refundConfirmMember, setRefundConfirmMember] = useState<AdminMember | null>(null);
  const [actionModalMember, setActionModalMember] = useState<AdminMember | null>(null);
  const [refundAmountInput, setRefundAmountInput] = useState("");
  const [requestRefundProcessing, setRequestRefundProcessing] = useState<Record<string, boolean>>({});
  const [refundRequests, setRefundRequests] = useState<
    Array<{
      id: string;
      userId: string;
      email: string | null;
      wallet: string | null;
      tierLabel: string | null;
      tierId: string | null;
      lockAddress: string | null;
      activeLocks?: Array<{ lockAddress: string; tierId: string | null; tierLabel: string | null }>;
      postCancelPreference?: string | null;
      status: string;
      createdAt: string;
      canExecute: boolean;
    }>
  >([]);
  const [refundLoading, setRefundLoading] = useState(false);
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("last-name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [detailQueue, setDetailQueue] = useState<string[]>([]);
  const [balanceQueue, setBalanceQueue] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [detailLoaded, setDetailLoaded] = useState<Record<string, boolean>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailsInFlight, setDetailsInFlight] = useState(false);
  const [detailFailed, setDetailFailed] = useState<Record<string, boolean>>({});
  const [cachePolling, setCachePolling] = useState(false);
  const [cacheRebuildLoading, setCacheRebuildLoading] = useState(false);
  const [expandedMembers, setExpandedMembers] = useState<Record<string, boolean>>({});
  const [refundExpanded, setRefundExpanded] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rebuildRequestedRef = useRef(false);
  const handleModalOpenChange = (open: boolean) => {
    setEmailModalOpen(open);
    if (!open) {
      setEmailModalMember(null);
      setEmailModalMode(null);
      setEmailModalError(null);
    }
  };

  const toggleMemberDetails = useCallback((id: string) => {
    setExpandedMembers((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const filteredMembers = useMemo(() => {
    if (!roster?.members) return [];
    const q = query.trim().toLowerCase();
    const baseMembers =
      tierFilter === "test"
        ? roster.members.filter((member) => member.isTestMember)
        : roster.members.filter((member) => !member.isTestMember);

    const tierFiltered =
      tierFilter === "test"
        ? baseMembers
        : tierFilter === "all"
          ? baseMembers.filter((member) => resolveMemberTierKey(member))
          : tierFilter === "none"
            ? baseMembers.filter((member) => !resolveMemberTierKey(member))
            : baseMembers.filter((member) => {
                const key = resolveMemberTierKey(member);
                const keys = TIER_FILTERS.find((tier) => tier.value === tierFilter)?.keys || [];
                return !!key && keys.includes(key);
              });
    const searched = q
      ? tierFiltered.filter((member) => {
          const name = member.name || `${member.firstName || ""} ${member.lastName || ""}`.trim();
          const haystack = [
            name,
            member.email,
            member.primaryWallet,
            ...member.wallets,
            resolveMemberTierLabel(member),
            member.highestActiveTierId,
          ]
            .filter(Boolean)
            .map((v) => String(v).toLowerCase());
          return haystack.some((value) => value.includes(q));
        })
      : tierFiltered;

    const sorted = [...searched].sort((a, b) => {
      if (sortKey === "last-name") {
        const aLast = getLastName(a);
        const bLast = getLastName(b);
        const byLast = compareStrings(aLast, bLast, sortDirection);
        if (byLast !== 0) return byLast;
        const byFirst = compareStrings(getFirstName(a), getFirstName(b), sortDirection);
        if (byFirst !== 0) return byFirst;
      } else if (sortKey === "joined") {
        const byJoined = compareOptionalNumber(a.memberSince, b.memberSince, sortDirection);
        if (byJoined !== 0) return byJoined;
      } else if (sortKey === "expiry") {
        const byExpiry = compareOptionalNumber(a.membershipExpiry, b.membershipExpiry, sortDirection);
        if (byExpiry !== 0) return byExpiry;
      }
      return compareStrings(a.name || a.email || "", b.name || b.email || "", sortDirection);
    });

    return sorted;
  }, [roster, query, tierFilter, sortKey, sortDirection]);

  const hasFailedDetails = useMemo(() => Object.keys(detailFailed).length > 0, [detailFailed]);
  const pendingRefundCount = useMemo(
    () => refundRequests.filter((req) => req.status !== "completed" && req.status !== "rejected").length,
    [refundRequests],
  );
  const cacheNotice = useMemo(() => {
    const cache = roster?.cache;
    if (!cache?.enabled) return null;
    const computedAt = typeof cache.computedAt === "number" ? DateTime.fromMillis(cache.computedAt) : null;
    const lastUpdated = computedAt?.isValid ? computedAt.toRelative() : null;
    const lastUpdatedLabel = lastUpdated ? `Last updated ${lastUpdated}.` : "";

    if (cache.missing) {
      return {
        tone: "warn" as const,
        message: `Roster cache has not been built yet.${lastUpdatedLabel ? ` ${lastUpdatedLabel}` : ""} Rebuilding now; please wait a minute and it will refresh automatically.`,
      };
    }
    if (cache.lockActive) {
      return {
        tone: "warn" as const,
        message: `Roster cache refresh is in progress.${lastUpdatedLabel ? ` ${lastUpdatedLabel}` : ""} Please wait a minute and it will update.`,
      };
    }
    if (cache.rebuildBlocking) {
      const prefix = cache.rebuildTriggered
        ? "Roster cache was stale and just rebuilt."
        : "Roster cache rebuild was needed; data refreshed without updating the cache.";
      return {
        tone: "warn" as const,
        message: `${prefix}${lastUpdatedLabel ? ` ${lastUpdatedLabel}` : ""} If this page felt slow, wait a minute before refreshing.`,
      };
    }
    if (cache.isStale) {
      if (cache.rebuildTriggered) {
        return {
          tone: "warn" as const,
          message: `Roster cache is stale and refreshing in the background.${lastUpdatedLabel ? ` ${lastUpdatedLabel}` : ""} Give it a minute, then refresh.`,
        };
      }
      return {
        tone: "warn" as const,
        message: `Roster cache is stale.${lastUpdatedLabel ? ` ${lastUpdatedLabel}` : ""} Use Refresh to rebuild.`,
      };
    }
    return null;
  }, [roster]);

  const cacheSummary = useMemo(() => {
    const cache = roster?.cache;
    if (!cache) {
      return { label: "Cache: unavailable", detail: "Last updated: —", enabled: false };
    }
    if (!cache.enabled) {
      return { label: "Cache: disabled", detail: "Last updated: —", enabled: false };
    }
    const computedAt = typeof cache.computedAt === "number" ? DateTime.fromMillis(cache.computedAt) : null;
    const lastUpdated = computedAt?.isValid ? computedAt.toRelative() : null;
    const state = cache.missing ? "Missing" : cache.isFresh ? "Fresh" : cache.isStale ? "Stale" : "Unknown";
    return {
      label: `Cache: ${state}`,
      detail: lastUpdated ? `Last updated ${lastUpdated}` : "Last updated: —",
      enabled: true,
    };
  }, [roster]);

  const queueDetails = useCallback(
    (
      ids: string[],
      options: {
        resetFailures?: boolean;
        includeAllowances?: boolean;
      } = {},
    ) => {
      if (!ids.length) return;
      const includeAllowances = options.includeAllowances !== false;
      if (DEBUG_DETAILS) {
        console.info("[ADMIN DETAILS] queueDetails", { ids, includeAllowances, resetFailures: options.resetFailures });
      }
      if (options.resetFailures) {
        setDetailFailed((prev) => {
          const next = { ...prev };
          ids.forEach((id) => {
            delete next[id];
          });
          return next;
        });
      }
      if (includeAllowances) {
        setDetailQueue((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.add(id));
          return Array.from(next);
        });
        setBalanceQueue((prev) => prev.filter((id) => !ids.includes(id)));
      } else {
        setBalanceQueue((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.add(id));
          return Array.from(next);
        });
      }
      setDetailError(null);
    },
    [],
  );

  const handleRetrieveDetails = useCallback(() => {
    if (!filteredMembers.length) return;
    const allowanceIds: string[] = [];
    const balanceIds: string[] = [];
    for (const member of filteredMembers) {
      if (isNonRenewableTierMember(member)) {
        balanceIds.push(member.id);
      } else {
        allowanceIds.push(member.id);
      }
    }
    if (allowanceIds.length) {
      queueDetails(allowanceIds, { resetFailures: true, includeAllowances: true });
    }
    if (balanceIds.length) {
      queueDetails(balanceIds, { resetFailures: allowanceIds.length === 0, includeAllowances: false });
    }
  }, [filteredMembers, queueDetails]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!AUTO_DETAIL_ENABLED) return;
    const visibleIds = new Set(filteredMembers.map((m) => m.id));
    setDetailQueue((prev) => {
      let changed = false;
      let next = prev.filter((id) => {
        const keep = visibleIds.has(id);
        if (!keep) changed = true;
        return keep;
      });
      for (const member of filteredMembers) {
        if (!detailLoaded[member.id] && !detailLoading[member.id] && !detailFailed[member.id] && !next.includes(member.id)) {
          next = [...next, member.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [filteredMembers, detailLoaded, detailFailed]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const buildRosterUrl = useCallback(
    (params: { refresh?: boolean; preferStale?: boolean; triggerRebuild?: boolean; forceRebuild?: boolean }) => {
      const search = new URLSearchParams({ fields: "core" });
      if (params.refresh) search.set("refresh", "1");
      if (params.preferStale) search.set("preferStale", "1");
      if (params.triggerRebuild) search.set("triggerRebuild", "1");
      if (params.forceRebuild) search.set("forceRebuild", "1");
      return `/api/admin/members?${search.toString()}`;
    },
    [],
  );

  const fetchRoster = useCallback(
    async (params: {
      refresh?: boolean;
      preferStale?: boolean;
      triggerRebuild?: boolean;
      forceRebuild?: boolean;
      resetDetails?: boolean;
      showLoading?: boolean;
    }) => {
      const showLoading = params.showLoading !== false;
      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      setEmailNotice(null);
      setDetailError(null);
      if (params.resetDetails) {
        setDetailFailed({});
      }
      try {
        const res = await fetch(buildRosterUrl(params), { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Refresh failed (${res.status})`);
        }
        const data = (await res.json()) as AdminRoster;
        const filtered = currentAdminId
          ? { ...data, members: data.members.filter((m) => m.id !== currentAdminId) }
          : data;
        setRoster(filtered);
        if (params.resetDetails) {
          setDetailLoaded({});
          setDetailLoading({});
          setDetailQueue([]);
          setBalanceQueue([]);
          setDetailsInFlight(false);
        }
      if (params.triggerRebuild) {
        rebuildRequestedRef.current = true;
      }
      return filtered;
      } catch (err: any) {
        const message = typeof err?.message === "string" ? err.message : "Failed to refresh roster";
        setError(message);
        return null;
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [buildRosterUrl, currentAdminId],
  );

  const fetchCacheStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/members/status", { cache: "no-store" });
      if (!res.ok) return null;
      const payload = await res.json();
      return payload?.cache ?? null;
    } catch {
      return null;
    }
  }, []);

  const triggerRosterRebuild = useCallback(
    async (options?: { refreshRoster?: boolean; showError?: boolean }) => {
      const refreshRoster = options?.refreshRoster !== false;
      const showError = options?.showError !== false;
      rebuildRequestedRef.current = true;
      try {
        const res = await fetch("/api/admin/members/rebuild", { method: "POST", cache: "no-store" });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          rebuildRequestedRef.current = false;
          throw new Error(payload?.error || `Roster rebuild failed (${res.status})`);
        }
        const status = await fetchCacheStatus();
        if (status) {
          setRoster((prev) => {
            if (!prev) return prev;
            return { ...prev, cache: { ...prev.cache, ...status } };
          });
        }
        if (refreshRoster) {
          await fetchRoster({
            preferStale: true,
            resetDetails: false,
            showLoading: false,
          });
        }
      } catch (err: any) {
        if (showError) {
          setError(typeof err?.message === "string" ? err.message : "Failed to rebuild roster cache");
        }
      }
    },
    [fetchCacheStatus, fetchRoster],
  );

  const handleRefresh = async () => {
    await fetchRoster({
      preferStale: true,
      resetDetails: true,
      showLoading: true,
    });
  };

  const handleCacheRebuild = async () => {
    if (cacheRebuildLoading) return;
    setCacheRebuildLoading(true);
    setError(null);
    try {
      await triggerRosterRebuild({ refreshRoster: true, showError: true });
    } finally {
      setCacheRebuildLoading(false);
    }
  };

  useEffect(() => {
    if (roster) return;
    void fetchRoster({
      preferStale: true,
      resetDetails: true,
      showLoading: true,
    });
  }, [fetchRoster, roster]);

  useEffect(() => {
    const cache = roster?.cache;
    const shouldPoll =
      !!cache?.enabled &&
      (cache.missing || cache.isStale || cache.rebuildTriggered || cache.lockActive);

    if (!shouldPoll) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (cachePolling) {
        setCachePolling(false);
      }
      if (cache?.isFresh && !cache.missing) {
        rebuildRequestedRef.current = false;
      }
      return;
    }

    if (!rebuildRequestedRef.current && (cache?.missing || cache?.isStale)) {
      void triggerRosterRebuild({ refreshRoster: false, showError: false });
    }

    if (pollTimerRef.current) return;
    setCachePolling(true);
    pollTimerRef.current = setInterval(() => {
      void (async () => {
        const status = await fetchCacheStatus();
        if (!status) return;
        setRoster((prev) => {
          if (!prev) return prev;
          return { ...prev, cache: { ...prev.cache, ...status } };
        });
        if (status.isFresh && !status.missing) {
          rebuildRequestedRef.current = false;
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          setCachePolling(false);
          await fetchRoster({ preferStale: true, showLoading: false });
        }
      })();
    }, 15000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setCachePolling(false);
    };
  }, [cachePolling, fetchCacheStatus, fetchRoster, roster, triggerRosterRebuild]);

  useEffect(() => {
    if (!AUTO_DETAIL_ENABLED) return;
    if (detailsInFlight) return;
    if (detailQueue.length) return;
    const remaining = filteredMembers.filter((m) => !detailLoaded[m.id] && !detailFailed[m.id]);
    if (!remaining.length) return;
    queueDetails(remaining.map((m) => m.id), {
      resetFailures: Object.keys(detailFailed).length > 0,
      includeAllowances: true,
    });
  }, [detailQueue, filteredMembers, detailLoaded, detailFailed, detailsInFlight, queueDetails]);

  const updateMemberEmailMeta = (memberId: string, sentAt: string, emailType: string, markWelcome: boolean) => {
    setRoster((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        members: prev.members.map((m) =>
          m.id === memberId
            ? {
                ...m,
                lastEmailSentAt: sentAt,
                lastEmailType: emailType,
                welcomeEmailSentAt: markWelcome && !m.welcomeEmailSentAt ? sentAt : m.welcomeEmailSentAt,
              }
            : m,
        ),
      };
    });
  };

  const sendEmail = async (member: AdminMember, type: "welcome" | "custom", custom?: { subject: string; body: string }) => {
    if (!member.email) {
      setEmailNotice({ tone: "error", message: "No email on file for this member." });
      return false;
    }
    setSendingEmail((prev) => ({ ...prev, [member.id]: true }));
    setEmailNotice(null);
    try {
      const payload: any = { userId: member.id, type, email: member.email };
      if (type === "custom") {
        const subject = custom?.subject?.trim() || "";
        const rawBody = custom?.body || "";
        const body = rawBody.trim();
        if (!subject || !body) {
          throw new Error("Subject and body are required");
        }
        const htmlBody = /<[^>]+>/.test(rawBody) ? rawBody : body.replace(/\n/g, "<br />");
        payload.subject = subject;
        payload.html = htmlBody;
        payload.text = body;
      }
      if (type === "welcome" && custom) {
        const subject = custom.subject?.trim();
        const rawBody = custom.body || "";
        const body = rawBody.trim();
        if (subject) payload.subject = subject;
        if (body) {
          const htmlBody = /<[^>]+>/.test(rawBody) ? rawBody : body.replace(/\n/g, "<br />");
          payload.html = htmlBody;
          payload.text = body;
        }
      }
      const res = await fetch("/api/admin/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to send email");
      }
      const sentAt = data?.sentAt || new Date().toISOString();
      updateMemberEmailMeta(member.id, sentAt, data?.emailType || type, !!data?.markWelcome);
      setEmailNotice({
        tone: "success",
        message: `${data?.emailType === "welcome" ? "Welcome email" : "Email"} sent to ${member.email}`,
      });
      return true;
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "Failed to send email";
      setEmailNotice({ tone: "error", message: msg });
      return false;
    } finally {
      setSendingEmail((prev) => ({ ...prev, [member.id]: false }));
    }
  };

  const defaultWelcomeCopy = (member: AdminMember) => {
    const name = member.firstName || member.name;
    const greeting = name ? `Hi ${name},` : "Hi there,";
    return {
      subject: "Welcome to PGP Community",
      body: `${greeting}\n\nWelcome to the PGP Community! Your membership is active—sign in anytime to access community resources.\n\nIf you have questions, reply to this email and we will help.\n\nThanks,\nPGP Community Team`,
    };
  };

  const openCustomModal = (member: AdminMember) => {
    const greeting = member.firstName || member.name ? `Hello ${member.firstName || member.name},` : "Hello,";
    setEmailModalMember(member);
    setEmailModalMode("custom");
    setEmailSubject("PGP Community update");
    setEmailBody(`${greeting}\n\n`);
    setEmailModalError(null);
    setEmailModalOpen(true);
  };

  const toggleAdmin = async (member: AdminMember, target: boolean) => {
    setAdminUpdating((prev) => ({ ...prev, [member.id]: true }));
    setAdminError(null);
    setEmailNotice(null);
    try {
      const res = await fetch("/api/admin/users/adminize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, isAdmin: target }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update admin flag");
      }
      setRoster((prev) =>
        prev
          ? {
              ...prev,
              members: prev.members.map((m) =>
                m.id === member.id
                  ? {
                      ...m,
                      isAdmin: target,
                    }
                  : m,
              ),
            }
          : prev,
      );
      setActionModalMember((prev) => (prev && prev.id === member.id ? { ...prev, isAdmin: target } : prev));
      setEmailNotice({ tone: "success", message: `${target ? "Granted" : "Removed"} admin for ${member.email || member.name || member.id}` });
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "Failed to update admin flag";
      setAdminError(msg);
      setEmailNotice({ tone: "error", message: msg });
    } finally {
      setAdminUpdating((prev) => ({ ...prev, [member.id]: false }));
    }
  };

  const toggleTestMember = async (member: AdminMember, target: boolean) => {
    setTestMemberUpdating((prev) => ({ ...prev, [member.id]: true }));
    setTestMemberError(null);
    setEmailNotice(null);
    try {
      const res = await fetch("/api/admin/users/test-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, isTestMember: target }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update test member flag");
      }
      setRoster((prev) =>
        prev
          ? {
              ...prev,
              members: prev.members.map((m) =>
                m.id === member.id
                  ? {
                      ...m,
                      isTestMember: target,
                    }
                  : m,
              ),
            }
          : prev,
      );
      setActionModalMember((prev) => (prev && prev.id === member.id ? { ...prev, isTestMember: target } : prev));
      setEmailNotice({
        tone: "success",
        message: `${target ? "Marked" : "Removed"} test member for ${member.email || member.name || member.id}`,
      });
      void fetch(buildRosterUrl({ refresh: true }), { cache: "no-store" }).catch((err) => {
        console.warn("Failed to refresh roster cache after test-member update", err);
      });
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "Failed to update test member flag";
      setTestMemberError(msg);
      setEmailNotice({ tone: "error", message: msg });
    } finally {
      setTestMemberUpdating((prev) => ({ ...prev, [member.id]: false }));
    }
  };

  const openWelcomeModal = (member: AdminMember) => {
    const defaults = defaultWelcomeCopy(member);
    setEmailModalMember(member);
    setEmailModalMode("welcome");
    setEmailSubject(defaults.subject);
    setEmailBody(defaults.body);
    setEmailModalError(null);
    setEmailModalOpen(true);
  };

  const handleModalSend = async () => {
    if (!emailModalMember || !emailModalMode) return;
    const ok = await sendEmail(emailModalMember, emailModalMode, { subject: emailSubject, body: emailBody });
    if (ok) {
      setEmailModalOpen(false);
    } else {
      setEmailModalError("Unable to send email. Please try again.");
    }
  };

  const cancelAndRefund = async (member: AdminMember) => {
    if (member.membershipStatus !== "active") {
      setEmailNotice({ tone: "error", message: "Member has no active membership to refund." });
      return;
    }

    const ethereum = (globalThis as any).ethereum;
    if (!ethereum) {
      setEmailNotice({ tone: "error", message: "No wallet available in browser." });
      return;
    }

    setRefundProcessing((prev) => ({ ...prev, [member.id]: true }));
    setEmailNotice(null);

    try {
      // Fetch token IDs per lock for this user
      const tokenRes = await fetch("/api/admin/members/token-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData?.error || "Failed to fetch token ids");
      const tokenMap: Record<string, string[]> = tokenData && typeof tokenData === "object" && tokenData.tokenIds ? tokenData.tokenIds : {};
      const activeLockSet = new Set<string>(
        Array.isArray(tokenData?.activeLocks)
          ? tokenData.activeLocks.map((addr: string) => addr?.toLowerCase?.()).filter(Boolean)
          : []
      );
      const locks = Object.keys(tokenMap || {});
      const pairs: Array<{ lock: string; tokenId: string }> = [];
      for (const lock of locks) {
        if (!lock) continue;
        if (activeLockSet.size && !activeLockSet.has(lock.toLowerCase())) {
          continue;
        }
        const ids = tokenMap[lock] || [];
        for (const tid of ids) {
          if (tid) pairs.push({ lock, tokenId: tid });
        }
      }
      if (!pairs.length) {
        throw new Error("No active membership tokens found for this user.");
      }

      const { BrowserProvider, Contract, formatUnits } = await import("ethers");
      const provider = new BrowserProvider(ethereum, undefined);
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);
      if (chainId !== BASE_NETWORK_ID) {
        await provider.send("wallet_switchEthereumChain", [{ chainId: BASE_CHAIN_ID_HEX }]);
      }
      const signer = await provider.getSigner();
      const manager = await signer.getAddress();
      const abi = [
        "function isLockManager(address) view returns (bool)",
        "function expireAndRefundFor(uint256 _tokenId, uint256 _refundAmount) external",
        "function refundFor(uint256 _tokenId) view returns (uint256)",
        "function keyPrice() view returns (uint256)",
      ];

      const refundDetails: string[] = [];
      const failures: string[] = [];

      const seenLocks = new Set<string>();
      for (const pair of pairs) {
        const lockAddr = pair.lock;
        if (!lockAddr) continue;
        const contract = new Contract(lockAddr, abi, signer);
        if (!seenLocks.has(lockAddr)) {
          const isManager: boolean = await contract.isLockManager(manager);
          if (!isManager) {
            failures.push(`- Lock ${lockAddr}: connected wallet is not a lock manager.`);
            continue;
          }
          seenLocks.add(lockAddr);
        }

        // Determine decimals from lock currency (simplified: USDC -> 6, otherwise ETH -> 18)
        const decimals = USDC_ADDRESS ? 6 : 18;
        const currencyLabel = USDC_ADDRESS ? "USDC" : "ETH";

        let maxRefund: bigint = 0n;
        let amountLabel = USDC_ADDRESS ? "USDC" : "ETH";

        // Compute refund amount
        let refundComputed = false;

        // Admin override first
        if (refundAmountInput) {
          try {
            maxRefund = parseUnits(refundAmountInput, decimals);
            amountLabel = `${refundAmountInput} ${currencyLabel}`;
            refundComputed = true;
          } catch (_parseErr) {
            failures.push(`- Lock ${lockAddr} token ${pair.tokenId}: invalid override amount.`);
            continue;
          }
        }

        // If no override, try contract refundFor
        if (!refundComputed) {
          try {
            const refundable = await contract.refundFor(BigInt(pair.tokenId));
            maxRefund = refundable;
            amountLabel = `${Number(formatUnits(refundable, decimals)).toFixed(2)} ${currencyLabel}`;
            refundComputed = true;
          } catch (refundErr) {
            console.warn("refundFor failed; falling back to keyPrice", lockAddr, refundErr);
          }
        }

        // Fallback to keyPrice if still not computed
        if (!refundComputed) {
          try {
            const price: bigint = await contract.keyPrice();
            maxRefund = price;
            amountLabel = `${Number(formatUnits(price, decimals)).toFixed(2)} ${currencyLabel}`;
            refundComputed = true;
          } catch (_err) {
            failures.push(`- Lock ${lockAddr} token ${pair.tokenId}: could not determine refund amount.`);
            continue;
          }
        }

        if (!maxRefund || maxRefund === 0n) {
          failures.push(`- Lock ${lockAddr} token ${pair.tokenId}: refund amount is zero or undefined.`);
          continue;
        }

        if (!maxRefund || maxRefund === 0n) {
          failures.push(`- Lock ${lockAddr} token ${pair.tokenId}: refund amount is zero.`);
          continue;
        }

        try {
          const tx = await contract.expireAndRefundFor(BigInt(pair.tokenId), maxRefund);
          await tx.wait();
          refundDetails.push(`- Lock ${pair.lock} · Token ${pair.tokenId} · ${amountLabel}`);
        } catch (sendErr: any) {
          console.error("Refund transaction failed", sendErr);
          const msg = typeof sendErr?.message === "string" ? sendErr.message : "refund tx failed";
          const friendly = msg.includes("transfer amount exceeds balance")
            ? "Lock underfunded for requested refund amount."
            : msg;
          failures.push(`- Lock ${lockAddr} token ${pair.tokenId}: ${friendly}`);
          continue;
        }
      }

      if (refundDetails.length) {
        setEmailNotice({ tone: "success", message: `Refunded and expired ${refundDetails.length} membership(s).` });
      }
      if (failures.length) {
        setEmailNotice({ tone: "error", message: failures.join(" ") });
      }

      if (member.email) {
        const subject = "Your membership refund is processing";
        const lines = [
          "We canceled your membership and submitted a full-period refund for the following keys:",
          "",
          ...refundDetails,
          "",
          "If you don’t see the refund settle soon, reply to this email and we’ll help.",
        ];
        const body = lines.join("\n");
        await fetch("/api/admin/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "custom", email: member.email, subject, text: body, html: body.replace(/\n/g, "<br />") }),
        });
      }
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "Failed to cancel & refund";
      console.error("Cancel & refund error", err);
      setEmailNotice({ tone: "error", message: msg });
    } finally {
      setRefundProcessing((prev) => ({ ...prev, [member.id]: false }));
    }
  };

  const fetchRefundRequests = async () => {
    setRefundLoading(true);
    try {
      const res = await fetch("/api/admin/refund/requests", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load refund requests");
      const data = await res.json();
      setRefundRequests(data?.requests || []);
    } catch (err) {
      console.error(err);
    } finally {
      setRefundLoading(false);
    }
  };

  const clearRefundRequests = async () => {
    setRefundLoading(true);
    try {
      const res = await fetch("/api/admin/refund/requests/clear", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to clear requests");
      setRefundRequests([]);
      setEmailNotice({ tone: "success", message: `Cleared ${data?.cleared ?? 0} refund requests.` });
    } catch (err: any) {
      setEmailNotice({ tone: "error", message: err?.message || "Failed to clear requests" });
    } finally {
      setRefundLoading(false);
    }
  };

  useEffect(() => {
    void fetchRefundRequests();
  }, []);

  useEffect(() => {
    if (detailsInFlight) return;
    const visibleIds = new Set(filteredMembers.map((m) => m.id));
    const visibleDetailQueue = detailQueue.filter((id) => visibleIds.has(id));
    const visibleBalanceQueue = balanceQueue.filter((id) => visibleIds.has(id));
    const includeAllowances = visibleDetailQueue.length > 0;
    const queue = includeAllowances ? visibleDetailQueue : visibleBalanceQueue;
    if (!queue.length) return;

    const batch = queue.slice(0, 3);
    setDetailsInFlight(true);
    const startedAt = Date.now();
    if (DEBUG_DETAILS) {
      console.info("[ADMIN DETAILS FETCH] start", { batch, includeAllowances });
    }
    setDetailLoading((prev) => ({
      ...prev,
      ...batch.reduce<Record<string, boolean>>((acc, id) => {
        acc[id] = true;
        return acc;
      }, {}),
    }));

    (async () => {
      try {
        const res = await fetch("/api/admin/members/details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: batch, fields: includeAllowances ? ["balances", "allowances"] : ["balances"] }),
          cache: "no-store",
        });
        if (DEBUG_DETAILS) {
          console.info("[ADMIN DETAILS FETCH] status", res.status, "batch", batch);
        }
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Failed to load member details");
        }
        const members = Array.isArray(data?.members) ? data.members : [];
        if (members.length) {
          setRoster((prev) => {
            if (!prev) return prev;
            const map = new Map(prev.members.map((m) => [m.id, m]));
            for (const entry of members) {
              const current = map.get(entry.id);
              if (current) {
                const merged = {
                  ...current,
                  ...entry,
                  memberSince: Number.isFinite(entry.memberSince) ? entry.memberSince : current.memberSince,
                  allowances: includeAllowances ? { ...current.allowances, ...entry.allowances } : current.allowances,
                };
                if (!includeAllowances) {
                  merged.autoRenew = current.autoRenew;
                }
                map.set(entry.id, merged);
              }
            }
            return { ...prev, members: Array.from(map.values()) };
          });
          setDetailLoaded((prev) => ({
            ...prev,
            ...members.reduce((acc: Record<string, boolean>, member: AdminMember) => {
              acc[member.id] = true;
              return acc;
            }, {} as Record<string, boolean>),
          }));
          setDetailFailed((prev) => {
            const next = { ...prev };
            batch.forEach((id) => {
              delete next[id];
            });
            return next;
          });
        }
        setDetailError(null);
      } catch (err: any) {
        const msg = typeof err?.message === "string" ? err.message : "Failed to load member details";
        console.error("[ADMIN DETAILS FETCH] failed", msg, err);
        setDetailError(msg);
        setDetailFailed((prev) => ({
          ...prev,
          ...batch.reduce<Record<string, boolean>>((acc, id) => {
            acc[id] = true;
            return acc;
          }, {}),
        }));
      } finally {
        setDetailQueue((prev) => prev.filter((id) => !batch.includes(id)));
        setBalanceQueue((prev) => prev.filter((id) => !batch.includes(id)));
        setDetailLoading((prev) => {
          const next = { ...prev };
          batch.forEach((id) => delete next[id]);
          return next;
        });
        setDetailsInFlight(false);
        if (DEBUG_DETAILS) {
          console.info("[ADMIN DETAILS FETCH] finished", { batch, ms: Date.now() - startedAt });
        }
      }
    })();

    return () => undefined;
  }, [balanceQueue, detailQueue, detailsInFlight, filteredMembers]);

  const updateRefundStatus = async (id: string, status: "completed" | "rejected") => {
    try {
      const res = await fetch("/api/admin/refund/requests/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error("Update failed");
      setRefundRequests((prev) =>
        prev.map((req) => (req.id === id ? { ...req, status } : req)),
      );
      setEmailNotice({ tone: "success", message: `Request ${status}` });
    } catch (err: any) {
      setEmailNotice({ tone: "error", message: err?.message || "Failed to update request" });
    }
  };

  const issueRefundForRequest = async (req: { id: string; userId: string; email?: string | null }) => {
    setRequestRefundProcessing((prev) => ({ ...prev, [req.id]: true }));
    try {
      await cancelAndRefund({
        id: req.userId,
        name: null,
        email: req.email ?? null,
        firstName: null,
        lastName: null,
        wallets: [],
        primaryWallet: null,
        membershipStatus: "active",
        membershipExpiry: null,
        highestActiveTierId: null,
        highestActiveTierLabel: null,
        highestActiveTierExpiry: null,
        highestActiveTierLock: null,
        highestActiveTierTokenId: null,
        nextActiveTierId: null,
        nextActiveTierLabel: null,
        nextActiveTierExpiry: null,
        autoRenew: null,
        allowances: {},
        ethBalance: null,
        usdcBalance: null,
        isAdmin: false,
        isTestMember: false,
        welcomeEmailSentAt: null,
        lastEmailSentAt: null,
        lastEmailType: null,
        emailBounceReason: null,
        emailSuppressed: null,
        membershipCheckedAt: null,
        memberSince: null,
      } as AdminMember);

      await updateRefundStatus(req.id, "completed");
    } catch (err: any) {
      console.error("Issue refund from request failed", err);
      setEmailNotice({ tone: "error", message: err?.message || "Failed to issue refund" });
    } finally {
      setRequestRefundProcessing((prev) => ({ ...prev, [req.id]: false }));
    }
  };

  if (!roster) {
    return (
      <div className="glass-surface border border-amber-200/60 bg-white/80 p-6 text-amber-900">
        <div className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          Loading admin roster
        </div>
        <p className="mt-2 text-sm text-amber-800">
          {error || "Fetching the latest roster snapshot. If this takes too long, use Refresh to retry."}
        </p>
        <div className="mt-4">
          <Button onClick={handleRefresh} isLoading={loading} variant="outlined-primary">
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  const renderActionModal = () => {
    if (!actionModalMember) return null;
    const member = actionModalMember;
    return (
      <AlertDialog open={!!actionModalMember} onOpenChange={(open) => setActionModalMember(open ? member : null)}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Manage {member.name || member.email || "member"}</AlertDialogTitle>
            <AlertDialogDescription>
              Wallet: {formatWallet(member.primaryWallet)} · Tier: {resolveMemberTierLabel(member)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start border-rose-300 text-rose-700 hover:bg-rose-50 disabled:border-rose-200 disabled:text-rose-300"
              onClick={() => {
                setActionModalMember(null);
                setRefundConfirmMember(member);
                setRefundConfirmOpen(true);
              }}
              isLoading={!!refundProcessing[member.id]}
              disabled={!member.highestActiveTierLock}
            >
              Cancel & refund
            </Button>
            <Button
              size="sm"
              variant="outlined-primary"
              className="w-full justify-start"
              onClick={() => {
                setActionModalMember(null);
                openWelcomeModal(member);
              }}
              isLoading={!!sendingEmail[member.id]}
              disabled={!member.email}
            >
              {member.welcomeEmailSentAt ? "Customize & resend welcome" : "Send welcome email"}
            </Button>
            <Button
              size="sm"
              variant="outlined-primary"
              className="w-full justify-start"
              onClick={() => {
                setActionModalMember(null);
                openCustomModal(member);
              }}
              isLoading={!!sendingEmail[member.id]}
              disabled={!member.email}
            >
              Send custom email
            </Button>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm font-semibold text-[#0b0b43]">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border border-[rgba(11,11,67,0.3)] accent-[var(--brand-denim)]"
                  checked={member.isAdmin}
                  onChange={(e) => toggleAdmin(member, e.target.checked)}
                  disabled={!!adminUpdating[member.id]}
                />
                Admin access
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-[#0b0b43]">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border border-[rgba(11,11,67,0.3)] accent-[var(--brand-denim)]"
                  checked={member.isTestMember}
                  onChange={(e) => toggleTestMember(member, e.target.checked)}
                  disabled={!!testMemberUpdating[member.id]}
                />
                Test member
              </label>
            </div>
            {adminError && <div className="text-xs text-rose-700">{adminError}</div>}
            {testMemberError && <div className="text-xs text-rose-700">{testMemberError}</div>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="ghost" onClick={() => setActionModalMember(null)}>
                Close
              </Button>
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  return (
    <>
      <div className="space-y-6">
        <div className="glass-surface border border-white/40 bg-white/85 p-5 shadow-[0_26px_46px_-26px_rgba(11,11,67,0.32)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="section-eyebrow text-[var(--brand-denim)]">Refund requests</p>
              <p className="text-sm text-muted-foreground">Members can request cancel + refund; visible if you are lock manager.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {pendingRefundCount > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                  <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
                  {pendingRefundCount} pending
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">No pending requests</span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRefundExpanded((prev) => !prev)}
              >
                {refundExpanded ? "Hide requests" : "View requests"}
              </Button>
              <Button variant="outlined-primary" size="sm" onClick={fetchRefundRequests} isLoading={refundLoading}>
                <RefreshCcw className="h-4 w-4" aria-hidden="true" /> Refresh
              </Button>
              {refundExpanded && (
                <Button variant="ghost" size="sm" onClick={clearRefundRequests} disabled={refundRequests.length === 0 || refundLoading}>
                  Clear all
                </Button>
              )}
            </div>
          </div>
          {refundExpanded && (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-[rgba(11,11,67,0.06)] text-sm">
                <thead className="bg-[rgba(11,11,67,0.04)] text-xs uppercase tracking-[0.22em] text-[var(--brand-denim)]">
                  <tr>
                    <th className="px-4 py-3 text-left">Member</th>
                    <th className="px-4 py-3 text-left">Wallet</th>
                    <th className="px-4 py-3 text-left">Tier</th>
                    <th className="px-4 py-3 text-left">Created</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(11,11,67,0.06)]">
                  {refundRequests.length === 0 && (
                    <tr>
                      <td className="px-4 py-4 text-sm text-muted-foreground" colSpan={6}>
                        No refund requests.
                      </td>
                    </tr>
                  )}
                  {refundRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-white">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#0b0b43]">{req.email || "Unknown"}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-[#0b0b43]">
                        {(() => {
                          if (!req.wallet) return "N/A";
                          const href = walletLink(req.wallet);
                          return href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--brand-denim)] underline decoration-dotted underline-offset-4 hover:text-[#0b0b43]"
                            >
                              {formatWallet(req.wallet)}
                            </a>
                          ) : (
                            formatWallet(req.wallet)
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <div>{req.tierLabel || "Unknown tier"}</div>
                        {req.postCancelPreference ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            After refund: {req.postCancelPreference === "cancel-all" ? "cancel all (including free)" : "keep free Member access"}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {req.createdAt ? DateTime.fromISO(req.createdAt).toLocaleString(DateTime.DATETIME_MED) : "—"}
                      </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-[rgba(11,11,67,0.12)] bg-white px-3 py-1 text-xs font-semibold text-[#0b0b43]">
                        {req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-rose-300 text-rose-700 hover:bg-rose-50 disabled:border-rose-200 disabled:text-rose-300"
                        disabled={!req.canExecute || !!requestRefundProcessing[req.id] || req.status === "completed"}
                        isLoading={!!requestRefundProcessing[req.id]}
                        onClick={() => issueRefundForRequest(req)}
                      >
                        Issue refund
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={req.status === "completed"}
                        onClick={() => updateRefundStatus(req.id, "rejected")}
                      >
                        Reject
                      </Button>
                      {!req.canExecute && (
                        <div className="text-[0.72rem] text-rose-700">Lock manager required</div>
                      )}
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          )}
          {!refundExpanded && refundRequests.length > 0 && (
            <div className="mt-3 text-xs text-muted-foreground">
              {refundRequests.length} request{refundRequests.length === 1 ? "" : "s"} available. Expand to review.
            </div>
          )}
        </div>

        <div className="glass-surface overflow-hidden border border-white/40 bg-white/85 shadow-[0_26px_46px_-26px_rgba(11,11,67,0.32)]">
          <div className="border-b border-[rgba(11,11,67,0.06)] bg-white/70 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="section-eyebrow text-[var(--brand-denim)]">Members</p>
              <span className="text-sm text-muted-foreground">On-chain roster · wallets · email status.</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <input
                type="search"
                placeholder="Search name, email, wallet, tier"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-full border border-[rgba(11,11,67,0.12)] bg-white px-4 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)] sm:w-48"
              />
              <select
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value)}
                className="w-full rounded-full border border-[rgba(11,11,67,0.12)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)] sm:w-32"
              >
                <option value="all">All tiers</option>
                <option value="test">Test members</option>
                {TIER_FILTERS.map((tier) => (
                  <option key={tier.value} value={tier.value}>
                    {tier.label}
                  </option>
                ))}
                {roster?.members?.some((member) => !resolveMemberTierKey(member)) ? (
                  <option value="none">No membership</option>
                ) : null}
              </select>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="w-full rounded-full border border-[rgba(11,11,67,0.12)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)] sm:w-36"
              >
                <option value="last-name">Sort: Last name</option>
                <option value="joined">Sort: Joined date</option>
                <option value="expiry">Sort: Expiry date</option>
              </select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))}
                className="w-full justify-center sm:w-[72px]"
              >
                <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
                {sortDirection === "asc" ? "Asc" : "Desc"}
              </Button>
              <Button
                onClick={handleRetrieveDetails}
                isLoading={detailsInFlight}
                size="sm"
                variant="outline"
                className="w-full whitespace-nowrap sm:w-auto"
                disabled={filteredMembers.length === 0}
              >
                Retrieve details
              </Button>
              <Button onClick={handleRefresh} isLoading={loading} size="sm" variant="outlined-primary" className="w-full whitespace-nowrap sm:w-auto">
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                Refresh
              </Button>
              <Button
                onClick={handleCacheRebuild}
                isLoading={cacheRebuildLoading}
                size="sm"
                variant="outline"
                className="w-full whitespace-nowrap sm:w-auto"
                disabled={!cacheSummary.enabled}
              >
                Rebuild cache
              </Button>
              {detailsInFlight && (
                <div className="flex items-center gap-2 text-sm text-[var(--brand-denim)]">
                  <RefreshCcw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Retrieving details...
                </div>
              )}
              {cachePolling && roster?.cache?.lockActive && (
                <div className="flex items-center gap-2 text-sm text-[var(--brand-denim)]">
                  <RefreshCcw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Rebuilding cache...
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-[var(--brand-denim)]">{cacheSummary.label}</span>
              <span>{cacheSummary.detail}</span>
            </div>
          </div>

          {error && (
            <div className="bg-rose-50/80 px-5 py-3 text-sm text-rose-800">
              {error}
            </div>
          )}
          {cacheNotice && (
            <div className="bg-amber-50/80 px-5 py-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden="true" />
                <span>{cacheNotice.message}</span>
              </div>
            </div>
          )}
          {emailNotice && (
            <div
              className={cn(
                "px-5 py-3 text-sm",
                emailNotice.tone === "success"
                  ? "bg-emerald-50/80 text-emerald-900"
                  : "bg-rose-50/80 text-rose-900",
              )}
            >
              {emailNotice.message}
            </div>
          )}
          {detailError && (
            <div className="bg-amber-50/80 px-5 py-3 text-sm text-amber-900">
              {detailError}
            </div>
          )}
          {hasFailedDetails && !detailError && (
            <div className="bg-amber-50/80 px-5 py-3 text-sm text-amber-900">
              Some member details failed to load. Use “Retrieve details” to try again.
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[rgba(11,11,67,0.06)] text-sm text-[#0b0b43]">
              <thead className="bg-[rgba(11,11,67,0.04)] text-xs uppercase tracking-[0.22em] text-[var(--brand-denim)]">
                <tr>
                  <th className="px-5 py-3 text-left">Member</th>
                  <th className="px-5 py-3 text-left">Tier</th>
                  <th className="px-5 py-3 text-left">Joined</th>
                  <th className="px-5 py-3 text-left">Expiry</th>
                  <th className="px-5 py-3 text-left">Auto-renew</th>
                  <th className="px-5 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(11,11,67,0.06)] bg-white/70">
                {filteredMembers.length === 0 && (
                  <tr>
                    <td className="px-5 py-6 text-sm text-muted-foreground" colSpan={6}>
                      {roster?.cache?.missing
                        ? "Roster cache is rebuilding. Data will appear shortly."
                        : "No members match this filter."}
                    </td>
                  </tr>
                )}
                {filteredMembers.map((member) => {
                  const isDetailLoading = !!detailLoading[member.id];
                  const nonRenewableTier = isNonRenewableTierMember(member);
                  const detailsLoaded = !!detailLoaded[member.id];
                  const hasActiveTier = !!resolveMemberTierKey(member);
                  const showPlaceholder = hasActiveTier && !nonRenewableTier && !detailsLoaded && !isDetailLoading;
                  const autoRenewState = member.autoRenew;
                  const tierLabel = resolveMemberTierLabel(member);
                  const joinDate = formatJoinDate(member.memberSince);
                  const isExpanded = !!expandedMembers[member.id];
                  const autoRenewLabel = nonRenewableTier
                    ? "N/A"
                    : isDetailLoading
                      ? "Loading..."
                      : showPlaceholder
                        ? "—"
                        : autoRenewState === true
                          ? "On"
                          : autoRenewState === false
                            ? "Off"
                            : "N/A";
                  const autoRenewDetail = nonRenewableTier
                    ? "Not applicable"
                    : isDetailLoading
                      ? "Fetching allowance..."
                      : showPlaceholder
                        ? ""
                        : autoRenewState === false
                          ? "Allowance missing"
                          : autoRenewState === true
                            ? "Allowance present"
                            : hasActiveTier
                              ? "Allowance unavailable"
                              : "No active tier";
                  const autoRenewTone = nonRenewableTier
                    ? autoRenewClasses.na
                    : autoRenewState === true
                      ? autoRenewClasses.on
                      : autoRenewState === false
                        ? autoRenewClasses.off
                        : autoRenewClasses.na;
                  return (
                    <Fragment key={member.id}>
                      <tr className="transition hover:bg-white">
                        <td className="px-5 py-4 align-top">
                          <div className="font-semibold text-[#0b0b43]">
                            {member.name || `${member.firstName || ""} ${member.lastName || ""}`.trim() || "Unknown"}
                          </div>
                          <div className="text-xs text-muted-foreground">{member.email || "No email on file"}</div>
                          {member.isTestMember && (
                            <div className="mt-1 text-[0.65rem] uppercase tracking-[0.2em] text-rose-700">
                              Test member
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="text-sm font-semibold text-[#0b0b43]">{tierLabel}</div>
                          {member.nextActiveTierLabel && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Next: {member.nextActiveTierLabel}
                              {member.nextActiveTierExpiry ? ` · ${formatExpiry(member.nextActiveTierExpiry).label}` : ""}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="text-sm font-medium text-[#0b0b43]">{joinDate.label}</div>
                          <div className="text-xs text-muted-foreground">{joinDate.detail}</div>
                        </td>
                        <td className="px-5 py-4 align-top">
                          {(() => {
                            const expiry = formatExpiry(member.membershipExpiry);
                            return (
                              <>
                                <div className="text-sm font-medium text-[#0b0b43]">{expiry.label}</div>
                                <div className="text-xs text-muted-foreground">{expiry.detail || ""}</div>
                              </>
                            );
                          })()}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
                              isDetailLoading && !nonRenewableTier ? autoRenewClasses.na : autoRenewTone,
                            )}
                          >
                            {autoRenewLabel}
                          </span>
                          {autoRenewDetail ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {autoRenewDetail}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="ghost" onClick={() => toggleMemberDetails(member.id)}>
                              {isExpanded ? "Hide details" : "Show details"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setActionModalMember(member)}>
                              Actions
                            </Button>
                          </div>
                          {adminError && <div className="mt-1 text-xs text-rose-700">{adminError}</div>}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-white/70">
                          <td className="px-5 pb-5 pt-0" colSpan={6}>
                            <div className="grid gap-4 rounded-2xl border border-[rgba(11,11,67,0.08)] bg-white/70 p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                              <div>
                                <div className="text-[0.65rem] uppercase tracking-[0.22em] text-[var(--brand-denim)]">Wallet</div>
                                <div className="mt-1 flex items-center gap-2 font-mono text-[#0b0b43]">
                                  <Wallet className="h-4 w-4 text-[var(--brand-denim)]" aria-hidden="true" />
                                  {(() => {
                                    const href = walletLink(member.primaryWallet);
                                    if (href) {
                                      return (
                                        <a
                                          href={href}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-[var(--brand-denim)] underline decoration-dotted underline-offset-4 hover:text-[#0b0b43]"
                                        >
                                          {formatWallet(member.primaryWallet)}
                                        </a>
                                      );
                                    }
                                    return formatWallet(member.primaryWallet);
                                  })()}
                                </div>
                                {member.wallets.length > 1 && (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    +{member.wallets.length - 1} linked wallet{member.wallets.length - 1 === 1 ? "" : "s"}
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="text-[0.65rem] uppercase tracking-[0.22em] text-[var(--brand-denim)]">Balances</div>
                                <div className="mt-1 text-sm font-semibold text-[#0b0b43]">
                                  {isDetailLoading ? "Loading..." : formatBalance(member.ethBalance, "ETH")}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {isDetailLoading ? "Loading..." : formatBalance(member.usdcBalance, "USDC")}
                                </div>
                              </div>
                              <div>
                                <div className="text-[0.65rem] uppercase tracking-[0.22em] text-[var(--brand-denim)]">Email</div>
                                <div className="mt-1">
                                  <EmailBadge member={member} />
                                </div>
                                {member.lastEmailSentAt && (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    Last: {member.lastEmailType || "Email"} -{" "}
                                    {DateTime.fromISO(member.lastEmailSentAt).isValid
                                      ? DateTime.fromISO(member.lastEmailSentAt).toRelative()
                                      : member.lastEmailSentAt}
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="text-[0.65rem] uppercase tracking-[0.22em] text-[var(--brand-denim)]">Details</div>
                                <div className="mt-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      queueDetails([member.id], {
                                        resetFailures: true,
                                        includeAllowances: !nonRenewableTier,
                                      })
                                    }
                                    isLoading={isDetailLoading}
                                    disabled={isDetailLoading}
                                  >
                                    {detailLoaded[member.id] ? "Refresh details" : "Load details"}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AlertDialog open={emailModalOpen} onOpenChange={handleModalOpenChange}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>{emailModalMode === "welcome" ? "Send welcome email" : "Send custom email"}</AlertDialogTitle>
            <AlertDialogDescription>
              {emailModalMode === "welcome"
                ? `Customize the welcome email to ${emailModalMember?.email || "this member"}.`
                : `Compose a one-off email to ${emailModalMember?.email || "this member"}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[#0b0b43]" htmlFor="email-subject">
                Subject
              </label>
              <input
                id="email-subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full rounded-md border border-[rgba(11,11,67,0.15)] px-3 py-2 text-sm text-[#0b0b43] shadow-inner focus:border-[rgba(67,119,243,0.5)] focus:outline-none focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-[#0b0b43]" htmlFor="email-body">
                Body
              </label>
              <textarea
                id="email-body"
                rows={8}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="w-full rounded-md border border-[rgba(11,11,67,0.15)] px-3 py-2 text-sm text-[#0b0b43] shadow-inner focus:border-[rgba(67,119,243,0.5)] focus:outline-none focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
              />
              <p className="text-xs text-muted-foreground">Plain text allowed; HTML will be sent as provided.</p>
            </div>
            {emailModalError && <p className="text-sm text-rose-700">{emailModalError}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="ghost" onClick={() => setEmailModalOpen(false)}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button onClick={handleModalSend} isLoading={!!(emailModalMember && sendingEmail[emailModalMember.id])}>
              Send email
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={refundConfirmOpen} onOpenChange={setRefundConfirmOpen}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm cancellation & refund</AlertDialogTitle>
            <AlertDialogDescription>
              This will expire and refund all active memberships for {refundConfirmMember?.email || refundConfirmMember?.name || "this member"} using your wallet as lock manager, and send them a confirmation email with refund details.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            <ul className="list-disc space-y-1 pl-5">
              <li>Expire and refund every active membership key found for this user.</li>
              <li>Requires your connected wallet to be a lock manager for each lock.</li>
              <li>Lock must have funds available to cover the refund.</li>
              <li>Sends a confirmation email to the member with refunded amounts.</li>
            </ul>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#0b0b43]" htmlFor="refund-override">
              Refund amount override (optional, applies per key)
            </label>
            <input
              id="refund-override"
              type="text"
              value={refundAmountInput}
              onChange={(e) => setRefundAmountInput(e.target.value)}
              placeholder={USDC_ADDRESS ? "e.g. 0.10 (USDC)" : "e.g. 0.01 (ETH)"}
              className="w-full rounded-md border border-[rgba(11,11,67,0.15)] px-3 py-2 text-sm text-[#0b0b43] shadow-inner focus:border-[rgba(67,119,243,0.5)] focus:outline-none focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
            />
            <p className="text-xs text-muted-foreground">
              Defaults to the lock’s refundable amount. If refunds are disabled, enter the amount to refund (per key) to proceed.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="ghost" onClick={() => setRefundConfirmOpen(false)}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button
              variant="outline"
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
              onClick={() => {
                if (refundConfirmMember) {
                  void cancelAndRefund(refundConfirmMember);
                }
                setRefundConfirmOpen(false);
              }}
            >
              Confirm refund
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {renderActionModal()}
    </>
  );
}


function EmailBadge({ member }: { member: AdminMember }) {
  const { label, icon: Icon, tone } = emailStatus(member);
  const classes =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-slate-200 bg-slate-100 text-slate-700";
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold", classes)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </span>
  );
}
