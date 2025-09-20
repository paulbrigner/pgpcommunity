const DEFAULT_BASE_NETWORK_ID = 8453;

const parseNumber = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const UNLOCK_ADDRESS = process.env.NEXT_PUBLIC_UNLOCK_ADDRESS as string;
export const LOCK_ADDRESS = process.env.NEXT_PUBLIC_LOCK_ADDRESS as string;
const resolvedBaseNetworkId = parseNumber(process.env.NEXT_PUBLIC_BASE_NETWORK_ID);
export const BASE_NETWORK_ID = resolvedBaseNetworkId && resolvedBaseNetworkId > 0 ? resolvedBaseNetworkId : DEFAULT_BASE_NETWORK_ID;
export const BASE_CHAIN_ID_HEX = `0x${BASE_NETWORK_ID.toString(16)}`;
export const BASE_RPC_URL = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
export const BASE_BLOCK_EXPLORER_URL = process.env.NEXT_PUBLIC_BASE_BLOCK_EXPLORER_URL || "https://basescan.org";
export const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as string;
export const UNLOCK_SUBGRAPH_URL = process.env.NEXT_PUBLIC_UNLOCK_SUBGRAPH_URL as string | undefined;
export const UNLOCK_SUBGRAPH_ID = process.env.UNLOCK_SUBGRAPH_ID as string | undefined;
export const UNLOCK_SUBGRAPH_API_KEY = process.env.UNLOCK_SUBGRAPH_API_KEY as string | undefined;
export const HIDDEN_UNLOCK_CONTRACTS = (process.env.HIDDEN_UNLOCK_CONTRACTS || '')
  .split(',')
  .map((addr) => addr.trim().toLowerCase())
  .filter((addr) => addr.length > 0);
export const LOCKSMITH_BASE_URL = process.env.NEXT_PUBLIC_LOCKSMITH_BASE || "https://locksmith.unlock-protocol.com";
export const PRIVATE_KEY_SECRET = (process.env.PRIVATE_KEY_SECRET || "").replace(/\\n/g, "\n") as string;
export const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN as string;
export const KEY_PAIR_ID = process.env.KEY_PAIR_ID as string;
export const AWS_REGION = process.env.REGION_AWS as string;
export const NEXTAUTH_URL = process.env.NEXTAUTH_URL as string;
export const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET as string;
export const NEXTAUTH_TABLE = process.env.NEXTAUTH_TABLE as string;
export const EMAIL_SERVER = process.env.EMAIL_SERVER as string;
export const EMAIL_FROM = process.env.EMAIL_FROM as string;
export const EMAIL_SERVER_HOST = process.env.EMAIL_SERVER_HOST as string | undefined;
export const EMAIL_SERVER_PORT = process.env.EMAIL_SERVER_PORT as string | undefined;
export const EMAIL_SERVER_USER = process.env.EMAIL_SERVER_USER as string | undefined;
export const EMAIL_SERVER_PASSWORD = process.env.EMAIL_SERVER_PASSWORD as string | undefined;
export const EMAIL_SERVER_SECURE = process.env.EMAIL_SERVER_SECURE as string | undefined;
