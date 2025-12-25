import { NextResponse } from "next/server";
import { AdminAccessError, requireAdminSession } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await requireAdminSession();
    const endpoint = process.env.ADMIN_ROSTER_REBUILD_URL;
    const secret = process.env.ADMIN_ROSTER_REBUILD_SECRET;
    if (!endpoint || !secret) {
      return NextResponse.json(
        { error: "Roster rebuild is not configured." },
        { status: 500 }
      );
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-roster-key": secret,
      },
      body: JSON.stringify({ source: "admin-ui", requestedAt: new Date().toISOString() }),
      cache: "no-store",
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: payload?.error || `Roster rebuild failed (${res.status})` },
        { status: res.status }
      );
    }
    return NextResponse.json({ ok: true, result: payload });
  } catch (err) {
    if (err instanceof AdminAccessError) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    console.error("Failed to trigger roster rebuild", err);
    return NextResponse.json({ error: "Failed to trigger roster rebuild" }, { status: 500 });
  }
}
