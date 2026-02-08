"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EventMetadataForm, type EventMetadataFormValues } from "@/components/admin/EventMetadataForm";

type EventMetadata = {
  lockAddress: string;
  status: "draft" | "published";
  titleOverride?: string | null;
  description?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string | null;
  location?: string | null;
  imageUrl?: string | null;
  updatedAt?: string | null;
};

type AdminEventEntry = {
  lockAddress: string;
  onChainTitle: string | null;
  title: string;
  metadataStatus: "draft" | "published" | null;
  hasMetadata: boolean;
  metadata: EventMetadata | null;
};

type StatusFilter = "all" | "published" | "draft" | "missing";

export default function AdminEventsClient() {
  const [events, setEvents] = useState<AdminEventEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedLock, setExpandedLock] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/events", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load events.");
      }
      setEvents(Array.isArray(payload?.events) ? payload.events : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      const status = event.metadataStatus || "missing";
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (!needle) return true;
      const haystack = [
        event.title,
        event.onChainTitle,
        event.lockAddress,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [events, query, statusFilter]);

  const handleSave = async (lockAddress: string, values: EventMetadataFormValues) => {
    const res = await fetch("/api/admin/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lockAddress,
        status: values.status,
        titleOverride: values.titleOverride,
        description: values.description,
        date: values.date,
        startTime: values.startTime,
        endTime: values.endTime,
        timezone: values.timezone,
        location: values.location,
        imageUrl: values.imageUrl,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.error || "Failed to save event.");
    }
    await fetchEvents();
  };

  return (
    <div className="space-y-5">
      <div className="glass-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-eyebrow text-[var(--brand-denim)]">Events</p>
            <h2 className="text-2xl font-semibold text-[#0b0b43]">Event metadata</h2>
            <p className="text-sm text-muted-foreground">
              On-chain discovered events with editable, member-facing metadata.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" asChild>
              <Link href="/admin/events/checkin">Check-in</Link>
            </Button>
            <Button variant="ghost" onClick={fetchEvents} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Search title or lock address"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-full border border-[rgba(11,11,67,0.12)] bg-white px-4 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)] sm:w-64"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="rounded-full border border-[rgba(11,11,67,0.12)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
          >
            <option value="all">All statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="missing">Missing</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="glass-item p-6 text-sm text-[var(--muted-ink)]">Loading events...</div>
      ) : error ? (
        <div className="glass-item border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
          {error}
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="glass-item p-6 text-sm text-[var(--muted-ink)]">No events found.</div>
      ) : (
        <div className="space-y-4">
          {filteredEvents.map((event) => {
            const status = event.metadataStatus || "missing";
            const isExpanded = expandedLock === event.lockAddress;
            const meta = event.metadata;
            return (
              <div key={event.lockAddress} className="glass-item p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted-ink)]">
                      {status}
                    </div>
                    <h3 className="text-lg font-semibold text-[var(--brand-navy)]">{event.title}</h3>
                    {event.onChainTitle && event.onChainTitle !== event.title ? (
                      <div className="text-xs text-[var(--muted-ink)]">On-chain: {event.onChainTitle}</div>
                    ) : null}
                    {meta?.date ? (
                      <div className="mt-2 text-sm text-[var(--muted-ink)]">
                        {meta.date} · {meta.startTime || "TBD"} - {meta.endTime || "TBD"} {meta.timezone || ""}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-[var(--muted-ink)]">Details coming soon.</div>
                    )}
                    {meta?.location ? (
                      <div className="text-xs text-[var(--muted-ink)]">{meta.location}</div>
                    ) : null}
                    <div className="mt-2 text-xs text-[var(--muted-ink)]">Lock: {event.lockAddress}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="ghost">
                      <Link href={`/events/${event.lockAddress}`}>View page</Link>
                    </Button>
                    <Button onClick={() => setExpandedLock(isExpanded ? null : event.lockAddress)}>
                      {isExpanded ? "Close editor" : "Edit details"}
                    </Button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="mt-5">
                    <EventMetadataForm
                      initialValues={{
                        titleOverride: meta?.titleOverride ?? "",
                        description: meta?.description ?? "",
                        date: meta?.date ?? "",
                        startTime: meta?.startTime ?? "",
                        endTime: meta?.endTime ?? "",
                        timezone: meta?.timezone ?? "",
                        location: meta?.location ?? "",
                        imageUrl: meta?.imageUrl ?? "",
                        status: meta?.status === "published" ? "published" : "draft",
                      }}
                      onSubmit={(values) => handleSave(event.lockAddress, values)}
                      onCancel={() => setExpandedLock(null)}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
