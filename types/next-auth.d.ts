import NextAuth from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      walletAddress?: string | null;
    };
  }

  interface User {
    id: string;
    email?: string | null;
    walletAddress?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    email?: string | null;
    walletAddress?: string | null;
  }
}

