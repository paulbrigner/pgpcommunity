import NextAuth from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      xHandle?: string | null;
      linkedinUrl?: string | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      walletAddress?: string | null;
      wallets?: string[] | null;
      membershipStatus?: 'active' | 'expired' | 'none' | null;
      membershipExpiry?: number | null;
      membershipSummary?: any;
      membershipHighestTier?: string | null;
      isAdmin?: boolean | null;
      welcomeEmailSentAt?: string | null;
      lastEmailSentAt?: string | null;
      lastEmailType?: string | null;
      emailBounceReason?: string | null;
      emailSuppressed?: boolean | null;
    };
  }

  interface User {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    xHandle?: string | null;
    linkedinUrl?: string | null;
    email?: string | null;
    walletAddress?: string | null;
    wallets?: string[] | null;
    isAdmin?: boolean | null;
    welcomeEmailSentAt?: string | null;
    lastEmailSentAt?: string | null;
    lastEmailType?: string | null;
    emailBounceReason?: string | null;
    emailSuppressed?: boolean | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    email?: string | null;
    walletAddress?: string | null;
    membershipStatus?: 'active' | 'expired' | 'none' | null;
    membershipExpiry?: number | null;
    membershipHighestTier?: string | null;
    isAdmin?: boolean | null;
  }
}
