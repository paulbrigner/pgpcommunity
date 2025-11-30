import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import { NEXTAUTH_SECRET } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    if (!token?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const items: any[] = [];
    let ExclusiveStartKey: Record<string, any> | undefined;
    do {
      const res = await documentClient.query({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "#gsi1pk = :pk",
        FilterExpression: "userId = :uid",
        ExpressionAttributeNames: { "#gsi1pk": "GSI1PK" },
        ExpressionAttributeValues: { ":pk": "REFUND_REQUEST", ":uid": token.sub },
        ExclusiveStartKey,
      });
      if (res.Items) items.push(...res.Items);
      ExclusiveStartKey = res.LastEvaluatedKey as any;
    } while (ExclusiveStartKey);

    const sorted = items
      .map((item) => ({
        id: String(item.pk || "").replace("REFUND_REQUEST#", ""),
        status: item.status || "pending",
        createdAt: item.createdAt || item.updatedAt || null,
      }))
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    const latest = sorted.length ? sorted[sorted.length - 1] : null;
    return NextResponse.json({ latest });
  } catch (err) {
    console.error("refund-request status error", err);
    return NextResponse.json({ error: "Failed to fetch status" }, { status: 500 });
  }
}
