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
      autoRenewPreference?: 'enabled' | 'skipped' | null;
      membershipStatus?: 'active' | 'expired' | 'none' | null;
      membershipExpiry?: number | null;
      membershipSummary?: any;
      membershipHighestTier?: string | null;
      currentMembershipTierId?: string | null;
      lastMembershipTierId?: string | null;
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
    autoRenewPreference?: 'enabled' | 'skipped' | null;
    currentMembershipTierId?: string | null;
    lastMembershipTierId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    email?: string | null;
    walletAddress?: string | null;
    autoRenewPreference?: 'enabled' | 'skipped' | null;
    membershipStatus?: 'active' | 'expired' | 'none' | null;
    membershipExpiry?: number | null;
    membershipHighestTier?: string | null;
    currentMembershipTierId?: string | null;
    lastMembershipTierId?: string | null;
  }
}
