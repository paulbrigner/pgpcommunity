"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";

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
  const [initial, setInitial] = useState<{ firstName: string; lastName: string; xHandle: string; linkedinUrl: string } | null>(null);
  const wallets = ((session?.user as any)?.wallets as string[] | undefined) || [];

  useEffect(() => {
    if (!authenticated) return;
    const u: any = session?.user || {};
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
  }, [authenticated, session]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      if (!firstName.trim()) throw new Error("First name is required");
      if (!lastName.trim()) throw new Error("Last name is required");
      if (linkedinUrl.trim()) {
        try {
          const u = new URL(linkedinUrl.trim());
          if (!/^https?:$/.test(u.protocol)) throw new Error();
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
        try { detail = await res.json(); } catch {}
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
    const cur = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      xHandle: xHandle.trim(),
      linkedinUrl: linkedinUrl.trim(),
    };
    return (
      cur.firstName !== (initial.firstName || "") ||
      cur.lastName !== (initial.lastName || "") ||
      cur.xHandle !== (initial.xHandle || "") ||
      cur.linkedinUrl !== (initial.linkedinUrl || "")
    );
  };

  if (!ready) return <div className="max-w-xl mx-auto p-6">Loading…</div>;
  if (!authenticated) {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p>You need to sign in to edit your profile.</p>
        <Button onClick={() => router.push("/signin?callbackUrl=/settings/profile")}>Sign in</Button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Profile Settings</h1>
      <div>
        <Button
          variant="outline"
          onClick={() => {
            if (isDirty()) {
              const proceed = confirm(
                "You have unsaved changes. Leave without saving?"
              );
              if (!proceed) return;
            }
            router.push("/");
          }}
        >
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
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label htmlFor="firstName" className="text-sm font-medium">First name</label>
            <input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input" />
          </div>
          <div className="space-y-2">
            <label htmlFor="lastName" className="text-sm font-medium">Last name</label>
            <input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input" />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="xHandle" className="text-sm font-medium">X handle (optional)</label>
          <input id="xHandle" value={xHandle} onChange={(e) => setXHandle(e.target.value)} placeholder="@handle" className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input" />
        </div>
        <div className="space-y-2">
          <label htmlFor="linkedin" className="text-sm font-medium">LinkedIn URL (optional)</label>
          <input id="linkedin" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://www.linkedin.com/in/username" className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input" />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Wallets</h2>
        {wallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No wallets linked.</p>
        ) : (
          <ul className="space-y-2">
            {wallets.map((w) => (
              <li key={w} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <code className="text-xs break-all">{w}</code>
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (!confirm("Unlink this wallet? You may lose access to gated content until you link again.")) return;
                    try {
                      const res = await fetch("/api/auth/unlink-wallet", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ address: w }),
                      });
                      if (!res.ok) {
                        let detail: any = undefined;
                        try { detail = await res.json(); } catch {}
                        throw new Error(detail?.error || res.statusText || "Unlink failed");
                      }
                      await update({});
                    } catch (e: any) {
                      alert(e?.message || "Unlink failed");
                    }
                  }}
                >
                  Unlink
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
