import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { DynamoDBAdapter } from "@next-auth/dynamodb-adapter";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { AWS_REGION, NEXTAUTH_SECRET, NEXTAUTH_TABLE } from "@/lib/config";

const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const documentClient = DynamoDBDocument.from(dynamoClient);

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Derive walletAddress from token if present; otherwise look up first linked wallet
    let walletAddress = (token as any).walletAddress || null;
    if (!walletAddress && (token as any).sub) {
      try {
        const adapter: any = DynamoDBAdapter(documentClient as any, {
          tableName: NEXTAUTH_TABLE || "NextAuth",
        });
        const user = await adapter.getUser((token as any).sub);
        const wallets = Array.isArray((user as any)?.wallets)
          ? ((user as any).wallets as string[])
          : [];
        walletAddress = wallets[0] || null;
      } catch (e) {
        console.error("/api/identityTest: failed to derive walletAddress", e);
      }
    }
    return NextResponse.json({
      userId: (token as any).sub,
      user: {
        email: (token as any).email || null,
        walletAddress,
      },
      claims: token,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("/api/identityTest error:", message);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
