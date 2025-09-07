"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, Mail } from "lucide-react";

export default function SignInPage() {
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(() => {
    const url = searchParams?.get("callbackUrl");
    // Default to home after email verification
    return url && url.trim().length > 0 ? url : "/";
  }, [searchParams]);
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
      // Client-side validation
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

      // Persist pending profile locally so we can apply it after the magic link sign-in
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
      {(() => {
        const reason = searchParams?.get("reason");
        if (!reason) return null;
        if (reason === "wallet-unlinked") {
          return (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Wallet not linked</AlertTitle>
              <AlertDescription>
                Sign in with email to create your account, then link your wallet from the home page.
              </AlertDescription>
            </Alert>
          );
        }
        if (reason === "signup") {
          return (
            <Alert>
              <Mail className="h-4 w-4" />
              <AlertTitle>Create your account</AlertTitle>
              <AlertDescription>
                Enter your details and we’ll email a magic link to verify your address.
              </AlertDescription>
            </Alert>
          );
        }
        return null;
      })()}
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label htmlFor="firstName" className="text-sm font-medium">
              First name
            </label>
            <input
              id="firstName"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Ada"
              className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="lastName" className="text-sm font-medium">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Lovelace"
              className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="xHandle" className="text-sm font-medium">
            X handle (optional)
          </label>
          <input
            id="xHandle"
            type="text"
            value={xHandle}
            onChange={(e) => setXHandle(e.target.value)}
            placeholder="@handle"
            className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="linkedin" className="text-sm font-medium">
            LinkedIn URL (optional)
          </label>
          <input
            id="linkedin"
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://www.linkedin.com/in/username"
            className="w-full rounded-md border px-3 py-2 text-sm dark:bg-input/30 dark:border-input"
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Send magic link"}
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
