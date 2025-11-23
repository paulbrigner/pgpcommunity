import "./globals.css";
import { Providers } from "./providers";
import { MainNav } from "@/components/site/main-nav";
import { Inter } from "next/font/google";

export const metadata = {
  title: "PGP for Crypto Community",
  description: "A token-gated community application.",
};

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`} data-scroll-behavior="smooth">
      <body className="font-sans min-h-screen bg-background text-foreground">
        <Providers>
          <MainNav />
          <main className="relative min-h-[calc(100vh-3.5rem)] bg-[var(--brand-ice)] pb-16 pt-8">
            <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-[radial-gradient(circle_at_18%_22%,rgba(67,119,243,0.24),transparent_55%),radial-gradient(circle_at_80%_-10%,rgba(193,197,226,0.35),transparent_45%)] blur-3xl" />
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
