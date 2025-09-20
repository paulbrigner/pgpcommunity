import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { DynamoDBAdapter } from "@next-auth/dynamodb-adapter";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { AWS_REGION, NEXTAUTH_SECRET, NEXTAUTH_TABLE } from "@/lib/config";

const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const documentClient = DynamoDBDocument.from(dynamoClient);

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    if (!token?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { firstName, lastName } = body || {};
    let { xHandle, linkedinUrl } = body || {};

    // Basic validations
    const err = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });
    if (!firstName || typeof firstName !== "string" || firstName.trim().length < 1) return err("First name is required");
    if (!lastName || typeof lastName !== "string" || lastName.trim().length < 1) return err("Last name is required");
    if (xHandle && typeof xHandle === "string") {
      // Normalize: ensure it starts with '@'
      xHandle = xHandle.trim();
      if (xHandle && !xHandle.startsWith("@")) xHandle = `@${xHandle}`;
      if (xHandle.length > 50) return err("X handle too long");
    }
    if (linkedinUrl && typeof linkedinUrl === "string") {
      linkedinUrl = linkedinUrl.trim();
      try {
        const u = new URL(linkedinUrl);
        if (!/^https?:$/.test(u.protocol)) return err("LinkedIn URL must be http(s)");
      } catch {
        return err("Invalid LinkedIn URL");
      }
    }

    const adapter: any = DynamoDBAdapter(documentClient as any, {
      tableName: NEXTAUTH_TABLE || "NextAuth",
    });

    const name = `${firstName.trim()} ${lastName.trim()}`.trim();
    const updated = await adapter.updateUser({
      id: token.sub,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      xHandle: xHandle || null,
      linkedinUrl: linkedinUrl || null,
      name,
    });

    return NextResponse.json({ ok: true, user: { id: updated.id, firstName: updated.firstName, lastName: updated.lastName, xHandle: updated.xHandle, linkedinUrl: updated.linkedinUrl } });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
    console.error("/api/profile/update error:", msg);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
