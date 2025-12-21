import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { buildNftKey, buildCalendarLinks, downloadIcs, formatEventDisplay, stripMarkdown } from "@/lib/home-utils";
import { BASE_BLOCK_EXPLORER_URL, MEMBERSHIP_TIER_ADDRESSES } from "@/lib/config";
import { BadgeCheck } from "lucide-react";
import type { MarkdownContent as MarkdownContentType } from "@/components/home/MarkdownContent";

const MarkdownContent = dynamic(() => import("@/components/home/MarkdownContent").then(mod => mod.MarkdownContent), {
  loading: () => <div className="text-xs text-[var(--muted-ink)]">Loading description…</div>,
  ssr: false,
}) as typeof MarkdownContentType;

type DisplayNft = {
  owner: string | null;
  contractAddress: string;
  tokenId: string;
  title: string;
  description: string | null;
  subtitle?: string | null;
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string | null;
  location?: string | null;
  image: string | null;
  collectionName: string | null;
  tokenType: string | null;
  videoUrl?: string | null;
  sortKey?: number;
};

type Props = {
  displayNfts: DisplayNft[];
  showAllNfts: boolean;
  onToggleShowAll: (value: boolean) => void;
  missedNfts: DisplayNft[] | null;
  missedKeySet: Set<string>;
  loading: boolean;
  error: string | null;
  creatorNfts?: DisplayNft[] | null;
  title?: string;
  titleAll?: string;
  emptyMessage?: string;
  loadingMessage?: string;
  showMissedToggle?: boolean;
  onCancelRsvp?: (params: { lockAddress: string; recipient: string; tokenId: string }) => void;
  cancelRsvpProcessing?: boolean;
};

