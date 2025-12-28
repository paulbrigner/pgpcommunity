import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { Contract, getAddress, isAddress } from "ethers";
import { BASE_NETWORK_ID, BASE_RPC_URL, NEXTAUTH_SECRET } from "@/lib/config";
import { getRpcProvider } from "@/lib/rpc/provider";

export const runtime = "nodejs";

const LOCK_ABI = ["function getHasValidKey(address _owner) view returns (bool)"] as const;
const provider = BASE_RPC_URL ? getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID) : null;

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
  if (!token?.sub) {
    return jsonError(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
  }

  if (!provider) {
    return jsonError(500, { error: "RPC provider unavailable.", code: "RPC_UNAVAILABLE" });
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
  const reader = new Contract(lockChecksum, LOCK_ABI, provider);

  let registered = false;
  let errors = 0;
  for (const recipient of normalized) {
    try {
      const hasKey = await reader.getHasValidKey(recipient);
      if (hasKey) {
        registered = true;
        break;
      }
    } catch {
      errors += 1;
    }
  }

  return NextResponse.json(
    { registered, checked: normalized.length, errors },
    { headers: { "Cache-Control": "no-store" } },
  );
}
