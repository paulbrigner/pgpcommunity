import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/email";
import { SiweMessage } from "siwe";
import { DynamoDBAdapter } from "@next-auth/dynamodb-adapter";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import {
  AWS_REGION,
  NEXTAUTH_SECRET,
  NEXTAUTH_TABLE,
  NEXTAUTH_URL,
  EMAIL_SERVER,
  EMAIL_FROM,
  EMAIL_SERVER_HOST,
  EMAIL_SERVER_PORT,
  EMAIL_SERVER_USER,
  EMAIL_SERVER_PASSWORD,
  EMAIL_SERVER_SECURE,
} from "@/lib/config";

// Ensure NextAuth sees a base URL for callbacks (used by Email provider)
if (!process.env.NEXTAUTH_URL && NEXTAUTH_URL) {
  process.env.NEXTAUTH_URL = NEXTAUTH_URL;
}

const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const documentClient = DynamoDBDocument.from(dynamoClient);

const authOptions = {
  adapter: DynamoDBAdapter(documentClient as any, {
    tableName: NEXTAUTH_TABLE || "NextAuth",
  }),
  session: { strategy: "jwt" as const },
  providers: [
    EmailProvider({
      // Build a robust Nodemailer config from env
      server: (() => {
        // Preferred: discrete vars
        if (EMAIL_SERVER_HOST) {
          return {
            host: EMAIL_SERVER_HOST,
            port: EMAIL_SERVER_PORT ? Number(EMAIL_SERVER_PORT) : 587,
            secure: EMAIL_SERVER_SECURE === "true",
            auth:
              EMAIL_SERVER_USER && EMAIL_SERVER_PASSWORD
                ? { user: EMAIL_SERVER_USER, pass: EMAIL_SERVER_PASSWORD }
                : undefined,
          } as any;
        }
        // If URL provided and looks like a URL, pass through
        if (EMAIL_SERVER && EMAIL_SERVER.includes("://")) return EMAIL_SERVER as any;
        // If a bare host string provided, try to combine with discrete creds
        if (EMAIL_SERVER) {
          if (!EMAIL_SERVER_USER || !EMAIL_SERVER_PASSWORD) {
            console.error(
              "EMAIL_SERVER is a host string but EMAIL_SERVER_USER/EMAIL_SERVER_PASSWORD are missing; email sending will fail."
            );
          }
          return {
            host: EMAIL_SERVER,
            port: EMAIL_SERVER_PORT ? Number(EMAIL_SERVER_PORT) : 587,
            secure: EMAIL_SERVER_SECURE === "true",
            auth:
              EMAIL_SERVER_USER && EMAIL_SERVER_PASSWORD
                ? { user: EMAIL_SERVER_USER, pass: EMAIL_SERVER_PASSWORD }
                : undefined,
          } as any;
        }
        // Fall back to undefined; NextAuth will error clearly if misconfigured
        return undefined as any;
      })(),
      from: EMAIL_FROM,
    }),
    CredentialsProvider({
      name: "Ethereum",
      credentials: {
        message: { label: "Message", type: "text" },
        signature: { label: "Signature", type: "text" },
      },
      async authorize(credentials, req) {
        try {
          if (!credentials?.message || !credentials?.signature) return null;
          const siwe = new SiweMessage(JSON.parse(credentials.message));

          // Use the host as the expected domain
          const host = (req as any)?.headers?.host || NEXTAUTH_URL || "localhost";
          const domain = (typeof host === "string" ? host : String(host)).replace(/^https?:\/\//, "");
          // Use NextAuth's CSRF token cookie for the SIWE nonce
          const rawCsrf = (req as any)?.cookies?.["next-auth.csrf-token"] || (req as any)?.cookies?.get?.("next-auth.csrf-token")?.value;
          const csrfToken = typeof rawCsrf === "string" ? rawCsrf.split("|")[0] : undefined;

          const result = await siwe.verify({
            signature: credentials.signature,
            domain,
            nonce: csrfToken ?? siwe.nonce,
          });

          if (result.success) {
            const address = siwe.address.toLowerCase();
            // Only allow sign-in if this address is already linked to a user
            const adapter: any = DynamoDBAdapter(documentClient as any, {
              tableName: NEXTAUTH_TABLE || "NextAuth",
            });
            const existingUser = await adapter.getUserByAccount({
              provider: "ethereum",
              providerAccountId: address,
            });
            if (!existingUser?.id) {
              // Reject sign-in for unlinked wallet
              throw new Error(
                "Wallet not linked. Sign in with email first, then link your wallet."
              );
            }
            // Return minimal user plus walletAddress to land in JWT
            return { id: existingUser.id, email: existingUser.email, walletAddress: address } as any;
          }
          return null;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Only log unexpected errors; the unlinked wallet case is expected UX
          if (!msg?.includes("Wallet not linked")) {
            console.error("SIWE authorize error:", e);
          }
          // Propagate error so NextAuth can surface a meaningful message to the client
          throw e instanceof Error ? e : new Error("SIWE authorize failed");
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }: any) {
      if (user?.walletAddress) token.walletAddress = user.walletAddress;
      if (user?.email) token.email = user.email;
      return token;
    },
    async session({ session, token }: any) {
      session.user = session.user || {} as any;
      (session.user as any).email = token.email || null;
      // Expose user id (token.sub) for linking wallets later
      (session.user as any).id = token?.sub ?? null;
      // Load denormalized wallets array from the User record, if present
      try {
        if (token?.sub) {
          const adapter: any = DynamoDBAdapter(documentClient as any, {
            tableName: NEXTAUTH_TABLE || "NextAuth",
          });
          const userRecord = await adapter.getUser(token.sub);
          const wallets = Array.isArray((userRecord as any)?.wallets)
            ? ((userRecord as any).wallets as string[])
            : [];
          (session.user as any).wallets = wallets;
          // Populate walletAddress from token if present, otherwise first linked wallet
          (session.user as any).walletAddress = token.walletAddress || wallets[0] || null;
          // Populate profile fields
          (session.user as any).firstName = (userRecord as any)?.firstName ?? null;
          (session.user as any).lastName = (userRecord as any)?.lastName ?? null;
          (session.user as any).xHandle = (userRecord as any)?.xHandle ?? null;
          (session.user as any).linkedinUrl = (userRecord as any)?.linkedinUrl ?? null;
          // Derive display name if not set
          if (!(session.user as any).name && (userRecord as any)?.firstName) {
            const fn = (userRecord as any).firstName as string;
            const ln = ((userRecord as any)?.lastName as string | undefined) || "";
            (session.user as any).name = `${fn}${ln ? ` ${ln}` : ""}`;
          }
        } else {
          (session.user as any).wallets = [];
          (session.user as any).walletAddress = token.walletAddress || null;
        }
      } catch (e) {
        console.error("session callback: failed to load wallets", e);
        (session.user as any).wallets = [];
        (session.user as any).walletAddress = token.walletAddress || null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  // Set to "nodejs" runtime implicitly by API route defaults
  // Make sure to set NEXTAUTH_SECRET in production
  secret: NEXTAUTH_SECRET,
} as const;

const handler = NextAuth(authOptions as any);
export { handler as GET, handler as POST };
