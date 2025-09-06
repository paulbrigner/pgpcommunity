import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { SiweMessage } from "siwe";
import { DynamoDBAdapter } from "@next-auth/dynamodb-adapter";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import {
  AWS_REGION,
  NEXTAUTH_SECRET,
  NEXTAUTH_TABLE,
  NEXTAUTH_URL,
} from "@/lib/config";

const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const documentClient = DynamoDBDocument.from(dynamoClient);

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    if (!token?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { message, signature } = await request.json();
    if (!message || !signature) {
      return NextResponse.json({ error: "Missing message or signature" }, { status: 400 });
    }

    const siwe = new SiweMessage(typeof message === "string" ? JSON.parse(message) : message);

    // Determine expected domain and SIWE nonce (prefer NextAuth CSRF cookie)
    const host = request.headers.get("host") || NEXTAUTH_URL || "localhost";
    const domain = String(host).replace(/^https?:\/\//, "");
    const rawCsrf = request.cookies.get("next-auth.csrf-token")?.value;
    const csrfToken = rawCsrf ? rawCsrf.split("|")[0] : undefined;

    const result = await siwe.verify({
      signature,
      domain,
      nonce: csrfToken ?? siwe.nonce,
    });
    if (!result.success) {
      return NextResponse.json({ error: "SIWE verification failed" }, { status: 401 });
    }

    const address = siwe.address.toLowerCase();

    const adapter: any = DynamoDBAdapter(documentClient as any, {
      tableName: NEXTAUTH_TABLE || "NextAuth",
    });

    // Check if this wallet is already linked to a user
    const existing = await adapter.getUserByAccount({
      provider: "ethereum",
      providerAccountId: address,
    });

    if (existing && existing.id !== token.sub) {
      return NextResponse.json(
        { error: "Wallet already linked to another account" },
        { status: 409 }
      );
    }

    // If not linked yet, link now
    if (!existing) {
      await adapter.linkAccount({
        userId: token.sub,
        type: "credentials",
        provider: "ethereum",
        providerAccountId: address,
      });
    }

    // Maintain a denormalized list of wallets on the User for easy session exposure
    try {
      const user = await adapter.getUser(token.sub);
      const current = Array.isArray((user as any)?.wallets)
        ? ((user as any).wallets as string[])
        : [];
      if (!current.includes(address)) {
        const updated = [...current, address];
        await adapter.updateUser({ id: token.sub, wallets: updated });
      }
    } catch (e) {
      console.error("link-wallet: failed to update user wallets array", e);
    }

    return NextResponse.json({ ok: true, address });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
    console.error("/api/auth/link-wallet error:", msg);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
