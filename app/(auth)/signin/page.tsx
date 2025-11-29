"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, Mail, Wallet, CheckCircle2 } from "lucide-react";
import { signInWithSiwe } from "@/lib/siwe/client";

export default function SignInPage() {
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(() => {
    const url = searchParams?.get("callbackUrl");
    return url && url.trim().length > 0 ? url : "/";
  }, [searchParams]);
  const reason = searchParams?.get("reason") || null;

  if (reason === "signup") {
    return <SignupFlow callbackUrl={callbackUrl} />;
  }
  if (reason === "email-updated") {
    return <WalletReauth callbackUrl={callbackUrl} />;
  }

  return <LegacyEmailSignIn callbackUrl={callbackUrl} reason={reason} />;
}

function WalletReauth({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);

  const handleWalletSignIn = async () => {
    setWalletError(null);
    setWalletLoading(true);
    try {
      const res = await signInWithSiwe();
      if (res.ok) {
        // Force a full reload so the new session cookies are applied immediately.
        window.location.href = callbackUrl;
        return;
      }
      const err = res.error || "Failed to sign in with wallet";
      setWalletError(err);
    } catch (e: any) {
      setWalletError(e?.message || "Failed to sign in with wallet");
    } finally {
      setWalletLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Reconnect your wallet</h1>
      <Alert>
        <Mail className="h-4 w-4" />
        <AlertTitle>Email updated</AlertTitle>
        <AlertDescription>
          Your email was updated successfully. To continue, sign back in with your linked wallet.
        </AlertDescription>
      </Alert>
      <div className="space-y-3">
        <Button className="w-full" onClick={handleWalletSignIn} disabled={walletLoading}>
          {walletLoading ? "Connecting wallet…" : (
            <>
              <Wallet className="mr-2 h-4 w-4" /> Sign in with wallet
            </>
          )}
        </Button>
        {walletError && <p className="text-sm text-red-600 dark:text-red-400">{walletError}</p>}
        <p className="text-xs text-muted-foreground">
          If your wallet is already linked, this will sign you back in immediately.
        </p>
      </div>
    </div>
  );
}

function SignupFlow({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"wallet" | "email" | "sent">("wallet");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      const res = await signInWithSiwe();
      if (res.ok) {
        // Wallet already linked and user signed in.
        router.push(callbackUrl);
        return;
      }
      const err = res.error || "Failed to connect wallet";
      if (err.toLowerCase().includes("wallet not linked")) {
        if (res.address) {
          setWalletAddress(res.address);
          setStep("email");
          return;
        }
        // If SIWE didn't return the address, treat as error.
        setConnectError("Could not determine wallet address. Please try again.");
        return;
      }
      setConnectError(err);
    } catch (e: any) {
      setConnectError(e?.message || "Failed to connect wallet");
    } finally {
      setConnectLoading(false);
    }
  };

  const onSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setEmailSubmitting(true);
    try {
      if (!/.+@.+\..+/.test(email)) throw new Error("Enter a valid email address");
      if (!walletAddress) throw new Error("Wallet address missing. Please reconnect.");
      const pendingRes = await fetch("/api/signup/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, wallet: walletAddress }),
      });
      if (!pendingRes.ok) {
        let detail: any = undefined;
        try { detail = await pendingRes.json(); } catch {}
        throw new Error(detail?.error || "Failed to save signup state");
      }
      try {
        localStorage.removeItem("pendingProfile");
      } catch {}
      const res = await signIn("email", { email, callbackUrl, redirect: false });
      if (res?.ok) {
        setSubmittedEmail(email);
        setStep("sent");
      } else {
        throw new Error(res?.error || "Failed to send verification email");
      }
    } catch (err: any) {
      setEmailError(err?.message || "Failed to send verification email");
    } finally {
      setEmailSubmitting(false);
    }
  };

  const resetFlow = () => {
    setStep("wallet");
    setWalletAddress(null);
    setEmail("");
    setSubmittedEmail(null);
    setEmailError(null);
    setConnectError(null);
  };

  return (
    <div className="mx-auto max-w-md p-6 space-y-6 text-center">
      <h1 className="text-3xl font-semibold">Welcome</h1>
      <p className="text-muted-foreground">
        Join our community by connecting your wallet and email
      </p>

      {step === "wallet" && (
        <div className="rounded-2xl border p-6 space-y-5 bg-card text-left">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Wallet className="h-5 w-5" /> Connect Your Wallet
          </div>
          <p className="text-sm text-muted-foreground">
            Connect your Ethereum wallet to sign up. This will trigger a Sign-in-with-Ethereum (SIWE) signature request.
          </p>
          {connectError && (
            <Alert variant="destructive">
              <AlertTitle>Unable to connect</AlertTitle>
              <AlertDescription>{connectError}</AlertDescription>
            </Alert>
          )}
          <Button className="w-full" onClick={handleConnect} disabled={connectLoading}>
            {connectLoading ? "Connecting…" : (
              <>
                <Wallet className="mr-2 h-4 w-4" /> Connect Wallet
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Don&apos;t have MetaMask?{' '}
            <Link href="https://metamask.io/download/" className="underline hover:text-foreground" target="_blank" rel="noreferrer">
              Download here
            </Link>
          </p>
        </div>
      )}

      {step === "email" && (
        <div className="rounded-2xl border p-6 space-y-5 bg-card text-left">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Mail className="h-5 w-5" /> Enter Your Email
          </div>
          <p className="text-sm text-muted-foreground">
            We&apos;ll send you a verification link to complete your sign-up.
          </p>
          <div className="rounded-md border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900 dark:text-emerald-200 dark:bg-emerald-500/10">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5" />
              <div>
                <div className="font-medium">Wallet connected</div>
                <div className="font-mono text-xs break-all">{walletAddress}</div>
              </div>
            </div>
          </div>
          <form onSubmit={onSubmitEmail} className="space-y-3">
            <div className="space-y-2">
              <label htmlFor="signup-email" className="text-sm font-medium">Email Address</label>
              <input
                id="signup-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input"
              />
            </div>
            {emailError && (
              <p className="text-sm text-red-600 dark:text-red-400">{emailError}</p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setStep("wallet")}
                disabled={emailSubmitting}
              >
                Back
              </Button>
              <Button type="submit" className="w-full" disabled={emailSubmitting}>
                {emailSubmitting ? "Sending…" : "Continue"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {step === "sent" && (
        <div className="rounded-2xl border p-6 space-y-5 bg-card text-left">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Check Your Email
          </div>
          <p className="text-sm text-muted-foreground">
            We&apos;ve sent a verification link to complete your sign-up.
          </p>
          <div className="rounded-md border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900 dark:text-emerald-200 dark:bg-emerald-500/10 space-y-1">
            <div className="font-medium">What happens next:</div>
            <ol className="list-decimal pl-4 space-y-1">
              <li>Check your email for a verification link</li>
              <li>Click the link to verify your email</li>
              <li>Your account will be fully activated</li>
              <li>Future sign-ins will only require your wallet</li>
            </ol>
          </div>
          <div className="space-y-1 text-sm">
            {submittedEmail && (
              <div>
                <span className="font-medium">Email:</span> {submittedEmail}
              </div>
            )}
            {walletAddress && (
              <div className="font-mono text-xs break-all">
                <span className="font-medium not-italic">Wallet:</span> {walletAddress}
              </div>
            )}
          </div>
          <Button variant="outline" className="w-full" onClick={resetFlow}>
            Sign Up Another Account
          </Button>
        </div>
      )}
    </div>
  );
}

function LegacyEmailSignIn({ callbackUrl, reason }: { callbackUrl: string; reason: string | null }) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const emailOk = /.+@.+\..+/.test(email);
      if (!emailOk) throw new Error("Enter a valid email address");
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
      const pending = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        xHandle: xHandle.trim(),
        linkedinUrl: linkedinUrl.trim(),
      };
      try {
        localStorage.setItem("pendingProfile", JSON.stringify(pending));
      } catch {}

      const res = await signIn("email", { email, callbackUrl, redirect: false });
      if (res?.ok) {
        setMessage("Check your email for a sign-in link.");
      } else {
        setError(res?.error || "Failed to start email sign-in");
      }
    } catch (e: any) {
      setError(e?.message || "Unexpected error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {reason === "wallet-unlinked" && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Wallet not linked</AlertTitle>
          <AlertDescription>
            Sign in with email to create your account, then link your wallet from the home page.
          </AlertDescription>
        </Alert>
      )}
      {reason && reason !== "wallet-unlinked" && (
        <Alert>
          <Mail className="h-4 w-4" />
          {isEmailUpdate ? (
            <>
              <AlertTitle>Email updated</AlertTitle>
              <AlertDescription>
                Your email was updated successfully. Sign in with the new address below.
              </AlertDescription>
            </>
          ) : (
            <>
              <AlertTitle>Create your account</AlertTitle>
              <AlertDescription>
                Enter your details and we’ll email a magic link to verify your address.
              </AlertDescription>
            </>
          )}
        </Alert>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        {!isEmailUpdate && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label htmlFor="legacy-firstName" className="text-sm font-medium">
                First name
              </label>
              <input
                id="legacy-firstName"
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Ada"
                className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="legacy-lastName" className="text-sm font-medium">
                Last name
              </label>
              <input
                id="legacy-lastName"
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Lovelace"
                className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input"
              />
            </div>
          </div>
        )}
        <div className="space-y-2">
          <label htmlFor="legacy-email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="legacy-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input"
          />
        </div>
        {!isEmailUpdate && (
          <>
            <div className="space-y-2">
              <label htmlFor="legacy-xHandle" className="text-sm font-medium">
                X handle (optional)
              </label>
              <input
                id="legacy-xHandle"
                type="text"
                value={xHandle}
                onChange={(e) => setXHandle(e.target.value)}
                placeholder="@handle"
                className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="legacy-linkedin" className="text-sm font-medium">
                LinkedIn URL (optional)
              </label>
              <input
                id="legacy-linkedin"
                type="url"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://www.linkedin.com/in/username"
                className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input"
              />
            </div>
          </>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Sending…" : isEmailUpdate ? "Send sign-in link" : "Send magic link"}
        </Button>
      </form>
      {message && (
        <Alert>
          <AlertTitle>Check your inbox</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
