import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, requireAdminSession } from "@/lib/admin/auth";
import { buildAdminMembersByIds } from "@/lib/admin/roster";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireAdminSession();
  } catch (err) {
    if (err instanceof AdminAccessError) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const userIds: string[] = Array.isArray(body?.userIds)
      ? Array.from(
          new Set(
            body.userIds
              .map((id: unknown) => (typeof id === "string" ? id.trim() : ""))
              .filter((id: string): id is string => id.length > 0),
          ),
        )
      : [];
    if (!userIds.length) {
      return NextResponse.json({ error: "userIds is required" }, { status: 400 });
    }

    const fields = Array.isArray(body?.fields)
      ? new Set(
          body.fields
            .map((f: any) => (typeof f === "string" ? f.trim().toLowerCase() : ""))
            .filter(Boolean)
            .map((v: string) => (v === "token-ids" || v === "token_ids" ? "tokenids" : v)),
        )
      : new Set<string>();

    const hasFields = fields.size > 0;
    const hasAll = fields.has("all");
    const hasCore = fields.has("core");
    const includeAllowances = hasCore ? false : hasFields ? hasAll || fields.has("allowances") : true;
    const includeBalances = hasCore ? false : hasFields ? hasAll || fields.has("balances") : true;
    const includeTokenIds = hasCore ? false : hasFields ? hasAll || fields.has("tokenids") : false;

    const members = await buildAdminMembersByIds(userIds, {
      includeAllowances,
      includeBalances,
      includeTokenIds,
    });

    return NextResponse.json({ members });
  } catch (err) {
    console.error("Admin roster detail fetch failed", err);
    return NextResponse.json({ error: "Failed to load member details" }, { status: 500 });
  }
}
