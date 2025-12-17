import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { randomUUID } from "crypto";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import nodemailer from "nodemailer";
import { membershipStateService, snapshotToMembershipSummary } from "@/lib/membership-state-service";
import { EMAIL_FROM, EMAIL_SERVER, EMAIL_SERVER_HOST, EMAIL_SERVER_PASSWORD, EMAIL_SERVER_PORT, EMAIL_SERVER_SECURE, EMAIL_SERVER_USER, NEXTAUTH_SECRET } from "@/lib/config";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";

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

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    if (!token?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({} as any));
    const reason = body?.reason;
    const postCancelPreferenceRaw = body?.postCancelPreference;
    const normalizedReason = typeof reason === "string" ? reason.trim() : "";
    const postCancelPreference =
      postCancelPreferenceRaw === "cancel-all" || postCancelPreferenceRaw === "keep-free"
        ? postCancelPreferenceRaw
        : "keep-free";

    const userRes = await documentClient.get({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${token.sub}`, sk: `USER#${token.sub}` },
    });
    const user = userRes.Item || {};
    const wallets: string[] = Array.isArray(user.wallets) ? user.wallets.map((w: any) => String(w).toLowerCase()) : [];
    const walletAddress: string | null = user.walletAddress ? String(user.walletAddress).toLowerCase() : wallets[0] || null;

    if (!walletAddress && wallets.length === 0) {
      return NextResponse.json({ error: "No wallet linked" }, { status: 400 });
    }

    const addresses = wallets.length ? wallets : walletAddress ? [walletAddress] : [];
    const snapshot = await membershipStateService.getState({ addresses, forceRefresh: true });
    const { summary } = snapshotToMembershipSummary(snapshot);
    const activeTiers = (summary?.tiers || []).filter((tier: any) => tier.status === "active");
    if (!activeTiers.length) {
      return NextResponse.json({ error: "No active membership to refund" }, { status: 400 });
    }
    const refundableTiers = activeTiers.filter((tier: any) => tier?.tier?.renewable !== false && tier?.tier?.neverExpires !== true);
    if (!refundableTiers.length) {
      return NextResponse.json({ error: "No refundable membership" }, { status: 400 });
    }
    const refundable = refundableTiers
      .slice()
      .sort((a: any, b: any) => (a?.tier?.order ?? 0) - (b?.tier?.order ?? 0))[0];
    const activeLocks = activeTiers.map((tier: any) => ({
      lockAddress: tier.tier?.checksumAddress || tier.tier?.address || null,
      tierId: tier.tier?.id || null,
      tierLabel: tier.tier?.label || tier.metadata?.name || tier.tier?.id || null,
    })).filter((entry: any) => entry.lockAddress);
    const tierLabel = refundable?.tier?.label || refundable?.metadata?.name || refundable?.tier?.id || null;
    const lockAddress = refundable?.tier?.checksumAddress || refundable?.tier?.address || null;
    const tierId = refundable?.tier?.id || null;

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const item = {
      pk: `REFUND_REQUEST#${id}`,
      sk: `REFUND_REQUEST#${id}`,
      type: "REFUND_REQUEST",
      status: "pending",
      userId: token.sub,
      email: user.email || null,
      wallet: walletAddress,
      wallets: addresses,
      tierId,
      tierLabel,
      lockAddress,
      activeLocks,
      reason: normalizedReason || null,
      postCancelPreference,
      createdAt,
      updatedAt: createdAt,
      GSI1PK: "REFUND_REQUEST",
      GSI1SK: createdAt,
    };

    await documentClient.put({
      TableName: TABLE_NAME,
      Item: item,
    });

    // Notify admin email (best-effort)
    const transportConfig = buildEmailServerConfig();
    if (transportConfig && EMAIL_FROM) {
      try {
        const transporter = nodemailer.createTransport(transportConfig);
        const subject = "Refund request submitted";
        const body = `
User: ${user.email || token.sub}
Wallet: ${walletAddress || "N/A"}
Tier: ${tierLabel} (${lockAddress})
After cancellation: ${postCancelPreference}
Reason: ${normalizedReason || "N/A"}
Created: ${createdAt}
`;
        await transporter.sendMail({
          to: EMAIL_FROM,
          from: EMAIL_FROM,
          subject,
          text: body,
        });
      } catch (err) {
        console.warn("Refund request email failed", err);
      }
    }

    return NextResponse.json({ ok: true, id, status: "pending", tierLabel, postCancelPreference });
  } catch (err) {
    console.error("refund-request error", err);
    return NextResponse.json({ error: "Failed to create refund request" }, { status: 500 });
  }
}
