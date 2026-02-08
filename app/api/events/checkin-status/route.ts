import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { Contract, getAddress, isAddress } from "ethers";
import {
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  NEXTAUTH_SECRET,
} from "@/lib/config";
import { getRpcProvider } from "@/lib/rpc/provider";
import { isAllowedEventLock } from "@/lib/events/discovery";
import { getCheckIn } from "@/lib/events/checkin-store";
import { fetchSubgraph } from "@/lib/subgraph/client";

export const runtime = "nodejs";

const LOCK_ABI = [
  "function tokenOfOwnerByIndex(address _keyOwner, uint256 _index) view returns (uint256)",
] as const;

async function fetchTokenIdFromSubgraph(
  lockAddressLower: string,
  ownerLower: string,
): Promise<string | null> {
  try {
    const body = JSON.stringify({
      query: `query TokenIdForOwner($lock: String!, $owner: String!) {
        keys(first: 1, where: { lock: $lock, owner: $owner }, orderBy: createdAtBlock, orderDirection: desc) {
          tokenId
        }
      }`,
      variables: { lock: lockAddressLower, owner: ownerLower },
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

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
  if (!token?.sub) {
    return jsonError(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
  }

  const { searchParams } = new URL(request.url);
  const rawLock = searchParams.get("lockAddress")?.trim() || "";
  const rawTokenId = searchParams.get("tokenId")?.trim() || "";
  if (!rawLock || !isAddress(rawLock)) {
    return jsonError(400, { error: "Valid lockAddress required.", code: "INVALID_LOCK" });
  }

  const lockChecksum = getAddress(rawLock);
  const lockLower = lockChecksum.toLowerCase();
  if (!(await isAllowedEventLock(lockLower))) {
    return jsonError(404, { error: "Event not found." });
  }

  let resolvedTokenId: string | null = rawTokenId || null;

  // If no tokenId provided, try to resolve from recipients (wallets)
  if (!resolvedTokenId) {
    const rawRecipients = searchParams.get("recipients")?.trim() || "";
    const recipients = rawRecipients
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && isAddress(s))
      .map((s) => getAddress(s));

    if (recipients.length) {
      const provider = getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
      const lockReader = new Contract(lockChecksum, LOCK_ABI, provider);

      for (const recipient of recipients) {
        const recipientLower = recipient.toLowerCase();
        resolvedTokenId = await fetchTokenIdFromSubgraph(lockLower, recipientLower);
        if (resolvedTokenId) break;
        try {
          const tid = await lockReader.tokenOfOwnerByIndex(recipient, 0n);
          if (tid != null) {
            resolvedTokenId = typeof tid === "bigint" ? tid.toString() : String(tid);
            break;
          }
        } catch {
          // continue
        }
      }
    }
  }

  if (!resolvedTokenId) {
    return NextResponse.json(
      { registered: false, tokenId: null, checkedIn: false, checkedInAt: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Check local DB first
  const localRecord = await getCheckIn(lockLower, resolvedTokenId);
  if (localRecord) {
    return NextResponse.json(
      {
        registered: true,
        tokenId: resolvedTokenId,
        checkedIn: true,
        checkedInAt: localRecord.checkedInAt,
        method: localRecord.method,
        source: "local",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      registered: true,
      tokenId: resolvedTokenId,
      checkedIn: false,
      checkedInAt: null,
      source: "local",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Keep POST for backward compatibility during transition
export async function POST(request: NextRequest) {
  const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
  if (!token?.sub) {
    return jsonError(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
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

  const provider = getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
  const lockReader = new Contract(lockChecksum, LOCK_ABI, provider);

  let resolvedTokenId: string | null = null;
  for (const recipient of normalized) {
    const recipientLower = recipient.toLowerCase();
    resolvedTokenId = await fetchTokenIdFromSubgraph(lockLower, recipientLower);
    if (resolvedTokenId) break;
    try {
      const tid = await lockReader.tokenOfOwnerByIndex(recipient, 0n);
      if (tid != null) {
        resolvedTokenId = typeof tid === "bigint" ? tid.toString() : String(tid);
        break;
      }
    } catch {
      // continue
    }
  }

  if (!resolvedTokenId) {
    return NextResponse.json(
      { registered: false, tokenId: null, checkedIn: null, checkedInAt: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Check local DB
  const localRecord = await getCheckIn(lockLower, resolvedTokenId);
  if (localRecord) {
    return NextResponse.json(
      {
        registered: true,
        tokenId: resolvedTokenId,
        checkedIn: true,
        checkedInAt: localRecord.checkedInAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      registered: true,
      tokenId: resolvedTokenId,
      checkedIn: false,
      checkedInAt: null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
