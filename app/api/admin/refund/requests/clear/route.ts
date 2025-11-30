import { NextResponse } from "next/server";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import { requireAdminSession } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

async function listRequestKeys(): Promise<Array<{ pk: string; sk: string }>> {
  const keys: Array<{ pk: string; sk: string }> = [];
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
        if (item.pk && item.sk) {
          keys.push({ pk: item.pk as string, sk: item.sk as string });
        }
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);
  return keys;
}

export async function POST() {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const keys = await listRequestKeys();
    if (!keys.length) {
      return NextResponse.json({ ok: true, cleared: 0 });
    }
    // Dynamo batchWrite limit 25 items; chunk
    const chunks: Array<Array<{ pk: string; sk: string }>> = [];
    for (let i = 0; i < keys.length; i += 25) {
      chunks.push(keys.slice(i, i + 25));
    }
    for (const chunk of chunks) {
      const RequestItems: Record<string, any> = {
        [TABLE_NAME]: chunk.map((key) => ({ DeleteRequest: { Key: { pk: key.pk, sk: key.sk } } })),
      };
      await documentClient.batchWrite({ RequestItems });
    }
    return NextResponse.json({ ok: true, cleared: keys.length });
  } catch (err) {
    console.error("Refund requests clear error", err);
    return NextResponse.json({ error: "Failed to clear refund requests" }, { status: 500 });
  }
}
