import { NextRequest, NextResponse } from "next/server";
import { Contract } from "ethers";
import { requireAdminSession } from "@/lib/admin/auth";
import { MEMBERSHIP_TIERS, BASE_RPC_URL, BASE_NETWORK_ID } from "@/lib/config";
import { getRpcProvider } from "@/lib/rpc/provider";
import {
  getMembershipMetadata,
  listMembershipMetadata,
  putMembershipMetadata,
  normalizeLockAddress,
  type MembershipMetadataStatus,
} from "@/lib/membership/metadata-store";

export const runtime = "nodejs";

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const lockNameCache = new Map<string, string | null>();

async function getLockName(lockAddress: string): Promise<string | null> {
  const key = lockAddress.toLowerCase();
  if (lockNameCache.has(key)) return lockNameCache.get(key) ?? null;
  const provider = BASE_RPC_URL ? getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID) : null;
  if (!provider) {
    lockNameCache.set(key, null);
    return null;
  }
  try {
    const contract = new Contract(lockAddress, ["function name() view returns (string)"], provider);
    const name: string = await contract.name();
    const trimmed = typeof name === "string" ? name.trim() : "";
    const resolved = trimmed.length ? trimmed : null;
    lockNameCache.set(key, resolved);
    return resolved;
  } catch {
    lockNameCache.set(key, null);
    return null;
  }
}

export async function GET() {
  await requireAdminSession();

  const [metadataList, onChainNames] = await Promise.all([
    listMembershipMetadata(),
    Promise.all(MEMBERSHIP_TIERS.map((tier) => getLockName(tier.checksumAddress))),
  ]);

  const metadataByLock = new Map(
    metadataList.map((entry) => [entry.lockAddress.toLowerCase(), entry]),
  );

  const tiers = MEMBERSHIP_TIERS.map((tier, index) => {
    const meta = metadataByLock.get(tier.address);
    return {
      lockAddress: tier.address,
      checksumAddress: tier.checksumAddress,
      tierId: tier.id,
      configLabel: tier.label || null,
      onChainName: onChainNames[index] || null,
      order: tier.order,
      hasMetadata: Boolean(meta),
      metadata: meta ?? null,
    };
  });

  return NextResponse.json(
    { tiers },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const session = await requireAdminSession();
  const body = await request.json().catch(() => ({}));

  const lockAddress = normalizeLockAddress(normalizeString(body?.lockAddress));
  if (!lockAddress) {
    return jsonError(400, { error: "Valid lockAddress required." });
  }

  const tierConfig = MEMBERSHIP_TIERS.find((t) => t.address === lockAddress);
  if (!tierConfig) {
    return jsonError(404, { error: "Lock address is not a configured membership tier." });
  }

  const name = normalizeString(body?.name);
  if (!name) {
    return jsonError(400, { error: "name is required." });
  }

  const statusRaw = normalizeString(body?.status) ?? "draft";
  const status: MembershipMetadataStatus = statusRaw === "published" ? "published" : "draft";
  const description = normalizeString(body?.description);
  const imageUrl = normalizeString(body?.imageUrl);
  const tierOrder = typeof body?.tierOrder === "number" && Number.isFinite(body.tierOrder)
    ? body.tierOrder
    : tierConfig.order;

  const existing = await getMembershipMetadata(lockAddress);
  const now = new Date().toISOString();

  const record = {
    pk: `MEMBERSHIP_META#${lockAddress}`,
    sk: "META",
    lockAddress,
    status,
    name,
    description,
    imageUrl,
    tierOrder,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy: (session.user as any)?.id || null,
  };

  await putMembershipMetadata(record);

  return NextResponse.json(
    { ok: true, metadata: record },
    { headers: { "Cache-Control": "no-store" } },
  );
}
