import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { DynamoDBAdapter } from "@next-auth/dynamodb-adapter";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import {
  AWS_REGION,
  NEXTAUTH_SECRET,
  NEXTAUTH_TABLE,
  MEMBERSHIP_TIERS,
} from "@/lib/config";

const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const documentClient = DynamoDBDocument.from(dynamoClient);

const normalize = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
};

const resolveTierId = (input: string | null | undefined): string | null => {
  const normalized = normalize(input);
  if (!normalized) return null;
  const match = MEMBERSHIP_TIERS.find((tier) => {
    const id = normalize(tier.id);
    const address = normalize(tier.address);
    const checksum = normalize(tier.checksumAddress);
    return normalized === id || normalized === address || normalized === checksum;
  });
  return match ? match.id : null;
};

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    if (!token?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Missing tier selection" }, { status: 400 });
    }

    const readField = (keys: string[]) => {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          return (body as any)[key];
        }
      }
      return undefined;
    };

    const rawCurrent = readField(["currentTierId", "currentTierAddress"]);
    const rawDesired = readField(["desiredTierId", "desiredTierAddress"]);
    const rawLegacy = rawCurrent === undefined && rawDesired === undefined ? readField(["tierId", "tierAddress"]) : undefined;

    const resolveInput = (value: unknown) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value !== "string") return undefined;
      return resolveTierId(value);
    };

    const currentTierId = resolveInput(rawCurrent ?? rawLegacy);
    const desiredTierId = resolveInput(rawDesired ?? rawLegacy);

    if ((rawCurrent ?? rawLegacy) && currentTierId === null) {
      return NextResponse.json({ error: "Unknown current membership tier" }, { status: 400 });
    }
    if ((rawDesired ?? rawLegacy) && desiredTierId === null) {
      return NextResponse.json({ error: "Unknown desired membership tier" }, { status: 400 });
    }

    const adapter: any = DynamoDBAdapter(documentClient as any, {
      tableName: NEXTAUTH_TABLE || "NextAuth",
    });

    const userRecord = await adapter.getUser(token.sub);
    const existingCurrent = normalize((userRecord as any)?.currentMembershipTierId);
    const existingLast = normalize((userRecord as any)?.lastMembershipTierId);

    const updates: Record<string, any> = { id: token.sub };
    let changed = false;

    if (rawCurrent !== undefined || rawLegacy !== undefined) {
      const normalizedCurrent = normalize(currentTierId ?? null);
      if (normalizedCurrent !== (existingCurrent ?? null)) {
        updates.currentMembershipTierId = currentTierId ?? null;
        changed = true;
      }
    }

    if (rawDesired !== undefined || rawLegacy !== undefined) {
      const normalizedDesired = normalize(desiredTierId ?? null);
      if (normalizedDesired !== (existingLast ?? null)) {
        updates.lastMembershipTierId = desiredTierId ?? null;
        changed = true;
      }
    }

    if (changed) {
      await adapter.updateUser(updates);
    }

    return NextResponse.json({
      ok: true,
      changed,
      currentTierId: rawCurrent !== undefined || rawLegacy !== undefined ? currentTierId ?? null : existingCurrent ?? null,
      desiredTierId: rawDesired !== undefined || rawLegacy !== undefined ? desiredTierId ?? null : existingLast ?? null,
    });
  } catch (error) {
    console.error("membership tier preference update failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
