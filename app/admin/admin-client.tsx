"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { DateTime } from "luxon";
import { AlertTriangle, MailCheck, MailQuestion, RefreshCcw, ShieldCheck, Wallet } from "lucide-react";
import type { AdminMember, AdminRoster } from "@/lib/admin/roster";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BASE_BLOCK_EXPLORER_URL, BASE_CHAIN_ID_HEX, BASE_NETWORK_ID, USDC_ADDRESS } from "@/lib/config";
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
const AUTO_DETAIL_ENABLED = true;
const DEBUG_DETAILS = process.env.NEXT_PUBLIC_DEBUG_ADMIN_DETAILS === "true";

type StatTone = "emerald" | "amber" | "rose" | "slate";

const statusClasses: Record<AdminMember["membershipStatus"], string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  expired: "border-amber-200 bg-amber-50 text-amber-900",
  none: "border-slate-200 bg-slate-100 text-slate-700",
  unknown: "border-slate-200 bg-slate-100 text-slate-700",
};

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

function formatExpiry(expiry: number | null) {
  if (!expiry) return { label: "No expiry", detail: null };
  const dt = DateTime.fromSeconds(expiry);
  if (!dt.isValid) return { label: "Unknown", detail: null };
  return {
    label: dt.toLocaleString(DateTime.DATE_MED),
    detail: dt.toRelative(),
  };
}

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

