import { NextRequest, NextResponse } from "next/server";
import { Contract } from "ethers";
import { MEMBERSHIP_TIERS, MEMBERSHIP_TIER_ADDRESSES, BASE_RPC_URL, BASE_NETWORK_ID } from "@/lib/config";
import { getRpcProvider } from "@/lib/rpc/provider";
import {
  getMembershipMetadata,
  normalizeLockAddress,
  checksumLockAddress,
} from "@/lib/membership/metadata-store";

export const runtime = "nodejs";

const provider = BASE_RPC_URL ? getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID) : null;
const lockNameCache = new Map<string, string | null>();

const normalizeImageUrl = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("ipfs://")) {
    const path = trimmed.slice("ipfs://".length);
    return `https://cloudflare-ipfs.com/ipfs/${path}`;
  }
  return trimmed;
};

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

async function getLockName(lockAddress: string): Promise<string | null> {
  const key = lockAddress.toLowerCase();
  if (lockNameCache.has(key)) return lockNameCache.get(key) ?? null;
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

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ lockAddress: string; tokenId: string }> },
) {
  const params = await context.params;
  const rawLock = params?.lockAddress;
  const tokenId = params?.tokenId;
  const lockChecksum = checksumLockAddress(rawLock);
  const lockLower = normalizeLockAddress(rawLock);

  if (!lockChecksum || !lockLower || !tokenId) {
    return jsonError(400, { error: "Valid lockAddress and tokenId are required." });
  }

  if (!MEMBERSHIP_TIER_ADDRESSES.has(lockLower)) {
    return jsonError(404, { error: "Not a membership tier." });
  }

  const tierConfig = MEMBERSHIP_TIERS.find((t) => t.address === lockLower);
  const [onChainName, metadata] = await Promise.all([
    getLockName(lockChecksum),
    getMembershipMetadata(lockLower),
  ]);

  const isPublished = metadata?.status === "published";
  const name = isPublished && metadata?.name
    ? metadata.name
    : tierConfig?.label || onChainName || "Membership";
  const description = isPublished && metadata?.description
    ? metadata.description
    : tierConfig?.label
      ? `${tierConfig.label} membership tier`
      : "PGP Community membership";
  const image = isPublished ? normalizeImageUrl(metadata?.imageUrl) : null;

  const origin = new URL(_request.url).origin;
  const externalUrl = `${origin}/settings/profile/membership`;

  const attributes: Array<{ trait_type: string; value: string }> = [];
  if (tierConfig?.label) {
    attributes.push({ trait_type: "Tier", value: tierConfig.label });
  }
  attributes.push({ trait_type: "Tier order", value: String(tierConfig?.order ?? 0) });
  attributes.push({ trait_type: "Lock address", value: lockChecksum });
  attributes.push({ trait_type: "Token ID", value: tokenId });
  if (tierConfig?.renewable === false) {
    attributes.push({ trait_type: "Renewable", value: "No" });
  }
  if (tierConfig?.neverExpires) {
    attributes.push({ trait_type: "Expires", value: "Never" });
  }

  const payload: Record<string, unknown> = {
    name: `${name} #${tokenId}`,
    description,
    external_url: externalUrl,
    attributes,
  };

  if (image) {
    payload.image = image;
  }

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
}
