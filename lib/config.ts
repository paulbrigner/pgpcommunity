// Helper to read Amplify (Gen 2) secrets when running on AWS
// Falls back to process.env when not available (e.g., local dev)
function fromAmplifySecret(name: string): string | undefined {
  try {
    // Use eval to avoid bundlers trying to include server-only modules in client builds
    // eslint-disable-next-line no-eval
    const req: any = (eval as any)("require");
    if (!req) return undefined;
    const backend = req("@aws-amplify/backend");
    if (!backend?.secret) return undefined;
    const secretRef = backend.secret(name);
    const value = secretRef?.value ?? (typeof secretRef === "string" ? secretRef : undefined);
    if (typeof value === "string" && value.length > 0) return value;
  } catch (_) {
    // Swallow errors; simply fall back to env below
  }
  return undefined;
}

// Public (client + server) values
export const UNLOCK_ADDRESS = process.env.NEXT_PUBLIC_UNLOCK_ADDRESS as string;
export const LOCK_ADDRESS = process.env.NEXT_PUBLIC_LOCK_ADDRESS as string;
export const BASE_NETWORK_ID = Number(process.env.NEXT_PUBLIC_BASE_NETWORK_ID);
export const BASE_RPC_URL = process.env.NEXT_PUBLIC_BASE_RPC_URL as string;
export const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as string;
export const PRIVATE_KEY_SECRET_ARN = process.env.NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN as string;
export const CLOUDFRONT_DOMAIN = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN as string;
export const KEY_PAIR_ID = process.env.NEXT_PUBLIC_KEY_PAIR_ID as string;
export const AWS_REGION = process.env.NEXT_PUBLIC_AWS_REGION as string;

// Server-only values: prefer Amplify secrets, fall back to current env approach for local dev
export const NEXTAUTH_URL = (
  fromAmplifySecret("NEXTAUTH_URL") ||
  process.env.NEXTAUTH_URL
) as string;

export const NEXTAUTH_SECRET = (
  fromAmplifySecret("NEXTAUTH_SECRET") ||
  process.env.NEXTAUTH_SECRET
) as string;

export const NEXTAUTH_TABLE = (
  fromAmplifySecret("NEXTAUTH_TABLE") ||
  process.env.NEXTAUTH_TABLE
) as string;

export const EMAIL_SERVER = (
  fromAmplifySecret("EMAIL_SERVER") || process.env.EMAIL_SERVER
) as string;
export const EMAIL_FROM = (
  fromAmplifySecret("EMAIL_FROM") || process.env.EMAIL_FROM
) as string;
export const EMAIL_SERVER_HOST = (
  fromAmplifySecret("EMAIL_SERVER_HOST") || process.env.EMAIL_SERVER_HOST
) as string | undefined;
export const EMAIL_SERVER_PORT = (
  fromAmplifySecret("EMAIL_SERVER_PORT") || process.env.EMAIL_SERVER_PORT
) as string | undefined;
export const EMAIL_SERVER_USER = (
  fromAmplifySecret("EMAIL_SERVER_USER") || process.env.EMAIL_SERVER_USER
) as string | undefined;
export const EMAIL_SERVER_PASSWORD = (
  fromAmplifySecret("EMAIL_SERVER_PASSWORD") || process.env.EMAIL_SERVER_PASSWORD
) as string | undefined;
export const EMAIL_SERVER_SECURE = (
  fromAmplifySecret("EMAIL_SERVER_SECURE") || process.env.EMAIL_SERVER_SECURE
) as string | undefined;
