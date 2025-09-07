"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { linkWalletWithSiwe } from "@/lib/siwe/client";
import { useSession } from "next-auth/react";

type Props = {
  className?: string;
  onLinked?: () => void;
  onError?: (message: string) => void;
  label?: string;
};

export function LinkWalletButton({ className, onLinked, onError, label }: Props) {
  const { update } = useSession();
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    setLoading(true);
    try {
      const res = await linkWalletWithSiwe();
      if (!res.ok) {
        onError?.(res.error || "Linking failed");
        return;
      }
      try { await update({}); } catch {}
      onLinked?.();
    } catch (e: any) {
      onError?.(e?.message || "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={onClick} disabled={loading} className={className}>
      {loading ? "Linking…" : label ?? "Link Wallet"}
    </Button>
  );
}

