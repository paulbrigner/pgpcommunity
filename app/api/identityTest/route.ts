import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { NEXTAUTH_SECRET } from "@/lib/config";

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({
      userId: (token as any).sub,
      user: {
        email: (token as any).email || null,
        walletAddress: (token as any).walletAddress || null,
      },
      claims: token,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("/api/identityTest error:", message);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
