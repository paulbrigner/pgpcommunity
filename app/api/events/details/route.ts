import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { Contract, getAddress, isAddress } from "ethers";
import { BASE_NETWORK_ID, BASE_RPC_URL, NEXTAUTH_SECRET } from "@/lib/config";
import { getRpcProvider } from "@/lib/rpc/provider";
import { getEventMetadata } from "@/lib/events/metadata-store";
import { isAllowedEventLock } from "@/lib/events/discovery";

export const runtime = "nodejs";

const provider = BASE_RPC_URL ? getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID) : null;

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

async function getLockName(lockAddress: string): Promise<string | null> {
  if (!provider) return null;
  try {
    const lock = new Contract(lockAddress, ["function name() view returns (string)"], provider);
    const name: string = await lock.name();
    const trimmed = typeof name === "string" ? name.trim() : "";
    return trimmed.length ? trimmed : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
  if (!token?.sub) {
    return jsonError(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
  }
  const isAdmin = Boolean((token as any)?.isAdmin);
  const membershipStatus = (token as any)?.membershipStatus;
  if (!isAdmin && membershipStatus !== "active") {
    return jsonError(403, { error: "Membership required.", code: "MEMBERSHIP_REQUIRED" });
  }

  const { searchParams } = new URL(request.url);
  const rawLock = searchParams.get("lockAddress");
  if (!rawLock || !isAddress(rawLock)) {
    return jsonError(400, { error: "Valid lockAddress query param required." });
  }

  if (!provider) {
    return jsonError(500, { error: "RPC provider unavailable.", code: "RPC_UNAVAILABLE" });
  }

  const lockChecksum = getAddress(rawLock);
  const lockLower = lockChecksum.toLowerCase();
  if (!(await isAllowedEventLock(lockLower))) {
    return jsonError(404, { error: "Event not found." });
  }

  const [onChainTitle, metadata] = await Promise.all([
    getLockName(lockChecksum),
    getEventMetadata(lockLower),
  ]);

  const isDraft = metadata?.status === "draft";
  const isVisible = !isDraft || isAdmin;
  const title = metadata?.titleOverride?.trim()?.length
    ? metadata.titleOverride.trim()
    : onChainTitle || "Event";

  return NextResponse.json(
    {
      lockAddress: lockChecksum,
      title,
      onChainTitle,
      titleOverride: metadata?.titleOverride ?? null,
      description: isVisible ? metadata?.description ?? null : null,
      date: isVisible ? metadata?.date ?? null : null,
      startTime: isVisible ? metadata?.startTime ?? null : null,
      endTime: isVisible ? metadata?.endTime ?? null : null,
      timezone: isVisible ? metadata?.timezone ?? null : null,
      location: isVisible ? metadata?.location ?? null : null,
      image: isVisible ? metadata?.imageUrl ?? null : null,
      metadataStatus: metadata?.status ?? null,
      hasMetadata: Boolean(metadata),
      isDraft,
      isAdmin,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
