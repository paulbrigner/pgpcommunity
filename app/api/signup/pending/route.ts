import { NextRequest, NextResponse } from "next/server";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";

const PK_PREFIX = "PENDING_SIGNUP#";

export async function POST(req: NextRequest) {
  try {
    const { email, wallet } = await req.json();
    if (!email || !wallet) {
      return NextResponse.json({ error: "email and wallet are required" }, { status: 400 });
    }
    const emailLower = String(email).trim().toLowerCase();
    const walletLower = String(wallet).trim().toLowerCase();
    if (!/.+@.+\..+/.test(emailLower)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    if (!/^0x[a-f0-9]{40}$/.test(walletLower)) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }

    const key = `${PK_PREFIX}${emailLower}`;
    await documentClient.put({
      TableName: TABLE_NAME,
      Item: {
        pk: key,
        sk: key,
        type: "PENDING_SIGNUP",
        email: emailLower,
        wallet: walletLower,
        createdAt: new Date().toISOString(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "Failed to store pending signup";
    console.error("/api/signup/pending error:", msg);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
