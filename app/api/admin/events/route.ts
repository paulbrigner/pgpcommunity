import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/auth";
import { fetchRelevantEventLocks, isAllowedEventLock } from "@/lib/events/discovery";
import { getEventMetadata, listEventMetadata, putEventMetadata, type EventMetadataStatus } from "@/lib/events/metadata-store";

export const runtime = "nodejs";

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

const requiredFields = ["description", "date", "startTime", "endTime", "timezone", "location", "imageUrl"] as const;

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const normalizePayload = (body: any): {
  lockAddress: string | null;
  status: EventMetadataStatus;
  titleOverride: string | null;
  description: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  location: string | null;
  imageUrl: string | null;
} => {
  const lockAddress = normalizeString(body?.lockAddress)?.toLowerCase() ?? null;
  const statusRaw = normalizeString(body?.status) ?? "draft";
  const status: EventMetadataStatus = statusRaw === "published" ? "published" : "draft";
  return {
    lockAddress,
    status,
    titleOverride: normalizeString(body?.titleOverride),
    description: normalizeString(body?.description),
    date: normalizeString(body?.date),
    startTime: normalizeString(body?.startTime),
    endTime: normalizeString(body?.endTime),
    timezone: normalizeString(body?.timezone),
    location: normalizeString(body?.location),
    imageUrl: normalizeString(body?.imageUrl),
  };
};

export async function GET(request: NextRequest) {
  await requireAdminSession();
  const { searchParams } = new URL(request.url);
  const lockAddress = normalizeString(searchParams.get("lockAddress"))?.toLowerCase() ?? null;

  if (lockAddress) {
    if (!(await isAllowedEventLock(lockAddress))) {
      return jsonError(404, { error: "Event not found." });
    }
    const metadata = await getEventMetadata(lockAddress);
    return NextResponse.json(
      { metadata },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [locks, metadataList] = await Promise.all([
    fetchRelevantEventLocks(),
    listEventMetadata(),
  ]);
  const metadataByLock = new Map(metadataList.map((entry) => [entry.lockAddress.toLowerCase(), entry]));

  const events = locks.map((lock) => {
    const meta = metadataByLock.get(lock.address);
    const title = meta?.titleOverride?.trim()?.length
      ? meta.titleOverride.trim()
      : lock.name || "Event";
    return {
      lockAddress: lock.address,
      onChainTitle: lock.name || null,
      title,
      metadataStatus: meta?.status ?? null,
      hasMetadata: Boolean(meta),
      metadata: meta ?? null,
    };
  });

  return NextResponse.json(
    { events },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const session = await requireAdminSession();
  const body = await request.json().catch(() => ({}));
  const payload = normalizePayload(body);

  if (!payload.lockAddress) {
    return jsonError(400, { error: "lockAddress is required." });
  }

  if (!(await isAllowedEventLock(payload.lockAddress))) {
    return jsonError(404, { error: "Event not found." });
  }

  const missing = payload.status === "published"
    ? requiredFields.filter((field) => !payload[field])
    : [];
  if (missing.length) {
    return jsonError(400, {
      error: `Missing required fields for publish: ${missing.join(", ")}`,
      fields: missing,
    });
  }

  const existing = await getEventMetadata(payload.lockAddress);
  const now = new Date().toISOString();
  const record = {
    lockAddress: payload.lockAddress,
    status: payload.status,
    titleOverride: payload.titleOverride,
    description: payload.description,
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    timezone: payload.timezone,
    location: payload.location,
    imageUrl: payload.imageUrl,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy: (session.user as any)?.id || null,
    publishedAt: payload.status === "published"
      ? existing?.publishedAt || now
      : null,
  };

  await putEventMetadata(record);

  return NextResponse.json(
    { ok: true, metadata: record },
    { headers: { "Cache-Control": "no-store" } },
  );
}
