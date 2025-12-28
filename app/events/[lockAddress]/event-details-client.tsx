"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "@/components/home/MarkdownContent";
import { buildCalendarLinks, downloadIcs, formatEventDisplay } from "@/lib/home-utils";
import { useUnlockCheckout } from "@/lib/unlock-checkout";
import { BASE_BLOCK_EXPLORER_URL } from "@/lib/config";
import type { EventDetails } from "@/lib/hooks/use-event-registration";
import { CalendarDays, MapPin, ArrowLeft } from "lucide-react";
import { EventMetadataForm, type EventMetadataFormValues } from "@/components/admin/EventMetadataForm";

type EventPayload = {
  lockAddress: string;
  title: string;
  titleOverride?: string | null;
  onChainTitle?: string | null;
  description: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  location: string | null;
  image: string | null;
  metadataStatus?: "draft" | "published" | null;
  hasMetadata?: boolean;
  isDraft?: boolean;
  isAdmin?: boolean;
};

type Props = {
  lockAddress: string;
};

const normalizeDescription = (value: string): string => {
  const hasTags = /<[^>]+>/.test(value);
  if (!hasTags) return value;
  const cleaned = value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*p[^>]*>/gi, "")
    .replace(/<\s*\/li\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<\s*\/h[1-6]\s*>/gi, "\n\n")
    .replace(/<\s*h[1-6][^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned;
};

export function EventDetailsClient({ lockAddress }: Props) {
  const { data: session, status } = useSession();
  const authenticated = status === "authenticated";
  const sessionUser = session?.user as any | undefined;

  const wallets = useMemo(() => {
    const list = sessionUser?.wallets;
    return Array.isArray(list) ? list.map((item) => String(item)) : [];
  }, [sessionUser]);
  const walletAddress = sessionUser?.walletAddress as string | undefined;
  const addressList = useMemo(() => {
    const sources = wallets.length ? wallets : walletAddress ? [walletAddress] : [];
    return Array.from(
      new Set(
        sources
          .map((addr) => String(addr).trim().toLowerCase())
          .filter((addr) => addr.length > 0),
      ),
    );
  }, [walletAddress, wallets]);
  const walletLinked = addressList.length > 0;

  const [event, setEvent] = useState<EventPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rsvpProcessing, setRsvpProcessing] = useState(false);
  const [rsvpMessage, setRsvpMessage] = useState<string | null>(null);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [rsvpTxHash, setRsvpTxHash] = useState<string | null>(null);
  const [rsvpStatus, setRsvpStatus] = useState<"unknown" | "registered" | "not-registered">("unknown");
  const [rsvpStatusLoading, setRsvpStatusLoading] = useState(false);
  const [adminEditing, setAdminEditing] = useState(false);

  const { openEventCheckout, checkoutPortal } = useUnlockCheckout({
    onEventComplete: async () => {
      setRsvpMessage("RSVP confirmed. You're registered!");
      setRsvpStatus("registered");
    },
  });

  const loadEvent = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams({ lockAddress });
      const res = await fetch(`/api/events/details?${params.toString()}`, {
        signal,
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Unable to load event details.");
      }
      setEvent({
        lockAddress: String(payload?.lockAddress || lockAddress),
        title: String(payload?.title || "Event"),
        titleOverride: payload?.titleOverride ?? null,
        onChainTitle: payload?.onChainTitle ?? null,
        description: payload?.description ?? null,
        date: payload?.date ?? null,
        startTime: payload?.startTime ?? null,
        endTime: payload?.endTime ?? null,
        timezone: payload?.timezone ?? null,
        location: payload?.location ?? null,
        image: payload?.image ?? null,
        metadataStatus: payload?.metadataStatus ?? null,
        hasMetadata: Boolean(payload?.hasMetadata),
        isDraft: Boolean(payload?.isDraft),
        isAdmin: Boolean(payload?.isAdmin),
      });
    },
    [lockAddress],
  );

  useEffect(() => {
    if (!lockAddress) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    setEvent(null);
    setRsvpMessage(null);
    setRsvpError(null);
    setRsvpTxHash(null);
    setRsvpStatus("unknown");
    setRsvpStatusLoading(false);
    void (async () => {
      try {
        await loadEvent(controller.signal);
      } catch (err: any) {
        if (controller.signal.aborted) return;
        setLoadError(err?.message || "Unable to load event details.");
      } finally {
        if (controller.signal.aborted) return;
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [loadEvent, lockAddress]);

  useEffect(() => {
    const targetLock = event?.lockAddress || lockAddress;
    if (!authenticated || !walletLinked || addressList.length === 0 || !targetLock) {
      setRsvpStatus("unknown");
      return;
    }
    const controller = new AbortController();
    setRsvpStatusLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/events/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockAddress: targetLock, recipients: addressList }),
          signal: controller.signal,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || "Unable to check RSVP status.");
        }
        setRsvpStatus(payload?.registered ? "registered" : "not-registered");
      } catch {
        if (controller.signal.aborted) return;
        setRsvpStatus("unknown");
      } finally {
        if (controller.signal.aborted) return;
        setRsvpStatusLoading(false);
      }
    })();
    return () => controller.abort();
  }, [addressList, authenticated, event?.lockAddress, lockAddress, walletLinked]);

  const handleRsvp = async () => {
    if (rsvpProcessing) return;
    setRsvpError(null);
    setRsvpMessage(null);
    setRsvpTxHash(null);

    if (!authenticated) {
      setRsvpError("Sign in before RSVP'ing for events.");
      return;
    }
    if (!walletLinked || addressList.length === 0) {
      setRsvpError("Link your wallet before RSVP'ing for events.");
      return;
    }
    const targetLock = event?.lockAddress || lockAddress;
    if (!targetLock) {
      setRsvpError("Invalid event lock.");
      return;
    }

    setRsvpProcessing(true);
    try {
      const res = await fetch("/api/events/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockAddress: targetLock, recipient: addressList[0] }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = typeof payload?.code === "string" ? payload.code : null;
        const message = typeof payload?.error === "string" && payload.error.length
          ? payload.error
          : "Unable to RSVP for this event.";
        if (code === "EVENT_NOT_FREE") {
          const eventDetails: EventDetails = event
            ? {
                title: event.title,
                date: event.date,
                time: event.startTime,
                location: event.location,
                description: event.description,
              }
            : null;
          setRsvpMessage("This event requires an on-chain checkout. Opening wallet checkout...");
          openEventCheckout(targetLock, eventDetails);
          return;
        }
        throw new Error(message);
      }

      const txHash = typeof payload?.txHash === "string" && payload.txHash.length ? payload.txHash : null;
      setRsvpTxHash(txHash);
      setRsvpMessage(
        payload?.status === "already-registered"
          ? "You're already registered for this event."
          : "RSVP submitted. It will appear in your collection once confirmed on Base.",
      );
      setRsvpStatus("registered");
    } catch (err: any) {
      setRsvpError(err?.message || "Failed to RSVP for event.");
    } finally {
      setRsvpProcessing(false);
    }
  };

  const eventDetails = event
    ? formatEventDisplay(event.date ?? null, event.startTime ?? null, event.endTime ?? null, event.timezone ?? null)
    : { dateLabel: null, timeLabel: null };
  const descriptionText = event?.description ? normalizeDescription(event.description) : null;
  const calendarLinks = event && rsvpStatus === "registered"
    ? buildCalendarLinks(
        event.title || "PGP Event",
        event.date,
        event.startTime,
        event.endTime,
        event.timezone,
        event.location,
        event.description ?? null,
      )
    : { google: null, ics: null };
  const handleDownloadIcs = () => {
    if (calendarLinks.ics) {
      downloadIcs(calendarLinks.ics, event?.title || "PGP Event");
    }
  };

  const handleAdminSave = async (values: EventMetadataFormValues) => {
    if (!event?.lockAddress) {
      throw new Error("Missing lock address.");
    }
    const res = await fetch("/api/admin/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lockAddress: event.lockAddress,
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
      throw new Error(payload?.error || "Failed to save event details.");
    }
    await loadEvent();
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-12 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-[var(--muted-ink)]">
        <Link href="/" className="inline-flex items-center gap-1 text-[var(--brand-denim)] hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to home
        </Link>
      </div>

      <section className="glass-surface space-y-6 p-6 md:p-8">
        {loading ? (
          <div className="space-y-3 text-sm text-[var(--muted-ink)]">
            <div className="text-lg font-semibold text-[var(--brand-navy)]">Loading event details...</div>
            <div>Gathering the event overview and RSVP options.</div>
          </div>
        ) : loadError ? (
          <div className="space-y-3">
            <div className="text-lg font-semibold text-[var(--brand-navy)]">Event details unavailable</div>
            <div className="text-sm text-[var(--muted-ink)]">{loadError}</div>
          </div>
        ) : event ? (
          <>
            <div className="flex flex-col gap-6 md:flex-row md:items-start">
              <div className="flex-1 space-y-4">
                <div className="text-xs uppercase tracking-[0.3em] text-[var(--muted-ink)]">
                  Upcoming meeting
                </div>
                <h1 className="text-2xl font-semibold text-[var(--brand-navy)] md:text-3xl">
                  {event.title}
                </h1>
                <div className="space-y-2 text-sm text-[var(--muted-ink)]">
                  {eventDetails.dateLabel ? (
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-[var(--brand-denim)]" />
                      <span>{eventDetails.dateLabel}</span>
                      {eventDetails.timeLabel ? (
                        <span className="text-xs text-[var(--muted-ink)]">- {eventDetails.timeLabel}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {event.location ? (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-[var(--brand-denim)]" />
                      <span className="whitespace-pre-wrap">{event.location}</span>
                    </div>
                  ) : null}
                  {!eventDetails.dateLabel && !event.location ? (
                    <div>Details coming soon.</div>
                  ) : null}
                </div>
                <div className="text-xs text-[var(--muted-ink)]">
                  We&apos;ll sponsor the RSVP when possible (no gas required).
                </div>
                {event.isAdmin && event.metadataStatus ? (
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
                    Metadata status: {event.metadataStatus}
                  </div>
                ) : null}
              </div>
              {event.image ? (
                <div className="h-40 w-full overflow-hidden rounded-2xl bg-white/60 shadow-sm md:h-48 md:w-60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={event.image} alt={event.title} className="h-full w-full object-cover" />
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleRsvp}
                disabled={rsvpProcessing || rsvpStatusLoading || rsvpStatus === "registered" || !event.lockAddress}
                isLoading={rsvpProcessing}
                variant={rsvpStatus === "registered" ? "secondary" : "default"}
              >
                {rsvpStatus === "registered" ? "RSVP confirmed" : "RSVP now"}
              </Button>
              {rsvpStatus === "registered" && calendarLinks.google ? (
                <Button asChild size="sm" variant="secondary">
                  <a href={calendarLinks.google} target="_blank" rel="noreferrer">
                    Add to Google Calendar
                  </a>
                </Button>
              ) : null}
              {rsvpStatus === "registered" && calendarLinks.ics ? (
                <Button type="button" size="sm" variant="secondary" onClick={handleDownloadIcs}>
                  Download .ics
                </Button>
              ) : null}
            </div>

            {rsvpMessage || rsvpError ? (
              <Alert
                variant={rsvpError ? "destructive" : undefined}
                className="glass-item border-[rgba(193,197,226,0.45)] bg-white/80 text-[var(--brand-navy)]"
              >
                <AlertDescription className="text-sm">
                  {rsvpError || rsvpMessage}
                  {rsvpTxHash ? (
                    <>
                      {" "}
                      <a
                        href={`${BASE_BLOCK_EXPLORER_URL}/tx/${rsvpTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4"
                      >
                        View transaction
                      </a>
                    </>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null}
      </section>

      {event ? (
        <section className="mt-6 glass-item p-6 md:p-8">
          <h2 className="text-lg font-semibold text-[var(--brand-navy)]">Event details</h2>
          <div className="mt-3 text-sm text-[var(--muted-ink)]">
            {descriptionText ? (
              <div className="prose prose-sm max-w-none text-[var(--muted-ink)]">
                <MarkdownContent>{descriptionText}</MarkdownContent>
              </div>
            ) : (
              <p>We&apos;ll share additional details as the meeting approaches.</p>
            )}
          </div>
        </section>
      ) : null}

      {event?.isAdmin ? (
        <section className="mt-6 glass-surface p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-[var(--muted-ink)]">Admin</div>
              <h3 className="text-lg font-semibold text-[var(--brand-navy)]">Edit event metadata</h3>
            </div>
            <Button variant="ghost" onClick={() => setAdminEditing((prev) => !prev)}>
              {adminEditing ? "Hide editor" : "Edit details"}
            </Button>
          </div>
          {adminEditing ? (
            <div className="mt-5">
              <EventMetadataForm
                initialValues={{
                  titleOverride: event.titleOverride ?? "",
                  description: event.description ?? "",
                  date: event.date ?? "",
                  startTime: event.startTime ?? "",
                  endTime: event.endTime ?? "",
                  timezone: event.timezone ?? "",
                  location: event.location ?? "",
                  imageUrl: event.image ?? "",
                  status: event.metadataStatus === "published" ? "published" : "draft",
                }}
                onSubmit={handleAdminSave}
                onCancel={() => setAdminEditing(false)}
              />
            </div>
          ) : null}
        </section>
      ) : null}
      {checkoutPortal}
    </div>
  );
}
