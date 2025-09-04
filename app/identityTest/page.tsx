"use client";

import { useEffect, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { signInWithSiwe } from "@/lib/siwe/client";

type IdentitySuccess = {
  userId: string;
  user: unknown;
  claims: unknown;
};

type IdentityResponse = IdentitySuccess | { error: string };

export default function IdentityTestPage() {
  const { data: session, status } = useSession();
  const ready = status !== "loading";
  const authenticated = status === "authenticated";
  const [data, setData] = useState<IdentityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIdentity = async () => {
    try {
      setLoading(true);
      setError(null);
      setData(null);
      const res = await fetch("/api/identityTest", { cache: "no-store" });
      const json = (await res.json()) as IdentityResponse;
      if (!res.ok) {
        const msg = (json as { error?: string }).error || "Unauthorized";
        throw new Error(msg);
      }
      setData(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ready && authenticated) {
      void fetchIdentity();
    }
  }, [ready, authenticated]);

  return (
    <div className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Identity Test</h1>
      <p>
        Status: {ready ? (authenticated ? "Authenticated" : "Unauthenticated") : "Initializing..."}
      </p>

      {!authenticated ? (
        <Button
          onClick={async () => {
            const res = await signInWithSiwe();
            if (!res.ok) console.error(res.error || "SIWE sign-in failed");
          }}
        >
          Login with Wallet
        </Button>
      ) : (
        <div className="space-x-2">
          <Button onClick={fetchIdentity} disabled={loading}>
            {loading ? "Verifying…" : "Verify Identity"}
          </Button>
          <Button variant="outline" onClick={() => signOut()}>
            Log Out
          </Button>
        </div>
      )}

      {error && <pre className="text-red-600">{error}</pre>}
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
