"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { MembershipSummary } from "@/lib/membership-server";
import {
  clearPrefetchedMembership,
  loadPrefetchedMembershipFor,
  savePrefetchedMembership,
} from "@/lib/membership-prefetch";

export default function ProfileSettingsPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const ready = status !== "loading";
  const authenticated = status === "authenticated";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState<
    { firstName: string; lastName: string; xHandle: string; linkedinUrl: string } | null
  >(null);

  const sessionUser = session?.user as any | undefined;
  const wallets = useMemo(() => {
    const list = sessionUser?.wallets;
    return Array.isArray(list) ? list.map((item) => String(item)) : [];
  }, [sessionUser]);
  const walletAddress = sessionUser?.walletAddress as string | undefined;
  const sessionMembershipSummary = sessionUser?.membershipSummary as MembershipSummary | null | undefined;
  const sessionMembershipStatus = (sessionMembershipSummary?.status ?? sessionUser?.membershipStatus) as
    | "active"
    | "expired"
    | "none"
    | undefined;
  const sessionMembershipExpiry =
    sessionMembershipSummary?.expiry ?? (typeof sessionUser?.membershipExpiry === "number" ? sessionUser.membershipExpiry : null);
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

  useEffect(() => {
    if (!authenticated || !sessionUser) return;
    const u: any = sessionUser || {};
    setFirstName(u.firstName || "");
    setLastName(u.lastName || "");
    setXHandle(u.xHandle || "");
    setLinkedinUrl(u.linkedinUrl || "");
    setInitial({
      firstName: (u.firstName as string) || "",
      lastName: (u.lastName as string) || "",
      xHandle: (u.xHandle as string) || "",
      linkedinUrl: (u.linkedinUrl as string) || "",
    });
  }, [authenticated, sessionUser]);

  useEffect(() => {
    if (!authenticated) {
      clearPrefetchedMembership();
      return;
    }
    if (!membershipAddresses.length) {
      clearPrefetchedMembership();
      return;
    }

    if (sessionMembershipSummary) {
      savePrefetchedMembership({
        summary: sessionMembershipSummary,
        status: sessionMembershipSummary.status,
        expiry: sessionMembershipSummary.expiry ?? null,
        addresses: membershipAddresses,
      });
      return;
    }

    const existing = loadPrefetchedMembershipFor(membershipAddresses);
    if (existing) {
      return;
    }

    const fetchMembership = async () => {
      try {
        const query = encodeURIComponent(membershipAddresses.join(","));
        const response = await fetch(`/api/membership/expiry?addresses=${query}`, { cache: "no-store" });
        if (!response.ok) {
          clearPrefetchedMembership();
          return;
        }
        const payload = await response.json();
        const summary =
          payload && typeof payload === "object" && Array.isArray(payload?.tiers)
            ? (payload as MembershipSummary)
            : null;
        if (summary) {
          savePrefetchedMembership({
            summary,
            status: summary.status,
            expiry: summary.expiry ?? null,
            addresses: membershipAddresses,
          });
          return;
        }
        const normalizeStatus = (value: unknown): "active" | "expired" | "none" =>
          value === "active" || value === "expired" || value === "none" ? value : "none";
        const fallbackStatus = normalizeStatus(payload?.status ?? sessionMembershipStatus ?? "none");
        const fallbackExpiryRaw = payload?.expiry ?? sessionMembershipExpiry;
        const fallbackExpiry =
          typeof fallbackExpiryRaw === "number" && Number.isFinite(fallbackExpiryRaw) ? fallbackExpiryRaw : null;
        savePrefetchedMembership({
          summary: null,
          status: fallbackStatus,
          expiry: fallbackExpiry,
          addresses: membershipAddresses,
        });
      } catch {
        if (sessionMembershipStatus) {
          savePrefetchedMembership({
            summary: null,
            status: sessionMembershipStatus,
            expiry: sessionMembershipExpiry ?? null,
            addresses: membershipAddresses,
          });
        }
      }
    };

    void fetchMembership();
  }, [
    authenticated,
    membershipAddresses,
    sessionMembershipExpiry,
    sessionMembershipStatus,
    sessionMembershipSummary,
  ]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      if (!firstName.trim()) throw new Error("First name is required");
      if (!lastName.trim()) throw new Error("Last name is required");
      if (linkedinUrl.trim()) {
        try {
          const url = new URL(linkedinUrl.trim());
          if (!/^https?:$/.test(url.protocol)) throw new Error();
        } catch {
          throw new Error("LinkedIn URL must be http(s)");
        }
      }
      const res = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          xHandle: xHandle.trim(),
          linkedinUrl: linkedinUrl.trim(),
        }),
      });
      if (!res.ok) {
        let detail: any = undefined;
        try {
          detail = await res.json();
        } catch {}
        throw new Error(detail?.error || res.statusText || "Update failed");
      }
      setMessage("Profile updated");
      await update({});
      setInitial({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        xHandle: xHandle.trim(),
        linkedinUrl: linkedinUrl.trim(),
      });
    } catch (e: any) {
      setError(e?.message || "Unexpected error");
    } finally {
      setSubmitting(false);
    }
  };

  const isDirty = () => {
    if (!initial) return false;
    const current = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      xHandle: xHandle.trim(),
      linkedinUrl: linkedinUrl.trim(),
    };
    return (
      current.firstName !== (initial.firstName || "") ||
      current.lastName !== (initial.lastName || "") ||
      current.xHandle !== (initial.xHandle || "") ||
      current.linkedinUrl !== (initial.linkedinUrl || "")
    );
  };

  const handleBack = () => {
    if (isDirty()) {
      const proceed = confirm("You have unsaved changes. Leave without saving?");
      if (!proceed) return;
    }
    router.push("/");
  };

  if (!ready) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!authenticated) {
    return (
      <div className="space-y-4">
        <p>You need to sign in to edit your profile.</p>
        <Button onClick={() => router.push("/signin?callbackUrl=/settings/profile")}>
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" onClick={handleBack}>
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
      <section className="rounded-lg border p-6 shadow-sm space-y-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Profile information</h2>
          <p className="text-sm text-muted-foreground">
            Keep your contact information current so we can share community updates.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="firstName" className="text-sm font-medium">
                First name
              </label>
              <input
                id="firstName"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
                className="w-full rounded-md border px-3 py-2 text-sm dark:border-input dark:bg-input/30"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="lastName" className="text-sm font-medium">
                Last name
              </label>
              <input
                id="lastName"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                required
                className="w-full rounded-md border px-3 py-2 text-sm dark:border-input dark:bg-input/30"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="xHandle" className="text-sm font-medium">
              X handle (optional)
            </label>
            <input
              id="xHandle"
              value={xHandle}
              onChange={(event) => setXHandle(event.target.value)}
              placeholder="@handle"
              className="w-full rounded-md border px-3 py-2 text-sm dark:border-input dark:bg-input/30"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="linkedin" className="text-sm font-medium">
              LinkedIn URL (optional)
            </label>
            <input
              id="linkedin"
              value={linkedinUrl}
              onChange={(event) => setLinkedinUrl(event.target.value)}
              placeholder="https://www.linkedin.com/in/username"
              className="w-full rounded-md border px-3 py-2 text-sm dark:border-input dark:bg-input/30"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border p-6 shadow-sm space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Linked wallets</h2>
          <p className="text-sm text-muted-foreground">
            Connected wallets grant access to gated content and enable on-chain renewals.
          </p>
        </div>
        {wallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No wallets linked.</p>
        ) : (
          <ul className="space-y-2">
            {wallets.map((wallet) => (
              <li
                key={wallet}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <code className="break-all text-xs">{wallet}</code>
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (
                      !confirm(
                        "Unlink this wallet? You may lose access to gated content until you link again."
                      )
                    )
                      return;
                    try {
                      const res = await fetch("/api/auth/unlink-wallet", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ address: wallet }),
                      });
                      if (!res.ok) {
                        let detail: any = undefined;
                        try {
                          detail = await res.json();
                        } catch {}
                        throw new Error(detail?.error || res.statusText || "Unlink failed");
                      }
                      await update({});
                    } catch (err: any) {
                      alert(err?.message || "Unlink failed");
                    }
                  }}
                >
                  Unlink
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
