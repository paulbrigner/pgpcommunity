import { NextRequest, NextResponse } from "next/server";
import { Contract } from "ethers";
import { BASE_NETWORK_ID, BASE_RPC_URL } from "@/lib/config";
import { getRpcProvider } from "@/lib/rpc/provider";
import { isAllowedEventLock } from "@/lib/events/discovery";
import { checksumLockAddress, getEventMetadata, normalizeLockAddress } from "@/lib/events/metadata-store";

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

const buildCompactObject = (entries: Array<[string, string | null | undefined]>) => {
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value && typeof value === "string" && value.trim().length) {
      result[key] = value.trim();
    }
  }
  return result;
};

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

export async function GET(_request: NextRequest, context: { params: Promise<{ lockAddress: string; tokenId: string }> }) {
  const params = await context.params;
  const rawLock = params?.lockAddress;
  const tokenId = params?.tokenId;
  const lockChecksum = checksumLockAddress(rawLock);
  const lockLower = normalizeLockAddress(rawLock);

  if (!lockChecksum || !lockLower || !tokenId) {
    return jsonError(400, { error: "Valid lockAddress and tokenId are required." });
  }

  if (!(await isAllowedEventLock(lockLower))) {
    return jsonError(404, { error: "Event not found." });
  }

  const [onChainName, metadata] = await Promise.all([
    getLockName(lockChecksum),
    getEventMetadata(lockLower),
  ]);

  const isPublished = metadata?.status === "published";
  const title = metadata?.titleOverride?.trim()?.length
    ? metadata.titleOverride.trim()
    : onChainName || "Event";
  const description = isPublished
    ? metadata?.description?.trim() || "Details coming soon."
    : "Details coming soon.";

  const date = isPublished ? metadata?.date ?? null : null;
  const startTime = isPublished ? metadata?.startTime ?? null : null;
  const endTime = isPublished ? metadata?.endTime ?? null : null;
  const timezone = isPublished ? metadata?.timezone ?? null : null;
  const location = isPublished ? metadata?.location ?? null : null;
  const image = isPublished ? normalizeImageUrl(metadata?.imageUrl) : null;

  const origin = new URL(_request.url).origin;
  const externalUrl = `${origin}/events/${lockChecksum}`;

  const attributes: Array<{ trait_type: string; value: string }> = [];
  if (date) attributes.push({ trait_type: "Event date", value: date });
  if (startTime) attributes.push({ trait_type: "Start time", value: startTime });
  if (endTime) attributes.push({ trait_type: "End time", value: endTime });
  if (timezone) attributes.push({ trait_type: "Timezone", value: timezone });
  if (location) attributes.push({ trait_type: "Location", value: location });
  attributes.push({ trait_type: "Lock address", value: lockChecksum });
  attributes.push({ trait_type: "Token ID", value: tokenId });

  const ticket = buildCompactObject([
    ["event_start_date", date],
    ["event_start_time", startTime],
    ["event_end_time", endTime],
    ["event_timezone", timezone],
    ["event_location", location],
    ["event_address", location],
  ]);

  const properties = buildCompactObject([
    ["lockAddress", lockChecksum],
    ["tokenId", tokenId],
    ["event_start_date", date],
    ["event_start_time", startTime],
    ["event_end_time", endTime],
    ["event_timezone", timezone],
    ["event_location", location],
    ["event_address", location],
  ]);

  const payload: Record<string, unknown> = {
    name: `${title} #${tokenId}`,
    description,
    external_url: externalUrl,
    attributes,
    properties,
  };

  if (image) {
    payload.image = image;
  }
  if (Object.keys(ticket).length) {
    payload.ticket = ticket;
  }

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
