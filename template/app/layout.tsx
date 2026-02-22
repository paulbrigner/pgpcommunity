import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hello World Template",
  description: "A minimal Next.js template for AWS Amplify deployments.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
