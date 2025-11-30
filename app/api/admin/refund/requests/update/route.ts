import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/auth";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const status = typeof body?.status === "string" ? body.status.trim() : "";
    if (!id || !status) {
      return NextResponse.json({ error: "id and status are required" }, { status: 400 });
    }
    const allowed = new Set(["pending", "processing", "completed", "rejected"]);
    if (!allowed.has(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const now = new Date().toISOString();
    await documentClient.update({
      TableName: TABLE_NAME,
      Key: { pk: `REFUND_REQUEST#${id}`, sk: `REFUND_REQUEST#${id}` },
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": status, ":updatedAt": now },
    });
    return NextResponse.json({ ok: true, id, status });
  } catch (err) {
    console.error("Refund request update error", err);
    return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
  }
}
