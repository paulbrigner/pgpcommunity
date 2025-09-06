// Server-only configuration (Amplify Gen 2 secrets + private env)
// Reads from $amplify/env/server when available in Amplify Hosting Gen 2
// Falls back to process.env for local development.

let serverEnv: Record<string, string | undefined> | undefined;
try {
  // Use require at runtime so bundlers don’t try to include it on client
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  serverEnv = require("$amplify/env/server").env as Record<string, string | undefined>;
} catch (_) {
  serverEnv = undefined;
}

const fromServer = (k: string) => serverEnv?.[k] ?? process.env[k];

// NextAuth
export const NEXTAUTH_URL = fromServer("NEXTAUTH_URL") as string;
export const NEXTAUTH_SECRET = fromServer("NEXTAUTH_SECRET") as string;
export const NEXTAUTH_TABLE = fromServer("NEXTAUTH_TABLE") as string;

// Email (SMTP / SES)
export const EMAIL_SERVER = fromServer("EMAIL_SERVER") as string | undefined;
export const EMAIL_FROM = fromServer("EMAIL_FROM") as string | undefined;
export const EMAIL_SERVER_HOST = fromServer("EMAIL_SERVER_HOST") as string | undefined;
export const EMAIL_SERVER_PORT = fromServer("EMAIL_SERVER_PORT") as string | undefined;
export const EMAIL_SERVER_USER = fromServer("EMAIL_SERVER_USER") as string | undefined;
export const EMAIL_SERVER_PASSWORD = fromServer("EMAIL_SERVER_PASSWORD") as string | undefined;
export const EMAIL_SERVER_SECURE = fromServer("EMAIL_SERVER_SECURE") as string | undefined;

// Optional: fail fast in production if critical secrets are missing
if (process.env.NODE_ENV === "production") {
  if (!NEXTAUTH_SECRET) {
    // Throwing here surfaces a clear configuration error early
    throw new Error("NEXTAUTH_SECRET is not set. Configure it in Amplify secrets or env.");
  }
}