function computeMetaFromMembers(members: AdminMember[]) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    total: members.length,
    active: members.filter((m) => m.membershipStatus === "active").length,
    expired: members.filter((m) => m.membershipStatus === "expired").length,
    none: members.filter((m) => m.membershipStatus === "none").length,
    autoRenewOn: members.filter((m) => m.autoRenew === true).length,
    autoRenewOff: members.filter((m) => m.autoRenew === false).length,
    expiringSoon: members.filter(
      (m) => typeof m.membershipExpiry === "number" && m.membershipExpiry > nowSec && m.membershipExpiry < nowSec + 30 * 24 * 60 * 60,
    ).length,
  };
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
  const [loading, setLoading] = useState(false);
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
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired" | "none">("active");
  const [detailQueue, setDetailQueue] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [detailLoaded, setDetailLoaded] = useState<Record<string, boolean>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailsInFlight, setDetailsInFlight] = useState(false);
  const [detailFailed, setDetailFailed] = useState<Record<string, boolean>>({});
  const handleModalOpenChange = (open: boolean) => {
    setEmailModalOpen(open);
    if (!open) {
      setEmailModalMember(null);
      setEmailModalMode(null);
      setEmailModalError(null);
    }
  };

  const filteredMembers = useMemo(() => {
    if (!roster?.members) return [];
    const q = query.trim().toLowerCase();
    const statusFiltered = statusFilter === "all"
      ? roster.members
      : roster.members.filter((m) => m.membershipStatus === statusFilter);
    if (!q) return statusFiltered;
    return statusFiltered.filter((member) => {
      const name = member.name || `${member.firstName || ""} ${member.lastName || ""}`.trim();
      const haystack = [
        name,
        member.email,
        member.primaryWallet,
        ...member.wallets,
        member.highestActiveTierLabel,
        member.highestActiveTierId,
      ]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      return haystack.some((value) => value.includes(q));
    });
  }, [roster, query, statusFilter]);

  const meta = useMemo(() => computeMetaFromMembers(roster?.members || []), [roster]);
  const hasFailedDetails = useMemo(() => Object.keys(detailFailed).length > 0, [detailFailed]);

  const queueDetails = (ids: string[], resetFailures = false) => {
    if (resetFailures) {
      setDetailFailed({});
    }
    if (!ids.length) return;
    if (DEBUG_DETAILS) {
      console.info("[ADMIN DETAILS] queueDetails", { ids, resetFailures });
    }
    setDetailFailed((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        delete next[id];
      });
      return next;
    });
    setDetailQueue(ids);
    setDetailsInFlight(false);
    setDetailError(null);
  };

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

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    setEmailNotice(null);
    setDetailError(null);
    setDetailFailed({});
    try {
      const res = await fetch("/api/admin/members?fields=core", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Refresh failed (${res.status})`);
      }
      const data = (await res.json()) as AdminRoster;
      const filtered = currentAdminId
        ? { ...data, members: data.members.filter((m) => m.id !== currentAdminId) }
        : data;
      setRoster(filtered);
      setDetailLoaded({});
      setDetailLoading({});
      setDetailQueue([]);
      setDetailsInFlight(false);
    } catch (err: any) {
      const message = typeof err?.message === "string" ? err.message : "Failed to refresh roster";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!AUTO_DETAIL_ENABLED) return;
    if (detailsInFlight) return;
    if (detailQueue.length) return;
    const remaining = filteredMembers.filter((m) => !detailLoaded[m.id] && !detailFailed[m.id]);
    if (!remaining.length) return;
    queueDetails(remaining.map((m) => m.id), Object.keys(detailFailed).length > 0);
  }, [detailQueue, filteredMembers, detailLoaded, detailFailed, detailsInFlight]);

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
      setEmailNotice({ tone: "success", message: `${target ? "Granted" : "Removed"} admin for ${member.email || member.name || member.id}` });
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "Failed to update admin flag";
      setAdminError(msg);
      setEmailNotice({ tone: "error", message: msg });
    } finally {
      setAdminUpdating((prev) => ({ ...prev, [member.id]: false }));
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
    const visibleQueue = detailQueue.filter((id) => visibleIds.has(id));
    if (!visibleQueue.length) return;

    const batch = visibleQueue.slice(0, 3);
    setDetailsInFlight(true);
    const startedAt = Date.now();
    if (DEBUG_DETAILS) {
      console.info("[ADMIN DETAILS FETCH] start", { batch });
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
          body: JSON.stringify({ userIds: batch, fields: ["balances", "allowances"] }),
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
                map.set(entry.id, {
                  ...current,
                  ...entry,
                  allowances: { ...current.allowances, ...entry.allowances },
                });
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
  }, [detailQueue, detailsInFlight, filteredMembers]);

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
        welcomeEmailSentAt: null,
        lastEmailSentAt: null,
        lastEmailType: null,
        emailBounceReason: null,
        emailSuppressed: null,
        membershipCheckedAt: null,
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
      <div className="glass-surface border border-rose-200/60 bg-white/80 p-6 text-rose-900">
        <div className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          Admin data is unavailable
        </div>
        <p className="mt-2 text-sm text-rose-800">Could not load the initial roster. Try refreshing once connectivity is restored.</p>
        <div className="mt-4">
          <Button onClick={handleRefresh} isLoading={loading} variant="outlined-primary">
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Retry
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
              Wallet: {formatWallet(member.primaryWallet)} · Status: {member.membershipStatus}
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
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#0b0b43]">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border border-[rgba(11,11,67,0.3)] accent-[var(--brand-denim)]"
                checked={member.isAdmin}
                onChange={(e) => toggleAdmin(member, e.target.checked)}
                disabled={!!adminUpdating[member.id]}
              />
              Admin access
            </label>
            {adminError && <div className="text-xs text-rose-700">{adminError}</div>}
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 justify-items-center max-w-5xl mx-auto">
          <StatCard label="Active members" value={meta.active} detail={`${meta.total} total`} tone="emerald" icon={ShieldCheck} />
          <StatCard label="Auto-renew off" value={meta.autoRenewOff} detail="Members without USDC allowance" tone="rose" icon={Wallet} />
          <StatCard label="No membership" value={meta.none} detail="Signed up but not holding a key" tone="slate" icon={MailQuestion} />
        </div>

        <div className="glass-surface border border-white/40 bg-white/85 p-5 shadow-[0_26px_46px_-26px_rgba(11,11,67,0.32)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="section-eyebrow text-[var(--brand-denim)]">Refund requests</p>
              <p className="text-sm text-muted-foreground">Members can request cancel + refund; visible if you are lock manager.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outlined-primary" size="sm" onClick={fetchRefundRequests} isLoading={refundLoading}>
                <RefreshCcw className="h-4 w-4" aria-hidden="true" /> Refresh
              </Button>
              <Button variant="ghost" size="sm" onClick={clearRefundRequests} disabled={refundRequests.length === 0 || refundLoading}>
                Clear all
              </Button>
            </div>
          </div>
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
        </div>

        <div className="glass-surface overflow-hidden border border-white/40 bg-white/85 shadow-[0_26px_46px_-26px_rgba(11,11,67,0.32)]">
          <div className="flex flex-col gap-3 border-b border-[rgba(11,11,67,0.06)] bg-white/70 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="section-eyebrow text-[var(--brand-denim)]">Members</p>
              <p className="text-sm text-muted-foreground">Roster reflects on-chain membership, wallets, and email status.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="search"
                placeholder="Search name, email, wallet, tier"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-full border border-[rgba(11,11,67,0.12)] bg-white px-4 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)] sm:w-64"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full rounded-full border border-[rgba(11,11,67,0.12)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)] sm:w-40"
              >
                <option value="active">Active only</option>
                <option value="expired">Expired</option>
                <option value="none">None</option>
                <option value="all">All statuses</option>
              </select>
              <Button onClick={handleRefresh} isLoading={loading} variant="outlined-primary" className="w-full sm:w-auto">
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                Refresh
              </Button>
              {detailsInFlight && (
                <div className="flex items-center gap-2 text-sm text-[var(--brand-denim)]">
                  <RefreshCcw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Retrieving details...
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-rose-50/80 px-5 py-3 text-sm text-rose-800">
              {error}
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
                  <th className="px-5 py-3 text-left">Wallet</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-left">Expiry</th>
                  <th className="px-5 py-3 text-left">Auto-renew</th>
                  <th className="px-5 py-3 text-left">Balances</th>
                  <th className="px-5 py-3 text-left">Email</th>
                  <th className="px-5 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(11,11,67,0.06)] bg-white/70">
                {filteredMembers.length === 0 && (
                  <tr>
                    <td className="px-5 py-6 text-sm text-muted-foreground" colSpan={8}>
                      No members match this filter.
                    </td>
                  </tr>
                )}
                {filteredMembers.map((member) => {
                  const isDetailLoading = !!detailLoading[member.id];
                  const autoRenewState = member.autoRenew;
                  const autoRenewLabel = isDetailLoading
                    ? "Loading..."
                    : autoRenewState === true
                      ? "On"
                      : autoRenewState === false
                        ? "Off"
                        : "N/A";
                  const autoRenewDetail = isDetailLoading
                    ? "Fetching allowance..."
                    : autoRenewState === false
                      ? "Allowance missing"
                      : autoRenewState === true
                        ? "Allowance present"
                        : "No active tier";
                  const autoRenewTone =
                    autoRenewState === true
                      ? autoRenewClasses.on
                      : autoRenewState === false
                        ? autoRenewClasses.off
                        : autoRenewClasses.na;
                  return (
                    <tr key={member.id} className="transition hover:bg-white">
                      <td className="px-5 py-4 align-top">
                        <div className="font-semibold text-[#0b0b43]">
                          {member.name || `${member.firstName || ""} ${member.lastName || ""}`.trim() || "Unknown"}
                        </div>
                        <div className="text-xs text-muted-foreground">{member.email || "No email on file"}</div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="flex items-center gap-2 text-sm font-mono text-[#0b0b43]">
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
                          <div className="text-[0.72rem] text-muted-foreground">
                            +{member.wallets.length - 1} linked wallet{member.wallets.length - 1 === 1 ? "" : "s"}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-semibold", statusClasses[member.membershipStatus])}>
                          {member.membershipStatus === "none" ? "No membership" : member.membershipStatus.charAt(0).toUpperCase() + member.membershipStatus.slice(1)}
                        </span>
                        {member.highestActiveTierLabel && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Tier: {member.highestActiveTierLabel}
                            {member.highestActiveTierExpiry ? ` · ${formatExpiry(member.highestActiveTierExpiry).label}` : ""}
                          </div>
                        )}
                        {member.nextActiveTierLabel && (
                          <div className="text-[0.72rem] text-muted-foreground">
                            Next after expiry: {member.nextActiveTierLabel}
                            {member.nextActiveTierExpiry ? ` · ${formatExpiry(member.nextActiveTierExpiry).label}` : ""}
                          </div>
                        )}
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
                            isDetailLoading ? autoRenewClasses.na : autoRenewTone,
                          )}
                        >
                          {autoRenewLabel}
                        </span>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {autoRenewDetail}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="text-sm font-semibold text-[#0b0b43]">
                          {isDetailLoading ? "Loading..." : formatBalance(member.ethBalance, "ETH")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {isDetailLoading ? "Loading..." : formatBalance(member.usdcBalance, "USDC")}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <EmailBadge member={member} />
                        {member.lastEmailSentAt && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Last: {member.lastEmailType || "Email"} -{" "}
                            {DateTime.fromISO(member.lastEmailSentAt).isValid
                              ? DateTime.fromISO(member.lastEmailSentAt).toRelative()
                              : member.lastEmailSentAt}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setActionModalMember(member)}
                          >
                            Actions
                          </Button>
                        </div>
                        {adminError && <div className="mt-1 text-xs text-rose-700">{adminError}</div>}
                      </td>
                    </tr>
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

function StatCard({
  label,
  value,
  detail,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail?: string;
  tone: StatTone;
  icon: ComponentType<{ className?: string }>;
}) {
  const tones: Record<StatTone, string> = {
    emerald: "bg-emerald-50 text-emerald-900 border-emerald-100",
    amber: "bg-amber-50 text-amber-900 border-amber-100",
    rose: "bg-rose-50 text-rose-900 border-rose-100",
    slate: "bg-slate-50 text-slate-900 border-slate-100",
  };
  return (
    <div className={cn("w-full max-w-sm rounded-2xl border p-4 shadow-sm", tones[tone])}>
      <div className="flex items-center gap-3">
        <div className="rounded-full bg-white/70 p-2 shadow-inner">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-[0.3em]">{label}</p>
          <div className="text-2xl font-semibold leading-tight">{value}</div>
          {detail && <p className="text-xs text-black/60">{detail}</p>}
        </div>
      </div>
    </div>
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
