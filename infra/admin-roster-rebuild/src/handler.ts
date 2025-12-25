import { buildAdminRoster } from "@/lib/admin/roster";
import { getRosterCacheConfig, loadRosterCacheStatus } from "@/lib/admin/roster-cache";

type JsonResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const jsonResponse = (statusCode: number, payload: Record<string, unknown>): JsonResult => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const isScheduledEvent = (event: any) =>
  event?.source === "aws.events" || event?.["detail-type"] === "Scheduled Event";

const getHeader = (headers: Record<string, string> | null | undefined, key: string) => {
  if (!headers) return null;
  const target = key.toLowerCase();
  for (const [headerKey, value] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === target) {
      return value;
    }
  }
  return null;
};

export const handler = async (event: any): Promise<JsonResult> => {
  const scheduled = isScheduledEvent(event);
  const expectedSecret = (process.env.ADMIN_ROSTER_REBUILD_SECRET || "").trim();

  if (!scheduled) {
    if (!expectedSecret) {
      return jsonResponse(500, { error: "Rebuild secret is not configured." });
    }
    const provided = getHeader(event?.headers, "x-admin-roster-key");
    if (!provided || provided.trim() !== expectedSecret) {
      return jsonResponse(401, { error: "Unauthorized." });
    }
  }

  const startedAt = Date.now();
  try {
    const roster = await buildAdminRoster({
      includeAllowances: false,
      includeBalances: false,
      includeTokenIds: false,
      statusFilter: "all",
      forceRebuild: true,
    });
    const durationMs = Date.now() - startedAt;
    const cache = roster.cache ?? (await loadRosterCacheStatus(getRosterCacheConfig()));
    console.info("Roster cache rebuild completed", {
      durationMs,
      computedAt: cache?.computedAt ?? null,
      isFresh: cache?.isFresh ?? null,
    });
    return jsonResponse(200, { ok: true, durationMs, cache });
  } catch (err) {
    console.error("Roster cache rebuild failed", err);
    return jsonResponse(500, { error: "Roster cache rebuild failed." });
  }
};
