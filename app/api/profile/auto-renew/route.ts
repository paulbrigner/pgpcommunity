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
    if (!token?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body.preference !== 'string') {
      return NextResponse.json({ error: "Missing preference" }, { status: 400 });
    }
    const preference = body.preference as string;
    if (preference !== 'enabled' && preference !== 'skipped' && preference !== 'clear') {
      return NextResponse.json({ error: "Invalid preference" }, { status: 400 });
    }

    const adapter: any = DynamoDBAdapter(documentClient as any, {
      tableName: NEXTAUTH_TABLE || "NextAuth",
    });

    await adapter.updateUser({
      id: token.sub,
      autoRenewPreference: preference === 'clear' ? null : preference,
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('auto-renew preference update failed:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
