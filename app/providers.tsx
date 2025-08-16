'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { base } from 'viem/chains';   // only import Base
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!} //Next.js only exposes environment variables prefixed with NEXT_PUBLIC_ to client-side code. 
      clientId="client-WY5i3Eq4AVaCM8ByXeo4KFZkoapWXYb1zE49czyiLaxKY"
      config={{
        loginMethods: ['wallet'],
        appearance: {
          showWalletLoginFirst: true,
          theme: 'light',
          accentColor: '#676FFF',
          walletChainType: 'ethereum-only',
          walletList: ['detected_ethereum_wallets','coinbase_wallet','metamask'], // only external detected wallets, coinbase and metamask
        },
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
