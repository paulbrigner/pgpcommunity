import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import { BASE_NETWORK_ID, BASE_RPC_URL, MEMBERSHIP_TIERS, USDC_ADDRESS } from "@/lib/config";
import { membershipStateService, snapshotToMembershipSummary, type AllowanceState } from "@/lib/membership-state-service";
import { pickHighestActiveTier, pickNextActiveTier, resolveTierLabel } from "@/lib/membership-tiers";

type RawUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  wallets?: string[] | null;
  walletAddress?: string | null;
  isAdmin?: boolean | null;
  welcomeEmailSentAt?: string | null;
  lastEmailSentAt?: string | null;
  lastEmailType?: string | null;
  emailBounceReason?: string | null;
  emailSuppressed?: boolean | null;
};

export type AdminMember = {
  id: string;
  name: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  wallets: string[];
  primaryWallet: string | null;
  membershipStatus: "active" | "expired" | "none" | "unknown";
  membershipExpiry: number | null;
  highestActiveTierId: string | null;
  highestActiveTierLabel: string | null;
  highestActiveTierExpiry: number | null;
  highestActiveTierLock: string | null;
  highestActiveTierTokenId: string | null;
  nextActiveTierId: string | null;
  nextActiveTierLabel: string | null;
  nextActiveTierExpiry: number | null;
  autoRenew: boolean | null;
  allowances: Record<string, AllowanceState>;
  ethBalance: string | null;
  usdcBalance: string | null;
  isAdmin: boolean;
  welcomeEmailSentAt: string | null;
  lastEmailSentAt: string | null;
  lastEmailType: string | null;
  emailBounceReason: string | null;
  emailSuppressed: boolean | null;
  membershipCheckedAt: number | null;
};

export type AdminRoster = {
  members: AdminMember[];
  meta: {
    total: number;
    active: number;
    expired: number;
    none: number;
    autoRenewOn: number;
    autoRenewOff: number;
    expiringSoon: number;
  };
};

export type BuildAdminRosterOptions = {
  includeAllowances?: boolean;
  includeBalances?: boolean;
  includeTokenIds?: boolean;
  statusFilter?: "all" | "active" | "expired" | "none";
};

const ERC20_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"] as const;
const provider = new JsonRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
const usdcContract = USDC_ADDRESS ? new Contract(USDC_ADDRESS, ERC20_BALANCE_ABI, provider) : null;
const balanceCache = new Map<string, { ethBalance: string | null; usdcBalance: string | null }>();

