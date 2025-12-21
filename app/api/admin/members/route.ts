import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, requireAdminSession } from "@/lib/admin/auth";
import { buildAdminRoster } from "@/lib/admin/roster";

export const dynamic = "force-dynamic";

function parseFields(value: string | null): Set<string> {
  return new Set(
    (value || "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
      .map((v) => (v === "token-ids" || v === "token_ids" ? "tokenids" : v)),
  );
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminSession();
    const searchParams = request.nextUrl.searchParams;
    const fields = parseFields(searchParams.get("fields"));
    const statusParam = (searchParams.get("status") || "").toLowerCase();
    const refreshParam = (searchParams.get("refresh") || "").toLowerCase();
    const preferStaleParam = (searchParams.get("preferStale") || searchParams.get("prefer_stale") || "").toLowerCase();
    const triggerRebuildParam = (searchParams.get("triggerRebuild") || searchParams.get("trigger_rebuild") || "").toLowerCase();
    const forceRebuildParam = (searchParams.get("forceRebuild") || searchParams.get("force_rebuild") || "").toLowerCase();
    const allowedStatuses = new Set(["active", "expired", "none", "all"]);
    const statusFilter = allowedStatuses.has(statusParam) ? (statusParam as any) : "all";
    const forceRefresh = refreshParam === "1" || refreshParam === "true" || refreshParam === "yes";
    const preferStale = preferStaleParam === "1" || preferStaleParam === "true" || preferStaleParam === "yes";
    const triggerRebuild = triggerRebuildParam === "1" || triggerRebuildParam === "true" || triggerRebuildParam === "yes";
    const forceRebuild = forceRebuildParam === "1" || forceRebuildParam === "true" || forceRebuildParam === "yes";

    const hasFields = fields.size > 0;
    const hasAll = fields.has("all");
    const hasCore = fields.has("core");
    const includeAllowances = hasCore ? false : hasFields ? hasAll || fields.has("allowances") : true;
    const includeBalances = hasCore ? false : hasFields ? hasAll || fields.has("balances") : true;
    const includeTokenIds = hasCore ? false : hasFields ? hasAll || fields.has("tokenids") : true;

    const roster = await buildAdminRoster({
      includeAllowances,
      includeBalances,
      includeTokenIds,
      statusFilter,
      forceRefresh,
      preferStale,
      triggerRebuild,
      forceRebuild,
    });
    return NextResponse.json(roster);
  } catch (err) {
    if (err instanceof AdminAccessError) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    console.error("Failed to load admin roster", err);
    return NextResponse.json({ error: "Failed to load admin roster" }, { status: 500 });
  }
}
