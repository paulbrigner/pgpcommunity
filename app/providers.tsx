'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { base } from 'viem/chains';   // only import Base
import { ReactNode } from 'react';
import {
  PRIVY_APP_ID,
  PRIVY_CLIENT_ID
} from '@/lib/config'; // Environment-specific constants


export function Providers({ children }: { children: ReactNode }) {
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
