import './globals.css';
import { Providers } from './providers';
import { MainNav } from '@/components/site/main-nav';

export const metadata = {
  title: 'PGP for Crypto Community',
  description: 'A token-gated community application.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <Providers>
          <MainNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
