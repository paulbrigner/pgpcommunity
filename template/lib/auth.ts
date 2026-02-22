import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const allowedDomain = (process.env.ALLOWED_GOOGLE_DOMAIN || "zodl.com").toLowerCase();
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

if (!googleClientId) {
  console.warn("[auth] GOOGLE_CLIENT_ID is missing.");
}

if (!googleClientSecret) {
  console.warn("[auth] GOOGLE_CLIENT_SECRET is missing.");
} else if (!googleClientSecret.startsWith("GOCSPX-")) {
  console.warn(
    "[auth] GOOGLE_CLIENT_SECRET has an unexpected prefix. For Google OAuth web clients it usually starts with GOCSPX-."
  );
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  debug: process.env.NODE_ENV !== "production",
  providers: [
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      authorization: {
        params: {
          hd: allowedDomain,
          prompt: "select_account",
          scope: "openid email profile",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;

      const email = typeof profile?.email === "string" ? profile.email.toLowerCase() : "";
      const emailVerified = (profile as { email_verified?: unknown } | undefined)?.email_verified === true;

      return emailVerified && email.endsWith(`@${allowedDomain}`);
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email || null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  logger: {
    error(code, metadata) {
      console.error("[next-auth][error]", code, metadata);
    },
    warn(code) {
      console.warn("[next-auth][warn]", code);
    },
    debug(code, metadata) {
      if (process.env.NODE_ENV !== "production") {
        console.debug("[next-auth][debug]", code, metadata);
      }
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
