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

    const { address } = await request.json();
    if (!address || typeof address !== "string") {
      return NextResponse.json({ error: "Missing address" }, { status: 400 });
    }
    const addr = address.toLowerCase();

    const adapter: any = DynamoDBAdapter(documentClient as any, {
      tableName: NEXTAUTH_TABLE || "NextAuth",
    });

    // Ensure the account belongs to this user
    const existingUser = await adapter.getUserByAccount({
      provider: "ethereum",
      providerAccountId: addr,
    });
    if (!existingUser?.id) {
      return NextResponse.json({ error: "Wallet not linked" }, { status: 404 });
    }
    if (existingUser.id !== token.sub) {
      return NextResponse.json({ error: "Wallet belongs to another account" }, { status: 403 });
    }

    // Unlink in Accounts table
    if (typeof adapter.unlinkAccount === "function") {
      await adapter.unlinkAccount({ provider: "ethereum", providerAccountId: addr });
    } else {
      // Fallback: update user wallets array even if adapter lacks unlinkAccount
      console.warn("DynamoDBAdapter missing unlinkAccount; removing from user.wallets only.");
    }

    // Update denormalized wallets array on user
    try {
      const user = await adapter.getUser(token.sub);
      const current = Array.isArray((user as any)?.wallets)
        ? ((user as any).wallets as string[])
        : [];
      const updated = current.filter((w) => w !== addr);
      await adapter.updateUser({ id: token.sub, wallets: updated });
    } catch (e) {
      console.error("unlink-wallet: failed to update user wallets array", e);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
    console.error("/api/auth/unlink-wallet error:", msg);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

