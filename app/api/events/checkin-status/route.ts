import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { Contract, Wallet, getAddress, isAddress } from "ethers";
import { SiweMessage } from "siwe";
import {
  BASE_NETWORK_ID,
  LOCKSMITH_BASE_URL,
  NEXTAUTH_SECRET,
  UNLOCK_SUBGRAPH_API_KEY,
  UNLOCK_SUBGRAPH_ID,
  UNLOCK_SUBGRAPH_URL,
} from "@/lib/config";
import { getRpcProvider } from "@/lib/rpc/provider";
import { getEventSponsorConfig } from "@/lib/sponsor/config";
import { isAllowedEventLock } from "@/lib/events/discovery";

export const runtime = "nodejs";

const LOCK_ABI = [
  "function tokenOfOwnerByIndex(address _keyOwner, uint256 _index) view returns (uint256)",
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

async function fetchTokenIdFromSubgraph(lockAddressLower: string, ownerLower: string): Promise<string | null> {
  if (!RESOLVED_SUBGRAPH_URL) return null;
  try {
    const body = JSON.stringify({
      query: `query TokenIdForOwner($lock: String!, $owner: String!) {
        keys(first: 1, where: { lock: $lock, owner: $owner }, orderBy: createdAtBlock, orderDirection: desc) {
          tokenId
        }
      }`,
      variables: {
        lock: lockAddressLower,
        owner: ownerLower,
      },
    });
    const res = await fetchSubgraph(body);
    if (!res.ok) return null;
    const json = await res.json();
    const tokenId = json?.data?.keys?.[0]?.tokenId;
    return typeof tokenId === "string" && tokenId.length ? tokenId : null;
  } catch {
    return null;
  }
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

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const sponsorConfig = getEventSponsorConfig();

  const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
  if (!token?.sub) {
    return jsonError(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
  }

  if (!sponsorConfig.enabled) {
    return jsonError(503, { error: "Check-in status is temporarily unavailable.", code: "SPONSOR_DISABLED" });
  }
  if (!sponsorConfig.privateKey) {
    return jsonError(500, { error: "Sponsor wallet not configured.", code: "SPONSOR_NOT_CONFIGURED" });
  }

  const body = await request.json().catch(() => null);
  const rawLock = body?.lockAddress;
  if (!rawLock || !isAddress(rawLock)) {
    return jsonError(400, { error: "Valid lockAddress required.", code: "INVALID_LOCK" });
  }

  const recipients = Array.isArray(body?.recipients) ? body.recipients : [];
  const normalized = recipients
    .map((entry: unknown) => {
      if (typeof entry !== "string") return null;
      const trimmed = entry.trim();
      if (!trimmed || !isAddress(trimmed)) return null;
      return getAddress(trimmed);
    })
    .filter(Boolean) as string[];
  if (!normalized.length) {
    return jsonError(400, { error: "At least one valid recipient required.", code: "MISSING_RECIPIENT" });
  }

  const lockChecksum = getAddress(rawLock);
  const lockLower = lockChecksum.toLowerCase();
  if (!(await isAllowedEventLock(lockLower))) {
    return jsonError(404, { error: "Event not found." });
  }

  const provider = getRpcProvider(sponsorConfig.rpcUrl, sponsorConfig.chainId);
  const lockReader = new Contract(lockChecksum, LOCK_ABI, provider);

  let resolvedTokenId: string | null = null;
  for (const recipient of normalized) {
    const recipientLower = recipient.toLowerCase();
    resolvedTokenId = await fetchTokenIdFromSubgraph(lockLower, recipientLower);
    if (resolvedTokenId) break;
    try {
      const tokenId = await lockReader.tokenOfOwnerByIndex(recipient, 0n);
      if (tokenId != null) {
        resolvedTokenId = (typeof tokenId === "bigint" ? tokenId.toString() : String(tokenId));
        break;
      }
    } catch {
      // ignore and continue
    }
  }

  if (!resolvedTokenId) {
    return NextResponse.json(
      { registered: false, tokenId: null, checkedIn: null, checkedInAt: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const sponsor = new Wallet(sponsorConfig.privateKey, provider);
  const locksmithBase = (LOCKSMITH_BASE_URL || "https://locksmith.unlock-protocol.com").replace(/\/+$/, "");

  let accessToken = await loginToLocksmith({ sponsor, chainId: sponsorConfig.chainId, baseUrl: locksmithBase });
  const ticketUrl = `${locksmithBase}/v2/api/ticket/${sponsorConfig.chainId}/${lockChecksum}/${resolvedTokenId}`;

  let ticketRes = await fetch(ticketUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (ticketRes.status === 401) {
    accessToken = await loginToLocksmith({ sponsor, chainId: sponsorConfig.chainId, baseUrl: locksmithBase });
    ticketRes = await fetch(ticketUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  }

  if (!ticketRes.ok) {
    const detail = await ticketRes.text().catch(() => "");
    return jsonError(ticketRes.status, { error: detail || "Unable to load ticket status." });
  }

  const payload = await ticketRes.json().catch(() => ({} as any));
  const checkedInAt =
    (typeof payload?.checkedInAt === "string" && payload.checkedInAt.length ? payload.checkedInAt : null) ||
    (typeof payload?.checkinAt === "string" && payload.checkinAt.length ? payload.checkinAt : null) ||
    (typeof payload?.checkedInTimestamp === "string" && payload.checkedInTimestamp.length ? payload.checkedInTimestamp : null) ||
    null;
  const hasCheckins = Array.isArray(payload?.checkins) && payload.checkins.length > 0;
  const checkedIn = payload?.checkedIn === true || Boolean(checkedInAt) || hasCheckins;

  return NextResponse.json(
    {
      registered: true,
      tokenId: resolvedTokenId,
      checkedIn,
      checkedInAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
