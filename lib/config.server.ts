// Server-only configuration (Amplify Gen 2 secrets + private env)
// Reads from $amplify/env/server when available in Amplify Hosting Gen 2
// Falls back to process.env for local development.
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";


let serverEnv: Record<string, string | undefined> | undefined;
try {
  // Use eval('require') so bundlers do not statically resolve the module at build time
  // eslint-disable-next-line no-eval
  const req: any = (eval as any)("require");

  const extractEnv = (m: any): Record<string, string | undefined> | undefined => {
    if (!m) return undefined;
    if (m.env && typeof m.env === "object") return m.env as Record<string, string | undefined>;
    if (m.default?.env && typeof m.default.env === "object") return m.default.env as Record<string, string | undefined>;
    if (typeof m === "object") return m as Record<string, string | undefined>;
    return undefined;
  };

  const modServer = (() => {
    try { return req("$amplify/env/server"); } catch { return undefined; }
  })();
  const modBase = (() => {
    try { return req("$amplify/env"); } catch { return undefined; }
  })();

  const envServer = extractEnv(modServer) || {};
  const envBase = extractEnv(modBase) || {};
  const merged = { ...envBase, ...envServer };
  serverEnv = Object.keys(merged).length ? merged : undefined;
} catch (_) {
  serverEnv = undefined;
}

const getSecretFromSSM = async (paramName: string): Promise<string | undefined> => {
  try {
    const ssm = new SSMClient({ region: "us-east-1" });
    const response = await ssm.send(
      new GetParameterCommand({
        Name: `/amplify/${process.env.AMPLIFY_APP_ID}/${paramName}`,
        WithDecryption: true,
      })
    );
    return response.Parameter?.Value;
  } catch (e) {
    console.error(`Failed to fetch ${paramName}:`, e);
    return undefined;
  }
};

const fromServer = (k: string) => {
  const fromEnv = process.env[k];
  if (fromEnv) return fromEnv;

  // Fallback to SSM if secret isn't in env
  return getSecretFromSSM(k).then((val) => val || "");
};

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

// Server-side access to public values as well (prefer process.env at runtime)
export const AWS_REGION = fromServer("NEXT_PUBLIC_AWS_REGION") as string | undefined;
export const PRIVATE_KEY_SECRET_ARN = fromServer("NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN") as string | undefined;
export const CLOUDFRONT_DOMAIN = fromServer("NEXT_PUBLIC_CLOUDFRONT_DOMAIN") as string | undefined;
export const KEY_PAIR_ID = fromServer("NEXT_PUBLIC_KEY_PAIR_ID") as string | undefined;

// Note: Do not throw at module import time if secrets are missing.
// In Amplify Gen 2, secrets may not be present during build-time.
// Route handlers should handle missing secrets at runtime if needed.
