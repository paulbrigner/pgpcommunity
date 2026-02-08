import { NextRequest, NextResponse } from "next/server";
import { Contract, getAddress, isAddress } from "ethers";
import { requireAdminSession } from "@/lib/admin/auth";
import { BASE_RPC_URL, BASE_NETWORK_ID } from "@/lib/config";
import { isAllowedEventLock } from "@/lib/events/discovery";
import {
  putCheckIn,
  deleteCheckIn,
  getCheckInsByLock,
} from "@/lib/events/checkin-store";
import { verifySignedToken } from "@/lib/events/checkin-qr";
import { getRpcProvider } from "@/lib/rpc/provider";

export const runtime = "nodejs";

const LOCK_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function isValidKey(uint256 tokenId) view returns (bool)",
] as const;

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  await requireAdminSession();

  const { searchParams } = new URL(request.url);
  const rawLock = searchParams.get("lockAddress")?.trim() || "";
  if (!rawLock || !isAddress(rawLock)) {
    return jsonError(400, { error: "Valid lockAddress required." });
  }
  const lockLower = getAddress(rawLock).toLowerCase();
  if (!(await isAllowedEventLock(lockLower))) {
    return jsonError(404, { error: "Event not found." });
  }

  const checkIns = await getCheckInsByLock(lockLower);
  return NextResponse.json(
    { checkIns },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const session = await requireAdminSession();
  const adminId = (session.user as any)?.id || "admin";

  const body = await request.json().catch(() => ({}));
  const rawLock = typeof body?.lockAddress === "string" ? body.lockAddress.trim() : "";
  const rawTokenId = typeof body?.tokenId === "string" ? body.tokenId.trim() : "";
  const method = body?.method === "qr" ? "qr" as const : "manual" as const;
  const notes = typeof body?.notes === "string" ? body.notes.trim() || null : null;
  const qrToken = typeof body?.qrToken === "string" ? body.qrToken.trim() : "";

  let lockAddress: string;
  let tokenId: string;

  if (qrToken) {
    const payload = verifySignedToken(qrToken);
    if (!payload) {
      return jsonError(400, { error: "Invalid or expired QR code.", code: "INVALID_QR" });
    }
    lockAddress = payload.lockAddress;
    tokenId = payload.tokenId;
  } else {
    if (!rawLock || !isAddress(rawLock)) {
      return jsonError(400, { error: "Valid lockAddress required.", code: "INVALID_LOCK" });
    }
    if (!rawTokenId) {
      return jsonError(400, { error: "tokenId required.", code: "MISSING_TOKEN_ID" });
    }
    lockAddress = getAddress(rawLock).toLowerCase();
    tokenId = rawTokenId;
  }

  if (!(await isAllowedEventLock(lockAddress))) {
    return jsonError(404, { error: "Event not found." });
  }

  const provider = getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
  const lockContract = new Contract(getAddress(lockAddress), LOCK_ABI, provider);

  let tokenIdBigInt: bigint;
  try {
    tokenIdBigInt = BigInt(tokenId);
  } catch {
    return jsonError(400, { error: "Invalid token ID.", code: "INVALID_TOKEN_ID" });
  }

  const [tokenOwner, isValid] = await Promise.all([
    lockContract.ownerOf(tokenIdBigInt).catch(() => null),
    lockContract.isValidKey(tokenIdBigInt).catch(() => false),
  ]);

  if (!tokenOwner) {
    return jsonError(404, { error: "Token not found on lock.", code: "TOKEN_NOT_FOUND" });
  }

  if (!isValid) {
    return jsonError(400, {
      error: "RSVP is no longer active.",
      code: "RSVP_NOT_ACTIVE",
    });
  }

  const ownerAddress = typeof tokenOwner === "string" ? tokenOwner.toLowerCase() : "";
  const record = await putCheckIn(lockAddress, tokenId, {
    checkedInBy: adminId,
    method,
    notes,
    ownerAddress,
  });

  return NextResponse.json(
    { ok: true, checkIn: record },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: NextRequest) {
  await requireAdminSession();

  const { searchParams } = new URL(request.url);
  const rawLock = searchParams.get("lockAddress")?.trim() || "";
  const rawTokenId = searchParams.get("tokenId")?.trim() || "";
  if (!rawLock || !isAddress(rawLock)) {
    return jsonError(400, { error: "Valid lockAddress required." });
  }
  if (!rawTokenId) {
    return jsonError(400, { error: "tokenId required." });
  }

  const lockLower = getAddress(rawLock).toLowerCase();
  await deleteCheckIn(lockLower, rawTokenId);
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
