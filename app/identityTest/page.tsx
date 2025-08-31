"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";

type IdentitySuccess = {
  userId: string;
  user: unknown;
  claims: unknown;
};

type IdentityResponse = IdentitySuccess | { error: string };

export default function IdentityTestPage() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const [data, setData] = useState<IdentityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIdentity = async () => {
    try {
      setLoading(true);
      setError(null);
      setData(null);
      const token = await getAccessToken();
      const res = await fetch("/api/identityTest", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
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
        <Button onClick={login}>Login</Button>
      ) : (
        <div className="space-x-2">
          <Button onClick={fetchIdentity} disabled={loading}>
            {loading ? "Verifying…" : "Verify Identity"}
          </Button>
          <Button variant="outline" onClick={logout}>
            Log Out
          </Button>
        </div>
      )}

      {error && <pre className="text-red-600">{error}</pre>}
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
