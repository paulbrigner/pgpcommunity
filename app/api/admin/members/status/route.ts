import { NextResponse } from "next/server";
import { AdminAccessError, requireAdminSession } from "@/lib/admin/auth";
import { getRosterCacheConfig, loadRosterCacheStatus } from "@/lib/admin/roster-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminSession();
    const config = getRosterCacheConfig();
    const cache = await loadRosterCacheStatus(config);
    return NextResponse.json({ cache });
  } catch (err) {
    if (err instanceof AdminAccessError) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    console.error("Failed to load admin cache status", err);
    return NextResponse.json({ error: "Failed to load admin cache status" }, { status: 500 });
  }
}
