import { NextResponse } from "next/server";
import { AdminAccessError, requireAdminSession } from "@/lib/admin/auth";
import { buildAdminRoster } from "@/lib/admin/roster";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminSession();
    const roster = await buildAdminRoster();
    return NextResponse.json(roster);
  } catch (err) {
    if (err instanceof AdminAccessError) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    console.error("Failed to load admin roster", err);
    return NextResponse.json({ error: "Failed to load admin roster" }, { status: 500 });
  }
}
