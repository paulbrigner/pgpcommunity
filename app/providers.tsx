"use client";

import { ReactNode, useEffect, useState } from "react";
import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null; // avoid SSR/rehydration mismatches
  return <SessionProvider>{children}</SessionProvider>;
}
