import { BASE_NETWORK_ID, BASE_RPC_URL } from "@/lib/config";

const parseBool = (value: string | undefined): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const parseIntSafe = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBigIntSafe = (value: string | undefined): bigint | null => {
  if (!value) return null;
  try {
    const normalized = value.trim();
    if (!normalized) return null;
    return BigInt(normalized);
  } catch {
    return null;
  }
};

export type MemberSponsorConfig = {
  enabled: boolean;
  privateKey: string | null;
  rpcUrl: string;
  chainId: number;
  minBalanceWei: bigint | null;
  maxTxPerDay: number | null;
};

export function getMemberSponsorConfig(): MemberSponsorConfig {
  const enabled = parseBool(process.env.MEMBER_SPONSORSHIP_ENABLED);
  const privateKeyRaw = process.env.MEMBER_SPONSOR_PRIVATE_KEY;
  const privateKey = privateKeyRaw && privateKeyRaw.trim().length ? privateKeyRaw.trim() : null;
  const rpcUrl =
    (process.env.MEMBER_SPONSOR_RPC_URL || process.env.BASE_RPC_URL || BASE_RPC_URL || "").trim() || BASE_RPC_URL;
  const minBalanceWei = parseBigIntSafe(process.env.MEMBER_SPONSOR_MIN_BALANCE_WEI);
  const maxTxPerDay = parseIntSafe(process.env.MEMBER_SPONSOR_MAX_TX_PER_DAY);

  return {
    enabled,
    privateKey,
    rpcUrl,
    chainId: BASE_NETWORK_ID,
    minBalanceWei,
    maxTxPerDay,
  };
}
