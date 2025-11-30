import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/auth";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import { isLockManager } from "@/lib/admin/lock-manager";

export const dynamic = "force-dynamic";

type RefundRequest = {
  id: string;
  userId: string;
  email: string | null;
  wallet: string | null;
  tierId: string | null;
  tierLabel: string | null;
  lockAddress: string | null;
  activeLocks?: Array<{ lockAddress: string; tierId: string | null; tierLabel: string | null }>;
  status: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
};

async function listRequests(): Promise<RefundRequest[]> {
  const items: RefundRequest[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await documentClient.query({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "#gsi1pk = :pk",
      ExpressionAttributeNames: { "#gsi1pk": "GSI1PK" },
      ExpressionAttributeValues: { ":pk": "REFUND_REQUEST" },
      ExclusiveStartKey,
    });
    if (res.Items) {
      for (const item of res.Items) {
        const id = String((item as any).pk || "").replace("REFUND_REQUEST#", "");
        items.push({
          id,
          userId: String((item as any).userId || ""),
          email: (item as any).email || null,
          wallet: (item as any).wallet || null,
          tierId: (item as any).tierId || null,
          tierLabel: (item as any).tierLabel || null,
          lockAddress: (item as any).lockAddress || null,
          activeLocks: Array.isArray((item as any).activeLocks)
            ? ((item as any).activeLocks as any[])
                .map((entry) => ({
                  lockAddress: entry?.lockAddress,
                  tierId: entry?.tierId || null,
                  tierLabel: entry?.tierLabel || null,
                }))
                .filter((entry) => !!entry.lockAddress)
            : [],
          status: (item as any).status || "pending",
          reason: (item as any).reason || null,
          createdAt: (item as any).createdAt || "",
          updatedAt: (item as any).updatedAt || "",
        });
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);
  return items;
}

export async function GET() {
  try {
    const session = await requireAdminSession();
    const adminWallet = (session.user as any)?.walletAddress || (Array.isArray((session.user as any)?.wallets) ? (session.user as any)?.wallets[0] : null);
    const requests = await listRequests();
    const enriched = await Promise.all(
      requests.map(async (req) => {
        const locksToCheck = (req.activeLocks && req.activeLocks.length ? req.activeLocks.map((l) => l.lockAddress) : [req.lockAddress]).filter(Boolean) as string[];
        let canExecute = false;
        for (const lock of locksToCheck) {
          if (await isLockManager(lock, adminWallet)) {
            canExecute = true;
            break;
          }
        }
        return { ...req, canExecute };
      }),
    );
    return NextResponse.json({ requests: enriched, adminWallet });
  } catch (err) {
    if ((err as any)?.name === "AdminAccessError") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    console.error("Refund requests list error", err);
    return NextResponse.json({ error: "Failed to load refund requests" }, { status: 500 });
  }
}
