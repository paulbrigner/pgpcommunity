import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { SiweMessage } from "siwe";
import { DynamoDBAdapter } from "@next-auth/dynamodb-adapter";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { AWS_REGION, NEXTAUTH_SECRET, NEXTAUTH_TABLE, NEXTAUTH_URL } from "@/lib/config";

const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const documentClient = DynamoDBDocument.from(dynamoClient);

const authOptions = {
  adapter: DynamoDBAdapter(documentClient as any, {
    tableName: NEXTAUTH_TABLE || "NextAuth",
  }),
  session: { strategy: "jwt" as const },
  providers: [
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
            return {
              id: address,
              walletAddress: address,
            } as any;
          }
          return null;
        } catch (e) {
          console.error("SIWE authorize error:", e);
          return null;
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
      (session.user as any).walletAddress = token.walletAddress || null;
      (session.user as any).email = token.email || null;
      return session;
    },
  },
  // Set to "nodejs" runtime implicitly by API route defaults
  // Make sure to set NEXTAUTH_SECRET in production
  secret: NEXTAUTH_SECRET,
} as const;

const handler = NextAuth(authOptions as any);
export { handler as GET, handler as POST };
