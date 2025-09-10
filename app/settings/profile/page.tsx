"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Contract, BrowserProvider } from "ethers";
import { LOCK_ADDRESS, USDC_ADDRESS } from "@/lib/config";

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
  const [canceling, setCanceling] = useState(false);
  const [autoRenewChecking, setAutoRenewChecking] = useState(false);
  const [autoRenewEnabled, setAutoRenewEnabled] = useState<boolean | null>(null);
  const [autoRenewPrice, setAutoRenewPrice] = useState<bigint | null>(null);

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

  // Check current USDC allowance vs. current key price to infer auto-renew readiness
  useEffect(() => {
    if (!authenticated) return;
    (async () => {
      setAutoRenewChecking(true);
      try {
        if (!USDC_ADDRESS || !LOCK_ADDRESS) throw new Error("Missing contract addresses");
        const eth = (globalThis as any).ethereum;
        if (!eth) throw new Error("No wallet found in browser");
        const provider = new BrowserProvider(eth);
        const signer = await provider.getSigner();
        const owner = await signer.getAddress();
        const erc20 = new Contract(
          USDC_ADDRESS,
          [
            'function allowance(address owner, address spender) view returns (uint256)',
            'function decimals() view returns (uint8)'
          ],
          signer
        );
        const lock = new Contract(
          LOCK_ADDRESS,
          [
            'function keyPrice() view returns (uint256)'
          ],
          signer
        );
        // Fetch price and allowance
        let price: bigint = 0n;
        try { price = await lock.keyPrice(); } catch { price = 100000n; } // fallback 0.10 USDC (6 decimals)
        const allowance: bigint = await erc20.allowance(owner, LOCK_ADDRESS);
        setAutoRenewPrice(price);
        setAutoRenewEnabled(allowance >= price && price > 0n);
      } catch {
        setAutoRenewEnabled(null);
      } finally {
        setAutoRenewChecking(false);
      }
    })();
  }, [authenticated]);

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
        <h2 className="text-xl font-semibold">Membership</h2>
        <p className="text-sm text-muted-foreground">
          To stop automatic renewals, you can revoke the USDC approval granted to the membership lock.
          This prevents future renewals; your current period remains active until it expires.
        </p>
        <p className="text-sm text-muted-foreground">
          Current price: {autoRenewPrice !== null ? (Number(autoRenewPrice) / 1_000_000).toFixed(2) : "Unknown"} USDC
        </p>
        <div className="text-sm">
          {autoRenewChecking ? (
            <span className="text-muted-foreground">Checking auto‑renew status…</span>
          ) : autoRenewEnabled === null ? (
            <span className="text-muted-foreground">Auto‑renew status unavailable.</span>
          ) : autoRenewEnabled ? (
            <span className="text-green-600 dark:text-green-400">Auto‑renew is enabled for the current membership price.</span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">Auto‑renew is off for the current membership price.</span>
          )}
        </div>
        <div>
          <Button
            variant="outline"
            disabled={canceling || wallets.length === 0 || autoRenewChecking || autoRenewEnabled !== true}
            onClick={async () => {
              setError(null);
              setMessage(null);
              setCanceling(true);
              try {
                if (!USDC_ADDRESS || !LOCK_ADDRESS) throw new Error("Missing contract addresses");
                const eth = (globalThis as any).ethereum;
                if (!eth) throw new Error("No wallet found in browser");
                const provider = new BrowserProvider(eth);
                const signer = await provider.getSigner();
                const owner = await signer.getAddress();
                const erc20 = new Contract(
                  USDC_ADDRESS,
                  [
                    'function allowance(address owner, address spender) view returns (uint256)',
                    'function approve(address spender, uint256 amount) returns (bool)'
                  ],
                  signer
                );
                const current: bigint = await erc20.allowance(owner, LOCK_ADDRESS);
                if (current === 0n) {
                  setMessage("Auto-renew is already disabled (no active approval).");
                  setAutoRenewEnabled(false);
                } else {
                  const tx = await erc20.approve(LOCK_ADDRESS, 0n);
                  await tx.wait();
                  setMessage("Auto-renew disabled. Future renewals will not occur.");
                  setAutoRenewEnabled(false);
                }
              } catch (e: any) {
                setError(e?.message || "Failed to update approval");
              } finally {
                setCanceling(false);
              }
            }}
          >
            {canceling ? "Disabling…" : "Stop Auto‑Renew (revoke USDC approval)"}
          </Button>
        </div>
        {!autoRenewChecking && autoRenewEnabled === false && (
          <div>
            <Button
              disabled={wallets.length === 0}
              onClick={async () => {
                setError(null);
                setMessage(null);
                try {
                  if (!USDC_ADDRESS || !LOCK_ADDRESS) throw new Error("Missing contract addresses");
                  const price = autoRenewPrice ?? 0n;
                  if (price <= 0n) throw new Error("Unknown membership price");
                  const eth = (globalThis as any).ethereum;
                  if (!eth) throw new Error("No wallet found in browser");
                  const provider = new BrowserProvider(eth);
                  const signer = await provider.getSigner();
                  const erc20 = new Contract(
                    USDC_ADDRESS,
                    [ 'function approve(address spender, uint256 amount) returns (bool)' ],
                    signer
                  );
                  const tx = await erc20.approve(LOCK_ADDRESS, price);
                  await tx.wait();
                  setMessage("Auto‑renew enabled for the current membership price.");
                  setAutoRenewEnabled(true);
                } catch (e: any) {
                  setError(e?.message || "Failed to enable auto‑renew");
                }
              }}
            >
              Enable Auto‑Renew
            </Button>
          </div>
        )}
      </div>
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
