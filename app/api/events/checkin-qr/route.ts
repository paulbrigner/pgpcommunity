import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { Contract, getAddress, isAddress } from "ethers";
import {
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  MEMBERSHIP_TIER_ADDRESSES,
  NEXTAUTH_SECRET,
} from "@/lib/config";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import { getRpcProvider } from "@/lib/rpc/provider";
import { isAllowedEventLock } from "@/lib/events/discovery";
import { generateCheckinQR } from "@/lib/events/checkin-qr";

export const runtime = "nodejs";

const LOCK_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function isValidKey(uint256 tokenId) view returns (bool)",
] as const;

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  let userId: string | null = null;

  try {
    const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    userId = token?.sub ?? null;
    if (!userId) {
      return jsonError(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const { searchParams } = new URL(request.url);
    const requestedLock = searchParams.get("lockAddress")?.trim() || "";
    const requestedTokenId = searchParams.get("tokenId")?.trim() || "";
    if (!requestedLock || !isAddress(requestedLock)) {
      return jsonError(400, { error: "Invalid event lock address.", code: "INVALID_LOCK_ADDRESS" });
    }
    if (!requestedTokenId) {
      return jsonError(400, { error: "Missing token id.", code: "MISSING_TOKEN_ID" });
    }
    let tokenId: bigint;
    try {
      tokenId = BigInt(requestedTokenId);
    } catch {
      return jsonError(400, { error: "Invalid token id.", code: "INVALID_TOKEN_ID" });
    }

    const lockChecksum = getAddress(requestedLock);
    const lockLower = lockChecksum.toLowerCase();
    if (MEMBERSHIP_TIER_ADDRESSES.has(lockLower)) {
      return jsonError(400, { error: "Lock address is a membership tier.", code: "INVALID_EVENT_LOCK" });
    }

    // Verify user identity and email
    const userRes = await documentClient.get({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
    });
    const user = (userRes.Item || {}) as any;
    const userEmail = typeof user.email === "string" && user.email.length ? user.email : null;
    const emailVerified = Boolean(user?.emailVerified);
    if (!userEmail || !emailVerified) {
      return jsonError(403, { error: "Verify your email before using check-in QR codes.", code: "EMAIL_NOT_VERIFIED" });
    }

    const wallets: string[] = Array.isArray(user.wallets) ? user.wallets.map((w: any) => String(w).toLowerCase()) : [];
    const walletAddress: string | null = user.walletAddress ? String(user.walletAddress).toLowerCase() : null;
    const addresses = Array.from(new Set([walletAddress, ...wallets].filter((v) => typeof v === "string" && v.length)));
    if (!addresses.length) {
      return jsonError(400, { error: "No wallet linked.", code: "NO_WALLET" });
    }

    if (!(await isAllowedEventLock(lockLower))) {
      return jsonError(403, { error: "This event lock is not eligible for check-in QR codes.", code: "EVENT_LOCK_NOT_ALLOWED" });
    }

    // Verify ownership and key validity on-chain
    const provider = getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
    const lockReader = new Contract(lockChecksum, LOCK_ABI, provider);
    const [tokenOwner, isValidKey] = await Promise.all([
      lockReader.ownerOf(tokenId).catch(() => null),
      lockReader.isValidKey(tokenId).catch(() => false),
    ]);

    const tokenOwnerLower = typeof tokenOwner === "string" ? tokenOwner.toLowerCase() : null;
    if (!tokenOwnerLower || !addresses.includes(tokenOwnerLower)) {
      return jsonError(403, { error: "You can only view QR codes for keys you own.", code: "NOT_KEY_OWNER" });
    }

    if (!isValidKey) {
      return jsonError(403, {
        error: "This RSVP is not active. Re-register to get a new check-in QR code.",
        code: "RSVP_NOT_ACTIVE",
      });
    }

    // Generate QR locally using HMAC-signed payload
    const { buffer } = await generateCheckinQR({
      lockAddress: lockLower,
      tokenId: tokenId.toString(),
      ownerAddress: tokenOwnerLower,
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    const message = err?.message || "Unable to load check-in QR code.";
    console.error("checkin-qr failed", { userId, error: message });
    return jsonError(500, { error: message, code: "UNKNOWN_ERROR" });
  }
}
