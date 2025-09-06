// Client-safe (public) configuration
// Reads from $amplify/env/client when available in Amplify Hosting Gen 2
// Falls back to process.env for local development.

let clientEnv: Record<string, string | undefined> | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  clientEnv = require("$amplify/env/client").env as Record<string, string | undefined>;
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

