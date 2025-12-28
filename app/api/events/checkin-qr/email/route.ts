import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - nodemailer types not installed
import nodemailer from "nodemailer";
import { Contract, Wallet, getAddress, isAddress } from "ethers";
import { SiweMessage } from "siwe";
import {
  BASE_NETWORK_ID,
  EMAIL_FROM,
  EMAIL_SERVER,
  EMAIL_SERVER_HOST,
  EMAIL_SERVER_PASSWORD,
  EMAIL_SERVER_PORT,
  EMAIL_SERVER_SECURE,
  EMAIL_SERVER_USER,
  LOCKSMITH_BASE_URL,
  MEMBERSHIP_TIER_ADDRESSES,
  NEXTAUTH_SECRET,
  PRIMARY_LOCK_ADDRESS,
  UNLOCK_SUBGRAPH_API_KEY,
  UNLOCK_SUBGRAPH_ID,
  UNLOCK_SUBGRAPH_URL,
} from "@/lib/config";
import { recordEmailEvent } from "@/lib/admin/email-log";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import { getRpcProvider } from "@/lib/rpc/provider";
import { recordSponsorAction } from "@/lib/sponsor/audit";
import { getEventSponsorConfig } from "@/lib/sponsor/config";

export const runtime = "nodejs";

const LOCK_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function isValidKey(uint256 tokenId) view returns (bool)",
  "function isLockManager(address account) view returns (bool)",
  "function owner() view returns (address)",
] as const;

const GRAPH_GATEWAY_BASE = "https://gateway.thegraph.com/api/subgraphs/id";
const RESOLVED_SUBGRAPH_URL =
  UNLOCK_SUBGRAPH_URL ||
  (UNLOCK_SUBGRAPH_ID ? `${GRAPH_GATEWAY_BASE}/${UNLOCK_SUBGRAPH_ID}` : BASE_NETWORK_ID ? `https://subgraph.unlock-protocol.com/${BASE_NETWORK_ID}` : null);

const SUBGRAPH_AUTH_HEADERS = UNLOCK_SUBGRAPH_API_KEY
  ? { Authorization: `Bearer ${UNLOCK_SUBGRAPH_API_KEY}` }
  : undefined;

async function fetchSubgraph(body: string) {
  if (!RESOLVED_SUBGRAPH_URL) {
    throw new Error("Unlock subgraph URL not configured");
  }
  return fetch(RESOLVED_SUBGRAPH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SUBGRAPH_AUTH_HEADERS ?? {}),
    },
    body,
    cache: "no-store",
  });
}

type LockSubgraphInfo = {
  deployer: string | null;
  lockManagers: string[];
};

let cachedPrimaryDeployer: string | null = null;
let cachedPrimaryOwner: string | null = null;

async function getPrimaryLockDeployer(): Promise<string | null> {
  if (cachedPrimaryDeployer) return cachedPrimaryDeployer;
  if (!RESOLVED_SUBGRAPH_URL || !PRIMARY_LOCK_ADDRESS) return null;
  try {
    const body = JSON.stringify({
      query: `query LockDeployer($address: String!) {
        locks(first: 1, where: { address: $address }) {
          deployer
        }
      }`,
      variables: { address: PRIMARY_LOCK_ADDRESS.toLowerCase() },
    });
    const res = await fetchSubgraph(body);
    if (!res.ok) return null;
    const json = await res.json();
    const deployer = json?.data?.locks?.[0]?.deployer;
    if (typeof deployer === "string" && deployer.length) {
      cachedPrimaryDeployer = deployer.toLowerCase();
    }
  } catch {
    cachedPrimaryDeployer = null;
  }
  return cachedPrimaryDeployer;
}

