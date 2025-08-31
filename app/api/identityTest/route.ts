import { NextRequest, NextResponse } from "next/server";
import { verifyIdentity } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    // Accept identity token via cookie or header; verify with shared helper
    const user = await verifyIdentity(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ userId: user.id, user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("/api/identityTest error:", message);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