export function NftCollection({
  displayNfts,
  showAllNfts,
  onToggleShowAll,
  missedNfts,
  missedKeySet,
  loading,
  error,
  creatorNfts,
  title,
  titleAll,
  emptyMessage,
  loadingMessage,
  showMissedToggle = true,
  onCancelRsvp,
  cancelRsvpProcessing = false,
}: Props) {
  const [openDescriptionKey, setOpenDescriptionKey] = useState<string | null>(null);
  const [checkinTarget, setCheckinTarget] = useState<{
    lockAddress: string;
    tokenId: string;
    title: string;
    dateLabel: string | null;
    timeLabel: string | null;
    location: string | null;
  } | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [checkinQrUrl, setCheckinQrUrl] = useState<string | null>(null);
  const [checkinEmailLoading, setCheckinEmailLoading] = useState(false);
  const [checkinEmailError, setCheckinEmailError] = useState<string | null>(null);
  const [checkinEmailSentTo, setCheckinEmailSentTo] = useState<string | null>(null);
  const qrObjectUrlRef = useRef<string | null>(null);
  const explorerBase = BASE_BLOCK_EXPLORER_URL.replace(/\/$/, "");

  const closeCheckin = useCallback(() => {
    setCheckinOpen(false);
    setCheckinTarget(null);
    setCheckinError(null);
    setCheckinLoading(false);
    setCheckinQrUrl(null);
    setCheckinEmailLoading(false);
    setCheckinEmailError(null);
    setCheckinEmailSentTo(null);
    if (qrObjectUrlRef.current) {
      URL.revokeObjectURL(qrObjectUrlRef.current);
      qrObjectUrlRef.current = null;
    }
  }, []);

  const sendCheckinQrEmail = useCallback(async () => {
    if (!checkinTarget || checkinEmailLoading) return;
    setCheckinEmailLoading(true);
    setCheckinEmailError(null);
    setCheckinEmailSentTo(null);
    try {
      const res = await fetch("/api/events/checkin-qr/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lockAddress: checkinTarget.lockAddress,
          tokenId: checkinTarget.tokenId,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to email QR code.");
      }
      const sentTo = typeof payload?.sentTo === "string" && payload.sentTo.length ? payload.sentTo : null;
      if (!sentTo) {
        throw new Error("QR code emailed, but destination address was not returned.");
      }
      setCheckinEmailSentTo(sentTo);
    } catch (err: any) {
      setCheckinEmailError(err?.message || "Failed to email QR code.");
    } finally {
      setCheckinEmailLoading(false);
    }
  }, [checkinEmailLoading, checkinTarget]);

  useEffect(() => {
    return () => {
      if (qrObjectUrlRef.current) {
        URL.revokeObjectURL(qrObjectUrlRef.current);
        qrObjectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!checkinOpen || !checkinTarget) return;
    const controller = new AbortController();
    setCheckinLoading(true);
    setCheckinError(null);
    setCheckinQrUrl(null);
    setCheckinEmailLoading(false);
    setCheckinEmailError(null);
    setCheckinEmailSentTo(null);
    if (qrObjectUrlRef.current) {
      URL.revokeObjectURL(qrObjectUrlRef.current);
      qrObjectUrlRef.current = null;
    }

    void (async () => {
      const params = new URLSearchParams({
        lockAddress: checkinTarget.lockAddress,
        tokenId: checkinTarget.tokenId,
      });
      const res = await fetch(`/api/events/checkin-qr?${params.toString()}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const message = typeof payload?.error === "string" && payload.error.length
          ? payload.error
          : `Failed to load check-in QR (${res.status}).`;
        throw new Error(message);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      qrObjectUrlRef.current = objectUrl;
      setCheckinQrUrl(objectUrl);
    })().catch((err: any) => {
      if (controller.signal.aborted) return;
      setCheckinError(err?.message || "Failed to load check-in QR code.");
    }).finally(() => {
      if (controller.signal.aborted) return;
      setCheckinLoading(false);
    });

    return () => {
      controller.abort();
    };
  }, [checkinOpen, checkinTarget]);

  return (
    <>
      <Drawer
        isOpen={checkinOpen}
        onOpenChange={(open) => (open ? undefined : closeCheckin())}
        title={checkinTarget?.title ? `${checkinTarget.title} — Check-in` : "Event Check-in"}
      >
        <div className="flex flex-col gap-4 p-6">
          {checkinTarget ? (
            <div className="text-sm text-[var(--muted-ink)]">
              <div className="font-medium text-[var(--brand-navy)]">Show this QR at check-in.</div>
              <div className="mt-1 space-y-0.5 text-xs">
                {checkinTarget.dateLabel ? <div>Date: {checkinTarget.dateLabel}</div> : null}
                {checkinTarget.timeLabel ? <div>Time: {checkinTarget.timeLabel}</div> : null}
                {checkinTarget.location ? <div className="whitespace-pre-wrap">Location: {checkinTarget.location}</div> : null}
              </div>
            </div>
          ) : null}

          <div className="flex w-full flex-col items-center justify-center gap-3">
            {checkinLoading ? (
              <div className="rounded-lg bg-[rgba(67,119,243,0.08)] px-4 py-3 text-sm text-[var(--brand-navy)]">
                Loading QR code…
              </div>
            ) : checkinError ? (
              <div className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {checkinError}
              </div>
            ) : checkinQrUrl ? (
              <button
                type="button"
                className="w-full max-w-xs rounded-xl border border-black/10 bg-white p-3 shadow-sm"
                onClick={() => window.open(checkinQrUrl, "_blank", "noreferrer")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={checkinQrUrl}
                  alt="Unlock event check-in QR code"
                  className="h-auto w-full"
                />
              </button>
            ) : null}

            {checkinQrUrl ? (
              <>
                {checkinEmailSentTo ? (
                  <div className="w-full max-w-xs rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    QR code emailed to <span className="font-medium">{checkinEmailSentTo}</span>.
                  </div>
                ) : null}
                {checkinEmailError ? (
                  <div className="w-full max-w-xs rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {checkinEmailError}
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="outlined-primary"
                  className="w-full max-w-xs"
                  isLoading={checkinEmailLoading}
                  onClick={sendCheckinQrEmail}
                >
                  Email this QR
                </Button>
                <div className="flex w-full max-w-xs flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => window.open(checkinQrUrl, "_blank", "noreferrer")}
                  >
                    Open full screen
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={closeCheckin}
                  >
                    Done
                  </Button>
                </div>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={closeCheckin}>
                Close
              </Button>
            )}
          </div>
        </div>
      </Drawer>

      <div className="glass-item space-y-4 p-5 md:col-span-2">
        <div className="flex items-center justify-between gap-2 text-[var(--muted-ink)]">
          <h2 className="text-lg font-semibold text-[var(--brand-navy)]">
            {showAllNfts
              ? titleAll ?? title ?? "All PGP NFTs"
              : title ?? "Your PGP NFT Collection"}
          </h2>
          {showMissedToggle && missedNfts && missedNfts.length > 0 ? (
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={showAllNfts}
                onChange={(e) => onToggleShowAll(e.target.checked)}
              />
              Show meetings you missed
            </label>
          ) : null}
        </div>
        {loading ? (
          <p className="text-sm text-[var(--muted-ink)]">{loadingMessage ?? "Loading your collection…"}</p>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : displayNfts.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {displayNfts.map((nft) => {
              const displayId = nft.tokenId?.startsWith('0x')
                ? (() => {
                    try {
                      return BigInt(nft.tokenId).toString();
                    } catch {
                      return nft.tokenId;
                    }
                  })()
                : nft.tokenId ?? '';
              const explorerUrl = nft.tokenId
                ? `${explorerBase}/token/${nft.contractAddress}?a=${encodeURIComponent(displayId)}`
                : `${explorerBase}/address/${nft.contractAddress}`;
              const isOwned = Array.isArray(creatorNfts)
                && creatorNfts.some((owned) => owned.contractAddress === nft.contractAddress && owned.tokenId === nft.tokenId && owned.owner);
              const eventStart = (() => {
                if (!nft.eventDate) return null;
                const zone = nft.timezone || 'UTC';
                const rawDate = DateTime.fromISO(String(nft.eventDate), { zone });
                if (rawDate.isValid) {
                  if (nft.startTime) {
                    const combined = DateTime.fromISO(`${rawDate.toISODate()}T${nft.startTime}`, { zone });
                    if (combined.isValid) return combined;
                  }
                  if (String(nft.eventDate).includes('T')) {
                    return rawDate;
                  }
                  return rawDate.endOf('day');
                }
                if (nft.startTime) {
                  const fallback = DateTime.fromISO(`${nft.eventDate}T${nft.startTime}`, { zone });
                  if (fallback.isValid) return fallback;
                }
                return null;
              })();
              const futureTimeMs = (() => {
                if (eventStart) return eventStart.toUTC().toMillis();
                const dateParsed = nft.eventDate ? Date.parse(String(nft.eventDate)) : NaN;
                if (Number.isFinite(dateParsed)) return dateParsed;
                const subtitleParsed = nft.subtitle ? Date.parse(String(nft.subtitle)) : NaN;
                if (Number.isFinite(subtitleParsed)) return subtitleParsed;
                return null;
              })();
              const isFutureMeeting = typeof futureTimeMs === "number" && futureTimeMs > Date.now();
              const isUpcomingRegistration = isFutureMeeting && isOwned;
              const isMembershipTier = MEMBERSHIP_TIER_ADDRESSES.has(nft.contractAddress.toLowerCase());
              const canCancelRsvp = Boolean(
                !isMembershipTier && isUpcomingRegistration && nft.owner && typeof onCancelRsvp === "function"
              );
              const canCheckin = Boolean(!isMembershipTier && isUpcomingRegistration && nft.owner && nft.tokenId);
              const eventLabels = formatEventDisplay(
                nft.eventDate,
                nft.startTime,
                nft.endTime,
                nft.timezone
              );
              const showEventDetails =
                isFutureMeeting && (eventLabels.dateLabel || eventLabels.timeLabel || nft.location);
              const calendarLinks = showEventDetails
                ? buildCalendarLinks(
                    nft.title ?? 'PGP Event',
                    nft.eventDate,
                    nft.startTime,
                    nft.endTime,
                    nft.timezone,
                    nft.location,
                    nft.description ?? null
                  )
                : { google: null, ics: null };
              const subtitle = showEventDetails
                ? null
                : (() => {
                    const text = (nft.subtitle || nft.collectionName || nft.description || '').trim();
                    if (!text) return null;
                    const normalizedTitle = nft.title?.trim().toLowerCase();
                    const normalizedText = text.toLowerCase();
                    if (normalizedTitle && normalizedTitle === normalizedText) return null;
                    if (text.length > 80) return null;
                    return text;
                  })();
              const shortenedDescription = showEventDetails
                ? null
                : (() => {
                    const source = (() => {
                      const desc = nft.description?.trim();
                      if (desc && desc.length) return desc;
                      const sub = nft.subtitle?.trim();
                      if (sub && sub.length) return sub;
                      const collection = nft.collectionName?.trim();
                      if (collection && collection.length) return collection;
                      return '';
                    })();
                    if (!source) return null;
                    const plain = stripMarkdown(source);
                    if (!plain) return null;
                    const preview = plain.length > 140 ? `${plain.slice(0, 140)}…` : plain;
                    const enrichedMarkdown = source.replace(
                      /(^|\s)(https?:\/\/[^\s)]+)/g,
                      (match, prefix, url, offset, str) => {
                        const before = str.slice(0, offset + prefix.length);
                        if (/\[[^\]]*$/.test(before)) return match;
                        return `${prefix}[${url}](${url})`;
                      }
                    );
                    return {
                      preview,
                      fullMarkdown: enrichedMarkdown,
                    } as const;
                  })();
              const handleDownloadIcs = () => {
                if (calendarLinks.ics) {
                  downloadIcs(calendarLinks.ics, nft.title || 'PGP Event');
                }
              };
              const ownerKey = 'owner' in nft && nft.owner ? nft.owner : 'none';
              const tokenIdKey = nft.tokenId ?? 'upcoming';
              const itemKey = buildNftKey(nft.contractAddress, tokenIdKey);
              const isMissed = showAllNfts && missedKeySet.has(itemKey);
              const ringClass = isUpcomingRegistration
                ? 'ring-2 ring-[rgba(67,119,243,0.45)]'
                : isMissed
                ? 'ring-2 ring-[rgba(239,68,68,0.45)]'
                : '';
              const descriptionKey = `${nft.contractAddress}-${tokenIdKey}-${ownerKey}-description`;
              const isDescriptionOpen = openDescriptionKey === descriptionKey;
              return (
                <div
                  key={`${nft.contractAddress}-${tokenIdKey}-${ownerKey}`}
                  className={`muted-card flex gap-3 p-3 ${ringClass} ${isOwned ? '' : 'opacity-80'}`}
                >
                {nft.image ? (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={nft.image} alt={nft.title} className="h-full w-full object-cover" />
                  </a>
                ) : (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="h-20 w-20 shrink-0 rounded-md bg-muted"
                  />
                )}
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="max-w-full truncate font-medium text-[var(--brand-navy)]">{nft.title}</div>
                    {isUpcomingRegistration ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-100">
                        <BadgeCheck className="h-3 w-3" /> You&apos;re Registered!
                      </span>
                    ) : null}
                  </div>
                  {subtitle ? (
                    <div className="truncate text-xs text-[var(--muted-ink)]">{subtitle}</div>
                  ) : null}
                  {displayId ? (
                    <div className="truncate text-xs text-[var(--muted-ink)]">Token #{displayId}</div>
                  ) : null}
                  {showEventDetails ? (
                    <div className="space-y-1 text-xs text-[var(--muted-ink)]">
                      {eventLabels.dateLabel ? <div>Date: {eventLabels.dateLabel}</div> : null}
                      {eventLabels.timeLabel ? <div>Time: {eventLabels.timeLabel}</div> : null}
                      {nft.location ? (
                        <div className="whitespace-pre-wrap">Location: {nft.location}</div>
                      ) : null}
                      {(calendarLinks.google || calendarLinks.ics || canCancelRsvp || canCheckin) ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {calendarLinks.google ? (
                            <Button asChild size="sm" variant="secondary">
                              <a
                                href={calendarLinks.google}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Add to Google Calendar
                              </a>
                            </Button>
                          ) : null}
                          {calendarLinks.ics ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={handleDownloadIcs}
                            >
                              Download .ics
                            </Button>
                          ) : null}
                          {canCheckin ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outlined-primary"
                              onClick={() => {
                                setCheckinTarget({
                                  lockAddress: nft.contractAddress,
                                  tokenId: nft.tokenId,
                                  title: nft.title || "Event",
                                  dateLabel: eventLabels?.dateLabel ?? null,
                                  timeLabel: eventLabels?.timeLabel ?? null,
                                  location: nft.location ?? null,
                                });
                                setCheckinOpen(true);
                              }}
                              disabled={checkinLoading || checkinOpen}
                            >
                              Check-In w/QR
                            </Button>
                          ) : null}
                          {canCancelRsvp ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              isLoading={cancelRsvpProcessing}
                              disabled={cancelRsvpProcessing}
                              onClick={() =>
                                onCancelRsvp?.({
                                  lockAddress: nft.contractAddress,
                                  recipient: nft.owner as string,
                                  tokenId: nft.tokenId,
                                })
                              }
                            >
                              Cancel RSVP
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {shortenedDescription ? (
                    <div className="text-xs text-[var(--muted-ink)]">
                      {isDescriptionOpen ? (
                        <div className="space-y-2">
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <MarkdownContent>{shortenedDescription.fullMarkdown}</MarkdownContent>
                          </div>
                          <button
                            type="button"
                            className="text-xs text-[var(--brand-denim)] hover:underline focus-visible:outline-none"
                            onClick={() => setOpenDescriptionKey(null)}
                          >
                            Hide description
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-left text-xs text-[var(--brand-denim)] hover:underline focus-visible:outline-none"
                          onClick={() => setOpenDescriptionKey(descriptionKey)}
                        >
                          {shortenedDescription.preview}
                        </button>
                      )}
                    </div>
                  ) : null}
                  {nft.videoUrl ? (
                    <div>
                      <a
                        href={nft.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[var(--brand-denim)] hover:underline"
                      >
                        Watch Video
                      </a>
                    </div>
                  ) : null}
                  {!showEventDetails && canCancelRsvp ? (
                    <div className="pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {canCheckin ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outlined-primary"
                            onClick={() => {
                              setCheckinTarget({
                                lockAddress: nft.contractAddress,
                                tokenId: nft.tokenId,
                                title: nft.title || "Event",
                                dateLabel: eventLabels?.dateLabel ?? null,
                                timeLabel: eventLabels?.timeLabel ?? null,
                                location: nft.location ?? null,
                              });
                              setCheckinOpen(true);
                            }}
                            disabled={checkinLoading || checkinOpen}
                          >
                            Check-In w/QR
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          isLoading={cancelRsvpProcessing}
                          disabled={cancelRsvpProcessing}
                          onClick={() =>
                            onCancelRsvp?.({
                              lockAddress: nft.contractAddress,
                              recipient: nft.owner as string,
                              tokenId: nft.tokenId,
                            })
                          }
                        >
                          Cancel RSVP
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-ink)]">
          {emptyMessage ?? "No creator NFTs or POAPs detected yet. Join community events to start collecting!"}
        </p>
      )}
    </div>
    </>
  );
}