async function getPrimaryLockOwner(provider: any): Promise<string | null> {
  if (cachedPrimaryOwner) return cachedPrimaryOwner;
  if (!PRIMARY_LOCK_ADDRESS) return null;
  try {
    const lock = new Contract(PRIMARY_LOCK_ADDRESS, ["function owner() view returns (address)"], provider);
    const owner: string = await lock.owner();
    cachedPrimaryOwner = owner ? owner.toLowerCase() : null;
  } catch {
    cachedPrimaryOwner = null;
  }
  return cachedPrimaryOwner;
}

async function fetchLockInfoFromSubgraph(lockAddressLower: string): Promise<LockSubgraphInfo | null> {
  if (!RESOLVED_SUBGRAPH_URL) return null;
  try {
    const body = JSON.stringify({
      query: `query LockInfo($address: String!) {
        locks(first: 1, where: { address: $address }) {
          deployer
          lockManagers
        }
      }`,
      variables: { address: lockAddressLower },
    });
    const res = await fetchSubgraph(body);
    if (!res.ok) return null;
    const json = await res.json();
    const lock = json?.data?.locks?.[0];
    if (!lock) return null;
    const deployer = typeof lock?.deployer === "string" && lock.deployer.length ? lock.deployer.toLowerCase() : null;
    const lockManagers = Array.isArray(lock?.lockManagers)
      ? lock.lockManagers.map((addr: any) => String(addr).toLowerCase()).filter(Boolean)
      : [];
    return { deployer, lockManagers };
  } catch {
    return null;
  }
}

async function isAllowedEventLock(lockAddressLower: string, provider: any): Promise<boolean> {
  if (MEMBERSHIP_TIER_ADDRESSES.has(lockAddressLower)) return false;

  const [primaryDeployer, primaryOwner] = await Promise.all([
    getPrimaryLockDeployer(),
    getPrimaryLockOwner(provider),
  ]);

  const subgraphInfo = await fetchLockInfoFromSubgraph(lockAddressLower);
  if (subgraphInfo) {
    if (primaryDeployer && subgraphInfo.deployer === primaryDeployer) return true;
    if (primaryOwner && subgraphInfo.lockManagers.includes(primaryOwner)) return true;
    return false;
  }

  if (primaryOwner) {
    try {
      const lock = new Contract(lockAddressLower, LOCK_ABI, provider);
      const [owner, manager] = await Promise.all([
        lock.owner().catch(() => null),
        lock.isLockManager(primaryOwner).catch(() => false),
      ]);
      if (typeof owner === "string" && owner.toLowerCase() === primaryOwner) return true;
      if (manager === true) return true;
    } catch {}
  }

  return false;
}

type CachedLocksmithToken = {
  walletAddressLower: string;
  accessToken: string;
  obtainedAt: number;
};

let cachedLocksmithToken: CachedLocksmithToken | null = null;
const LOCKSMITH_TOKEN_TTL_MS = 10 * 60 * 1000;

