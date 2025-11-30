import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/auth";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import { membershipStateService } from "@/lib/membership-state-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

    const res = await documentClient.get({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
    });
    const user = res.Item || {};
    const wallets: string[] = Array.isArray((user as any).wallets)
      ? (user as any).wallets.map((w: any) => String(w).toLowerCase())
      : [];
    const primary = typeof (user as any).walletAddress === "string" ? (user as any).walletAddress.toLowerCase() : wallets[0] || null;
    const addresses = wallets.length ? wallets : primary ? [primary] : [];
    if (!addresses.length) {
      return NextResponse.json({ error: "No wallets linked for this user" }, { status: 400 });
    }

    const snapshot = await membershipStateService.getState({ addresses, forceRefresh: true });
    const tokenIds: Record<string, string[]> = {};
    const activeLocks = new Set<string>();
    snapshot.tiers.forEach((tier) => {
      tokenIds[tier.tier.checksumAddress.toLowerCase()] = tier.tokenIds;
      if (tier.status === "active") {
        activeLocks.add(tier.tier.checksumAddress.toLowerCase());
      }
    });

    return NextResponse.json({ tokenIds, activeLocks: Array.from(activeLocks), snapshot });
  } catch (err) {
    console.error("Admin tokenIds fetch error", err);
    return NextResponse.json({ error: "Failed to fetch token ids" }, { status: 500 });
  }
}
