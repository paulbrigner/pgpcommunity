import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - nodemailer types not installed
import nodemailer from "nodemailer";
import { Contract, getAddress, isAddress } from "ethers";
import {
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  EMAIL_FROM,
  EMAIL_SERVER,
  EMAIL_SERVER_HOST,
  EMAIL_SERVER_PASSWORD,
  EMAIL_SERVER_PORT,
  EMAIL_SERVER_SECURE,
  EMAIL_SERVER_USER,
  MEMBERSHIP_TIER_ADDRESSES,
  NEXTAUTH_SECRET,
} from "@/lib/config";
import { recordEmailEvent } from "@/lib/admin/email-log";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import { getRpcProvider } from "@/lib/rpc/provider";
import { recordSponsorAction } from "@/lib/sponsor/audit";
import { isAllowedEventLock } from "@/lib/events/discovery";
import { generateCheckinQR } from "@/lib/events/checkin-qr";

export const runtime = "nodejs";

const LOCK_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function isValidKey(uint256 tokenId) view returns (bool)",
] as const;

const buildEmailServerConfig = () => {
  if (EMAIL_SERVER_HOST) {
    return {
      host: EMAIL_SERVER_HOST,
      port: EMAIL_SERVER_PORT ? Number(EMAIL_SERVER_PORT) : 587,
      secure: EMAIL_SERVER_SECURE === "true",
      auth:
        EMAIL_SERVER_USER && EMAIL_SERVER_PASSWORD
          ? { user: EMAIL_SERVER_USER, pass: EMAIL_SERVER_PASSWORD }
          : undefined,
    } as any;
  }
  if (EMAIL_SERVER && EMAIL_SERVER.includes("://")) {
    return EMAIL_SERVER as any;
  }
  if (EMAIL_SERVER) {
    return {
      host: EMAIL_SERVER,
      port: EMAIL_SERVER_PORT ? Number(EMAIL_SERVER_PORT) : 587,
      secure: EMAIL_SERVER_SECURE === "true",
      auth:
        EMAIL_SERVER_USER && EMAIL_SERVER_PASSWORD
          ? { user: EMAIL_SERVER_USER, pass: EMAIL_SERVER_PASSWORD }
          : undefined,
    } as any;
  }
  return null;
};

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  let userId: string | null = null;
  let userEmail: string | null = null;
  let lockChecksum: string | null = null;
  let tokenIdText: string | null = null;
  let tokenOwnerLower: string | null = null;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = request.headers.get("user-agent") || null;

  try {
    const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    userId = token?.sub ?? null;
    if (!userId) {
      return jsonError(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const body = await request.json().catch(() => ({} as any));
    const requestedLock = typeof body?.lockAddress === "string" ? body.lockAddress.trim() : "";
    const requestedTokenId = typeof body?.tokenId === "string" ? body.tokenId.trim() : "";
    if (!requestedLock || !isAddress(requestedLock)) {
      return jsonError(400, { error: "Invalid event lock address.", code: "INVALID_LOCK_ADDRESS" });
    }
    if (!requestedTokenId) {
      return jsonError(400, { error: "Missing token id.", code: "MISSING_TOKEN_ID" });
    }
    tokenIdText = requestedTokenId;
    let tokenId: bigint;
    try {
      tokenId = BigInt(requestedTokenId);
    } catch {
      return jsonError(400, { error: "Invalid token id.", code: "INVALID_TOKEN_ID" });
    }

    lockChecksum = getAddress(requestedLock);
    const lockLower = lockChecksum.toLowerCase();
    if (MEMBERSHIP_TIER_ADDRESSES.has(lockLower)) {
      return jsonError(400, { error: "Lock address is a membership tier.", code: "INVALID_EVENT_LOCK" });
    }

    const userRes = await documentClient.get({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
    });
    const user = (userRes.Item || {}) as any;
    userEmail = typeof user.email === "string" && user.email.length ? user.email : null;

    const emailVerified = Boolean(user?.emailVerified);
    if (!userEmail || !emailVerified) {
      await recordSponsorAction({
        action: "email-event-checkin-qr",
        status: "rejected",
        userId,
        email: userEmail,
        recipient: null,
        ip,
        userAgent,
        lockAddress: lockChecksum,
        error: "Email not verified",
        metadata: { code: "EMAIL_NOT_VERIFIED" },
      }).catch(() => {});
      return jsonError(403, { error: "Verify your email before requesting QR emails.", code: "EMAIL_NOT_VERIFIED" });
    }

    const wallets: string[] = Array.isArray(user.wallets) ? user.wallets.map((w: any) => String(w).toLowerCase()) : [];
    const walletAddress: string | null = user.walletAddress ? String(user.walletAddress).toLowerCase() : null;
    const addresses = Array.from(new Set([walletAddress, ...wallets].filter((v) => typeof v === "string" && v.length)));
    if (!addresses.length) {
      return jsonError(400, { error: "No wallet linked.", code: "NO_WALLET" });
    }

    if (!(await isAllowedEventLock(lockLower))) {
      return jsonError(403, { error: "This event lock is not eligible for check-in QR emails.", code: "EVENT_LOCK_NOT_ALLOWED" });
    }

    // Verify ownership and key validity on-chain
    const provider = getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
    const lockReader = new Contract(lockChecksum, LOCK_ABI, provider);
    const [tokenOwner, isValidKey] = await Promise.all([
      lockReader.ownerOf(tokenId).catch(() => null),
      lockReader.isValidKey(tokenId).catch(() => false),
    ]);

    tokenOwnerLower = typeof tokenOwner === "string" ? tokenOwner.toLowerCase() : null;
    if (!tokenOwnerLower || !addresses.includes(tokenOwnerLower)) {
      return jsonError(403, { error: "You can only email QR codes for keys you own.", code: "NOT_KEY_OWNER" });
    }

    if (!isValidKey) {
      await recordSponsorAction({
        action: "email-event-checkin-qr",
        status: "rejected",
        userId,
        email: userEmail,
        recipient: tokenOwnerLower,
        ip,
        userAgent,
        lockAddress: lockChecksum,
        error: "RSVP not active",
        metadata: { code: "RSVP_NOT_ACTIVE", tokenId: tokenId.toString() },
      }).catch(() => {});
      return jsonError(403, {
        error: "This RSVP is not active. Re-register to email a new check-in QR code.",
        code: "RSVP_NOT_ACTIVE",
      });
    }

    // Generate QR locally using HMAC-signed payload
    const { buffer } = await generateCheckinQR({
      lockAddress: lockLower,
      tokenId: tokenId.toString(),
      ownerAddress: tokenOwnerLower,
    });

    const transportConfig = buildEmailServerConfig();
    if (!transportConfig || !EMAIL_FROM) {
      return jsonError(500, { error: "Email provider not configured.", code: "EMAIL_NOT_CONFIGURED" });
    }

    const subject = "Your event check-in QR code";
    const html = `
      <p>Here is your event check-in QR code.</p>
      <p>Show this QR at check-in. Keep it private—anyone with this QR may be able to check in on your behalf.</p>
      <p><img src="cid:pgp-checkin-qr" alt="Event check-in QR" style="max-width: 320px; width: 100%; height: auto;" /></p>
      <p style="color:#666;font-size:12px;">Lock: ${lockChecksum}<br/>Token ID: ${tokenId.toString()}</p>
    `.trim();
    const text = `Here is your event check-in QR code.\n\nShow this QR at check-in. Keep it private—anyone with this QR may be able to check in on your behalf.\n\nLock: ${lockChecksum}\nToken ID: ${tokenId.toString()}\n`;

    const transporter = nodemailer.createTransport(transportConfig);
    const sendResult = await transporter.sendMail({
      to: userEmail,
      from: EMAIL_FROM,
      subject,
      text,
      html,
      attachments: [
        {
          filename: "event-checkin-qr.png",
          content: buffer,
          contentType: "image/png",
          cid: "pgp-checkin-qr",
        },
      ],
    });

    const sentAt = new Date().toISOString();
    await recordEmailEvent({
      userId,
      email: userEmail,
      wallet: tokenOwnerLower,
      type: "event_checkin_qr",
      subject,
      status: "sent",
      providerMessageId: sendResult?.messageId ? String(sendResult.messageId) : null,
      metadata: {
        lockAddress: lockChecksum,
        tokenId: tokenId.toString(),
      },
    }).catch(() => {});

    await recordSponsorAction({
      action: "email-event-checkin-qr",
      status: "submitted",
      userId,
      email: userEmail,
      recipient: tokenOwnerLower,
      ip,
      userAgent,
      lockAddress: lockChecksum,
      metadata: {
        tokenId: tokenId.toString(),
        sentTo: userEmail,
        providerMessageId: sendResult?.messageId ? String(sendResult.messageId) : null,
      },
    }).catch(() => {});

    return jsonError(200, { ok: true, sentTo: userEmail, sentAt });
  } catch (err: any) {
    const message = err?.message || "Unable to email check-in QR code.";
    await recordSponsorAction({
      action: "email-event-checkin-qr",
      status: "failed",
      userId,
      email: userEmail,
      recipient: tokenOwnerLower,
      ip,
      userAgent,
      lockAddress: lockChecksum,
      error: message,
      metadata: { tokenId: tokenIdText },
    }).catch(() => {});
    console.error("checkin-qr email failed", { userId, lockAddress: lockChecksum, error: message });
    return jsonError(500, { error: message, code: "UNKNOWN_ERROR" });
  }
}
