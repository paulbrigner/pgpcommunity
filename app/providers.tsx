"use client";

import { PrivyProvider } from '@privy-io/react-auth';
import { base } from 'viem/chains';   // only import Base
import { ReactNode, useEffect, useState } from 'react';
import {
  PRIVY_APP_ID,
  PRIVY_CLIENT_ID
} from '@/lib/config'; // Environment-specific constants


export function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Dev-only: filter noisy DOM nesting warnings from third-party UI during auth modal
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const originalError = console.error;
    console.error = (...args: any[]) => {
      try {
        const msg = args?.[0];
        if (
          typeof msg === 'string' &&
          (msg.includes('cannot be a descendant of') ||
            msg.includes('cannot contain a nested') ||
            msg.includes('validateDOMNesting'))
        ) {
          return; // swallow specific noisy warnings
        }
      } catch {}
      originalError(...args);
    };
    return () => {
      console.error = originalError;
    };
  }, []);
  if (!mounted) return null; // avoid SSR/rehydration mismatches
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID!}
      clientId={PRIVY_CLIENT_ID!}
      config={{
        loginMethods: ['email'],
        appearance: {
          showWalletLoginFirst: false,
          theme: 'light',
          accentColor: '#676FFF',
          walletChainType: 'ethereum-only',
          walletList: ['detected_ethereum_wallets','coinbase_wallet','metamask'], // only external detected wallets, coinbase, and metamask
        },
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