async function scanUsers(): Promise<RawUser[]> {
  const items: RawUser[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await documentClient.scan({
      TableName: TABLE_NAME,
      FilterExpression: "#type = :user",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: { ":user": "USER" },
      ExclusiveStartKey,
    });
    if (res.Items) {
      for (const item of res.Items) {
        items.push(item as RawUser);
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);
  return items;
}

function normalizeWallets(wallets: any): string[] {
  if (!Array.isArray(wallets)) return [];
  return Array.from(
    new Set(
      wallets
        .map((addr) => (typeof addr === "string" ? addr.trim().toLowerCase() : ""))
        .filter((addr) => addr.length === 42 && addr.startsWith("0x")),
    ),
  );
}

async function fetchBalances(address: string | null): Promise<{ ethBalance: string | null; usdcBalance: string | null }> {
  if (!address) return { ethBalance: null, usdcBalance: null };
  const key = address.toLowerCase();
  const cached = balanceCache.get(key);
  if (cached) return cached;

  let ethBalance: string | null = null;
  let usdcBalance: string | null = null;
  try {
    const wei = await provider.getBalance(address);
    ethBalance = formatUnits(wei, 18);
  } catch (err) {
    console.warn("Admin roster: failed to fetch ETH balance", address, err);
  }
  if (usdcContract) {
    try {
      const bal = await usdcContract.balanceOf(address);
      usdcBalance = formatUnits(bal, 6);
    } catch (err) {
      console.warn("Admin roster: failed to fetch USDC balance", address, err);
    }
  }
  const result = { ethBalance, usdcBalance };
  balanceCache.set(key, result);
  return result;
}

function deriveAutoRenew(allowances: Record<string, AllowanceState>, highestTierId: string | null): boolean | null {
  if (!highestTierId) return null;
  const tier = MEMBERSHIP_TIERS.find((entry) => entry.id === highestTierId || entry.address === highestTierId);
  if (!tier) return null;
  const key = tier.checksumAddress.toLowerCase();
  const allowance = allowances[key];
  if (!allowance) return false;
  if (allowance.isUnlimited) return true;
  try {
    const approved = BigInt(allowance.amount || "0");
    const price = allowance.keyPrice ? BigInt(allowance.keyPrice) : null;
    if (price && approved >= price) return true;
    return approved > 0n;
  } catch {
    return false;
  }
}

async function buildAdminMemberEntry(user: RawUser, options: BuildAdminRosterOptions): Promise<AdminMember | null> {
  if (!user.id) return null;
  const includeAllowances = options.includeAllowances !== false;
  const includeBalances = options.includeBalances !== false;
  const includeTokenIds = options.includeTokenIds !== false;

  const wallets = normalizeWallets(user.wallets);
  const primaryWallet = user.walletAddress?.toLowerCase?.() || wallets[0] || null;
  const addresses = wallets.length ? wallets : primaryWallet ? [primaryWallet] : [];

  let membershipStatus: AdminMember["membershipStatus"] = "none";
  let membershipExpiry: number | null = null;
  let highestActiveTierId: string | null = null;
  let highestActiveTierLabel: string | null = null;
  let highestActiveTierExpiry: number | null = null;
  let highestActiveTierLock: string | null = null;
  let highestActiveTierTokenId: string | null = null;
  let nextActiveTierId: string | null = null;
  let nextActiveTierLabel: string | null = null;
  let nextActiveTierExpiry: number | null = null;
  let autoRenew: boolean | null = null;
  let allowances: Record<string, AllowanceState> = {};
  let membershipCheckedAt: number | null = null;

  if (addresses.length) {
    try {
      const snapshot = await membershipStateService.getState({
        addresses,
        forceRefresh: true,
        includeAllowances,
        includeTokenIds,
      });
      membershipCheckedAt = snapshot.fetchedAt;
      const { summary, allowances: allowanceMap } = snapshotToMembershipSummary(snapshot);
      allowances = includeAllowances ? allowanceMap : {};
      membershipStatus = summary.status ?? "none";
      const highest = pickHighestActiveTier(summary);
      const next = pickNextActiveTier(summary);
      membershipExpiry = highest?.expiry ?? summary.expiry ?? null;
      highestActiveTierId = highest?.tier?.id ?? summary.highestActiveTier?.tier?.id ?? null;
      highestActiveTierLabel = resolveTierLabel(highest || summary.highestActiveTier, highestActiveTierId);
      highestActiveTierExpiry = highest?.expiry ?? null;
      highestActiveTierLock = highest?.tier?.checksumAddress ?? summary.highestActiveTier?.tier?.checksumAddress ?? null;
      highestActiveTierTokenId = Array.isArray(highest?.tokenIds) && highest?.tokenIds.length ? highest.tokenIds[0] : null;
      nextActiveTierId = next?.tier?.id ?? null;
      nextActiveTierLabel = resolveTierLabel(next, nextActiveTierId);
      nextActiveTierExpiry = next?.expiry ?? null;
      autoRenew = includeAllowances ? deriveAutoRenew(allowances, highestActiveTierId) : null;
    } catch (err) {
      console.error("Admin roster: failed to build membership summary for user", user.id, err);
      membershipStatus = "unknown";
      allowances = {};
    }
  }

  if (options.statusFilter && options.statusFilter !== "all" && membershipStatus !== options.statusFilter) {
    return null;
  }

  const balances = includeBalances ? await fetchBalances(primaryWallet) : { ethBalance: null, usdcBalance: null };

  return {
    id: user.id,
    name: user.name || null,
    email: user.email || null,
    firstName: user.firstName || null,
    lastName: user.lastName || null,
    wallets,
    primaryWallet,
    membershipStatus,
    membershipExpiry,
    highestActiveTierId,
    highestActiveTierLabel,
    highestActiveTierExpiry,
    highestActiveTierLock,
    highestActiveTierTokenId,
    nextActiveTierId,
    nextActiveTierLabel,
    nextActiveTierExpiry,
    autoRenew,
    allowances,
    ethBalance: balances.ethBalance,
    usdcBalance: balances.usdcBalance,
    isAdmin: !!user.isAdmin,
    welcomeEmailSentAt: user.welcomeEmailSentAt || null,
    lastEmailSentAt: user.lastEmailSentAt || null,
    lastEmailType: user.lastEmailType || null,
    emailBounceReason: user.emailBounceReason || null,
    emailSuppressed: typeof user.emailSuppressed === "boolean" ? !!user.emailSuppressed : null,
    membershipCheckedAt,
  };
}

export async function buildAdminRoster(options: BuildAdminRosterOptions = {}): Promise<AdminRoster> {
  const users = await scanUsers();
  const entries = await Promise.all(users.map((user) => buildAdminMemberEntry(user, options)));
  const members: AdminMember[] = entries.filter((m): m is AdminMember => !!m);

  const nowSec = Math.floor(Date.now() / 1000);
  const statusRank = (status: AdminMember["membershipStatus"]) => {
    switch (status) {
      case "active":
        return 0;
      case "expired":
        return 1;
      case "none":
        return 2;
      default:
        return 3;
    }
  };

  members.sort((a, b) => {
    const byStatus = statusRank(a.membershipStatus) - statusRank(b.membershipStatus);
    if (byStatus !== 0) return byStatus;
    const expiryA = a.membershipExpiry || 0;
    const expiryB = b.membershipExpiry || 0;
    if (expiryA !== expiryB) return expiryA - expiryB;
    return (a.name || a.email || "").localeCompare(b.name || b.email || "");
  });

  const meta = {
    total: members.length,
    active: members.filter((m) => m.membershipStatus === "active").length,
    expired: members.filter((m) => m.membershipStatus === "expired").length,
    none: members.filter((m) => m.membershipStatus === "none").length,
    autoRenewOn: members.filter((m) => m.autoRenew === true).length,
    autoRenewOff: members.filter((m) => m.autoRenew === false).length,
    expiringSoon: members.filter((m) => typeof m.membershipExpiry === "number" && m.membershipExpiry > nowSec && m.membershipExpiry < nowSec + 30 * 24 * 60 * 60).length,
  };

  return { members, meta };
}

export async function buildAdminMembersByIds(userIds: string[], options: BuildAdminRosterOptions = {}): Promise<AdminMember[]> {
  const ids = Array.from(
    new Set(
      (userIds || [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0),
    ),
  );
  if (!ids.length) return [];

  const users: RawUser[] = [];
  for (const id of ids) {
    const res = await documentClient.get({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${id}`, sk: `USER#${id}` },
    });
    if (res.Item) {
      users.push(res.Item as RawUser);
    }
  }

  const entries = await Promise.all(users.map((user) => buildAdminMemberEntry(user, options)));
  return entries.filter((m): m is AdminMember => !!m);
}
