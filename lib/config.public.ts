// Client-safe (public) configuration
// Reads from $amplify/env/client when available in Amplify Hosting Gen 2
// Falls back to process.env for local development.

let clientEnv: Record<string, string | undefined> | undefined;
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

  const modClient = (() => {
    try { return req("$amplify/env/client"); } catch { return undefined; }
  })();
  const modBase = (() => {
    try { return req("$amplify/env"); } catch { return undefined; }
  })();

  const envClient = extractEnv(modClient) || {};
  const envBase = extractEnv(modBase) || {};
  const merged = { ...envBase, ...envClient };
  clientEnv = Object.keys(merged).length ? merged : undefined;
} catch (_) {
  clientEnv = undefined;
}

const fromClient = (k: string) => clientEnv?.[k] ?? process.env[k];

export const UNLOCK_ADDRESS = fromClient("NEXT_PUBLIC_UNLOCK_ADDRESS") as string;
export const LOCK_ADDRESS = fromClient("NEXT_PUBLIC_LOCK_ADDRESS") as string;
export const BASE_NETWORK_ID = Number(fromClient("NEXT_PUBLIC_BASE_NETWORK_ID"));
export const BASE_RPC_URL = fromClient("NEXT_PUBLIC_BASE_RPC_URL") as string;
export const USDC_ADDRESS = fromClient("NEXT_PUBLIC_USDC_ADDRESS") as string | undefined;

export const PRIVATE_KEY_SECRET_ARN = fromClient("NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN") as string;
export const CLOUDFRONT_DOMAIN = fromClient("NEXT_PUBLIC_CLOUDFRONT_DOMAIN") as string;
export const KEY_PAIR_ID = fromClient("NEXT_PUBLIC_KEY_PAIR_ID") as string;
export const AWS_REGION = fromClient("NEXT_PUBLIC_AWS_REGION") as string;
