"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Contract, BrowserProvider, JsonRpcProvider } from "ethers";
import { LOCK_ADDRESS, USDC_ADDRESS, BASE_NETWORK_ID, BASE_RPC_URL } from "@/lib/config";

const MAX_AUTO_RENEW_MONTHS: number = 12;

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
  const walletAddress = (session?.user as any)?.walletAddress as string | undefined;
  const [canceling, setCanceling] = useState(false);
  const [autoRenewChecking, setAutoRenewChecking] = useState(false);
  const [autoRenewPrice, setAutoRenewPrice] = useState<bigint | null>(null);
  const [autoRenewMonths, setAutoRenewMonths] = useState<number | null>(null);
  const [enablingAutoRenew, setEnablingAutoRenew] = useState(false);
  const [membershipStatus, setMembershipStatus] = useState<'active' | 'expired' | 'none' | 'unknown'>('unknown');
  const [membershipExpiry, setMembershipExpiry] = useState<number | null>(null);
  const [membershipChecking, setMembershipChecking] = useState(false);

  const maxMonthsLabel = `${MAX_AUTO_RENEW_MONTHS} ${MAX_AUTO_RENEW_MONTHS === 1 ? "month" : "months"}`;
  const yearText = MAX_AUTO_RENEW_MONTHS === 12 ? "1 year" : null;
  const maxMonthsWithYear = yearText ? `${maxMonthsLabel} (${yearText})` : maxMonthsLabel;
  const formattedMembershipExpiry =
    typeof membershipExpiry === 'number' && membershipExpiry > 0
      ? new Date(membershipExpiry * 1000).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : null;

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

  // Load membership status/expiry for status messaging
  useEffect(() => {
    if (!authenticated) return;
    const su: any = session?.user || {};
    const addresses = (wallets && wallets.length ? wallets : walletAddress ? [walletAddress] : [])
      .map((a) => String(a).toLowerCase())
      .filter(Boolean);

    if (!addresses.length) {
      setMembershipStatus('none');
      setMembershipExpiry(null);
      setMembershipChecking(false);
      return;
    }

    if (su.membershipStatus) {
      setMembershipStatus(su.membershipStatus as 'active' | 'expired' | 'none');
      setMembershipExpiry(typeof su.membershipExpiry === 'number' ? su.membershipExpiry : null);
    }

    setMembershipChecking(true);
    (async () => {
      try {
        const resp = await fetch(`/api/membership/expiry?addresses=${encodeURIComponent(addresses.join(','))}`, { cache: 'no-store' });
        if (resp.ok) {
          const { status, expiry } = await resp.json();
          setMembershipStatus(status ?? 'none');
          setMembershipExpiry(typeof expiry === 'number' ? expiry : null);
        }
      } catch (e) {
        console.error('Membership check failed:', e);
      } finally {
        setMembershipChecking(false);
      }
    })();
  }, [authenticated, session, wallets, walletAddress]);

  // Check current USDC allowance vs. current key price to infer auto-renew readiness
  useEffect(() => {
    if (!authenticated) return;
    (async () => {
      setAutoRenewChecking(true);
      try {
        if (!USDC_ADDRESS || !LOCK_ADDRESS) throw new Error("Missing contract addresses");
        const owner = walletAddress || (wallets && wallets[0]) || null;
        if (!owner) {
          setAutoRenewPrice(null);
          setAutoRenewMonths(null);
          return;
        }
        const provider = new JsonRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
        const erc20 = new Contract(
          USDC_ADDRESS,
          [ 'function allowance(address owner, address spender) view returns (uint256)' ],
          provider
        );
        const lock = new Contract(
          LOCK_ADDRESS,
          [ 'function keyPrice() view returns (uint256)' ],
          provider
        );
        // Fetch price and allowance via read-only RPC
        let price: bigint = 0n;
        try { price = await lock.keyPrice(); } catch { price = 100000n; }
        if (price <= 0n) {
          setAutoRenewPrice(null);
          setAutoRenewMonths(null);
          return;
        }
        const allowance: bigint = await erc20.allowance(owner, LOCK_ADDRESS);
        const months = Number(allowance / price);
        setAutoRenewPrice(price);
        setAutoRenewMonths(months);
      } catch {
        setAutoRenewPrice(null);
        setAutoRenewMonths(null);
      } finally {
        setAutoRenewChecking(false);
      }
    })();
  }, [authenticated, session, wallets, walletAddress]);

  // Ensure the user's wallet is on Base before sending transactions
  const ensureBaseNetwork = async (eth: any) => {
    const targetHex = (() => {
      const n = Number(BASE_NETWORK_ID || 8453);
      return `0x${n.toString(16)}`;
    })();
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetHex }],
      });
    } catch (err: any) {
      // If chain not added, request add + switch
      const code = err?.code ?? err?.data?.originalError?.code;
      if (code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: targetHex,
              chainName: "Base",
              rpcUrls: [BASE_RPC_URL || "https://mainnet.base.org"],
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              blockExplorerUrls: ["https://basescan.org"],
            },
          ],
        });
      } else {
        throw err;
      }
    }
  };

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
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-semibold">Profile Settings</h1>
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
      <p className="text-muted-foreground text-sm">
        Manage your profile details, membership renewals, and linked wallets from one place.
      </p>
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
      <div className="space-y-6">
        <section className="rounded-lg border p-6 shadow-sm space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Profile information</h2>
            <p className="text-sm text-muted-foreground">
              Keep your contact information current so we can share community updates.
            </p>
          </div>
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
        </section>

        <section className="rounded-lg border p-6 shadow-sm space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Membership</h2>
            <p className="text-sm text-muted-foreground">
              Check your current Unlock membership status and manage auto-renewal approvals.
            </p>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Current price: {autoRenewPrice !== null ? (Number(autoRenewPrice) / 1_000_000).toFixed(2) : "Unknown"} USDC per month
            </p>
            <p>
              {membershipChecking ? (
                'Checking membership status…'
              ) : membershipStatus === 'active' ? (
                formattedMembershipExpiry
                  ? `Membership active until ${formattedMembershipExpiry}.`
                  : 'Membership is currently active.'
              ) : membershipStatus === 'expired' ? (
                formattedMembershipExpiry
                  ? `Membership expired on ${formattedMembershipExpiry}.`
                  : 'Membership has expired.'
              ) : membershipStatus === 'none' ? (
                'You do not have an active membership yet.'
              ) : (
                'Membership status unavailable.'
              )}
            </p>
            <p>
              To stop automatic renewals, revoke the USDC approval granted to the membership lock. This prevents future renewals; your current period remains active until it expires.
            </p>
          </div>
          <div className="text-sm">
            {autoRenewChecking ? (
              <span className="text-muted-foreground">Checking auto‑renew status…</span>
            ) : autoRenewMonths === null ? (
              <span className="text-muted-foreground">Auto‑renew status unavailable.</span>
            ) : autoRenewMonths > 0 ? (
              <span className={autoRenewMonths >= MAX_AUTO_RENEW_MONTHS ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}>
                {autoRenewMonths >= MAX_AUTO_RENEW_MONTHS
                  ? `Auto-renew is enabled for up to ${autoRenewMonths === 1 ? "1 month" : `${autoRenewMonths} months`} at the current price${autoRenewMonths === MAX_AUTO_RENEW_MONTHS && yearText ? ` (${yearText} maximum).` : "."}`
                  : `Auto-renew approvals cover ${autoRenewMonths === 1 ? "1 month" : `${autoRenewMonths} months`} (less than the ${MAX_AUTO_RENEW_MONTHS}-month maximum).`}
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">Auto‑renew is off for the current membership price (0 months approved).</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={canceling || wallets.length === 0 || autoRenewChecking || (autoRenewMonths ?? 0) === 0}
              onClick={async () => {
                setError(null);
                setMessage(null);
                setCanceling(true);
                try {
                  if (!USDC_ADDRESS || !LOCK_ADDRESS) throw new Error("Missing contract addresses");
                  const eth = (globalThis as any).ethereum;
                  if (!eth) throw new Error("No wallet found in browser");
                  await ensureBaseNetwork(eth);
                  const provider = new BrowserProvider(eth, Number(BASE_NETWORK_ID || 8453));
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
                    setAutoRenewMonths(0);
                  } else {
                    const tx = await erc20.approve(LOCK_ADDRESS, 0n);
                    await tx.wait();
                    setMessage("Auto-renew disabled. Future renewals will not occur.");
                    setAutoRenewMonths(0);
                  }
                } catch (e: any) {
                  setError(e?.message || "Failed to update approval");
                } finally {
                  setCanceling(false);
                }
              }}
            >
              {canceling ? "Disabling…" : "Stop Auto‑Renew"}
            </Button>
            {!autoRenewChecking && autoRenewPrice !== null && autoRenewPrice > 0n && autoRenewMonths !== null && autoRenewMonths < MAX_AUTO_RENEW_MONTHS && (
              <Button
                disabled={wallets.length === 0 || enablingAutoRenew}
                onClick={async () => {
                  setError(null);
                  setMessage(null);
                  setEnablingAutoRenew(true);
                  try {
                    if (!USDC_ADDRESS || !LOCK_ADDRESS) throw new Error("Missing contract addresses");
                    const price = autoRenewPrice ?? 0n;
                    if (price <= 0n) throw new Error("Unknown membership price");
                    const eth = (globalThis as any).ethereum;
                    if (!eth) throw new Error("No wallet found in browser");
                    await ensureBaseNetwork(eth);
                    const provider = new BrowserProvider(eth, Number(BASE_NETWORK_ID || 8453));
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
                    const desired = price * BigInt(MAX_AUTO_RENEW_MONTHS);
                    const current: bigint = await erc20.allowance(owner, LOCK_ADDRESS);
                    if (current === desired) {
                      setMessage(`Auto-renew is already approved for ${maxMonthsWithYear}.`);
                    } else {
                      const tx = await erc20.approve(LOCK_ADDRESS, desired);
                      await tx.wait();
                      setMessage((autoRenewMonths ?? 0) > 0
                        ? `Auto-renew approvals topped up to ${maxMonthsWithYear}.`
                        : `Auto-renew enabled for ${maxMonthsWithYear}.`);
                    }
                    setAutoRenewMonths(MAX_AUTO_RENEW_MONTHS);
                  } catch (e: any) {
                    setError(e?.message || "Failed to enable auto‑renew");
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
            )}
          </div>
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
              {wallets.map((w) => (
                <li key={w} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
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
        </section>
      </div>
    </div>
  );
}