async function loginToLocksmith(params: { sponsor: Wallet; chainId: number; baseUrl: string }): Promise<string> {
  const { sponsor, chainId, baseUrl } = params;
  const walletAddressLower = sponsor.address.toLowerCase();
  const cached = cachedLocksmithToken;
  if (cached && cached.walletAddressLower === walletAddressLower && Date.now() - cached.obtainedAt < LOCKSMITH_TOKEN_TTL_MS) {
    return cached.accessToken;
  }

  const nonceRes = await fetch(`${baseUrl}/v2/auth/nonce`, { cache: "no-store" });
  if (!nonceRes.ok) {
    throw new Error(`Locksmith nonce fetch failed (${nonceRes.status}).`);
  }
  const nonce = (await nonceRes.text()).trim();
  if (!nonce) {
    throw new Error("Locksmith nonce response was empty.");
  }

  const domain = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "locksmith.unlock-protocol.com";
    }
  })();

  const message = new SiweMessage({
    domain,
    address: sponsor.address,
    statement: "Sign in to Unlock",
    uri: baseUrl,
    version: "1",
    chainId,
    nonce,
  });
  const prepared = message.prepareMessage();
  const signature = await sponsor.signMessage(prepared);

  const loginRes = await fetch(`${baseUrl}/v2/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: prepared, signature }),
    cache: "no-store",
  });
  if (!loginRes.ok) {
    const detail = await loginRes.text().catch(() => "");
    throw new Error(`Locksmith login failed (${loginRes.status}): ${detail || "Unknown error"}`);
  }
  const payload = await loginRes.json().catch(() => ({} as any));
  const accessToken = typeof payload?.accessToken === "string" && payload.accessToken.length ? payload.accessToken : null;
  if (!accessToken) {
    throw new Error("Locksmith login did not return an accessToken.");
  }

  cachedLocksmithToken = { walletAddressLower, accessToken, obtainedAt: Date.now() };
  return accessToken;
}

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
  const sponsorConfig = getEventSponsorConfig();

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
    const addresses = Array.from(new Set([walletAddress, ...wallets].filter((value) => typeof value === "string" && value.length)));
    if (!addresses.length) {
      return jsonError(400, { error: "No wallet linked.", code: "NO_WALLET" });
    }

    if (!sponsorConfig.enabled) {
      return jsonError(503, { error: "QR email sending is temporarily disabled.", code: "SPONSOR_DISABLED" });
    }
    if (!sponsorConfig.privateKey) {
      return jsonError(500, { error: "Sponsor wallet not configured.", code: "SPONSOR_NOT_CONFIGURED" });
    }

    const provider = getRpcProvider(sponsorConfig.rpcUrl, sponsorConfig.chainId);
    const sponsor = new Wallet(sponsorConfig.privateKey, provider);
    const sponsorAddressLower = sponsor.address.toLowerCase();

    if (!(await isAllowedEventLock(lockLower, provider))) {
      return jsonError(403, { error: "This event lock is not eligible for check-in QR emails.", code: "EVENT_LOCK_NOT_ALLOWED" });
    }

    const lockReader = new Contract(lockChecksum, LOCK_ABI, provider);
    const [tokenOwner, sponsorIsManager, isValidKey] = await Promise.all([
      lockReader.ownerOf(tokenId).catch(() => null),
      lockReader.isLockManager(sponsorAddressLower).catch(() => false),
      lockReader.isValidKey(tokenId).catch(() => false),
    ]);
    if (!sponsorIsManager) {
      return jsonError(500, {
        error: "Sponsor wallet must be a lock manager for this event lock to email check-in QR codes.",
        code: "SPONSOR_NOT_MANAGER",
        sponsorAddress: sponsor.address,
        lockAddress: lockChecksum,
      });
    }
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

    const locksmithBase = (LOCKSMITH_BASE_URL || "https://locksmith.unlock-protocol.com").replace(/\/+$/, "");
    let accessToken = await loginToLocksmith({ sponsor, chainId: sponsorConfig.chainId, baseUrl: locksmithBase });

    const ticketUrl = `${locksmithBase}/v2/api/ticket/${sponsorConfig.chainId}/${lockChecksum}/${tokenId.toString()}/qr`;
    let res = await fetch(ticketUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (res.status === 401) {
      cachedLocksmithToken = null;
      accessToken = await loginToLocksmith({ sponsor, chainId: sponsorConfig.chainId, baseUrl: locksmithBase });
      res = await fetch(ticketUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return jsonError(502, {
        error: "Unable to load check-in QR code from Unlock.",
        code: "LOCKSMITH_QR_FAILED",
        status: res.status,
        detail: detail ? detail.slice(0, 500) : null,
      });
    }

    const contentType = res.headers.get("content-type") || "image/gif";
    const bytes = Buffer.from(await res.arrayBuffer());

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
          filename: "event-checkin-qr.gif",
          content: bytes,
          contentType,
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
        contentType,
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
      metadata: {
        tokenId: tokenIdText,
      },
    }).catch(() => {});
    console.error("checkin-qr email failed", { userId, lockAddress: lockChecksum, error: message });
    return jsonError(500, { error: message, code: "UNKNOWN_ERROR" });
  }
}
