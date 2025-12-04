import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/button";
import { buildNftKey, buildCalendarLinks, downloadIcs, formatEventDisplay, stripMarkdown } from "@/lib/home-utils";
import { BASE_BLOCK_EXPLORER_URL } from "@/lib/config";
import { BadgeCheck } from "lucide-react";

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
}: Props) {
  const [openDescriptionKey, setOpenDescriptionKey] = useState<string | null>(null);
  const explorerBase = BASE_BLOCK_EXPLORER_URL.replace(/\/$/, "");

  return (
    <div className="glass-item space-y-4 p-5 md:col-span-2">
      <div className="flex items-center justify-between gap-2 text-[var(--muted-ink)]">
        <h2 className="text-lg font-semibold text-[var(--brand-navy)]">
          {showAllNfts ? 'All PGP NFTs' : 'Your PGP NFT Collection'}
        </h2>
        {missedNfts && missedNfts.length > 0 ? (
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
        <p className="text-sm text-[var(--muted-ink)]">Loading your collection…</p>
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
            const isFutureMeeting = typeof futureTimeMs === 'number' && futureTimeMs > Date.now();
            const isUpcomingRegistration = isFutureMeeting && isOwned;
            const eventLabels = formatEventDisplay(
              nft.eventDate,
              nft.startTime,
              nft.endTime,
              nft.timezone
            );
            const showEventDetails = isFutureMeeting && (eventLabels.dateLabel || eventLabels.timeLabel || nft.location);
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
                  const enrichedMarkdown = source.replace(/(^|\s)(https?:\/\/[^\s)]+)/g, (match, prefix, url, offset, str) => {
                    const before = str.slice(0, offset + prefix.length);
                    if (/\[[^\]]*$/.test(before)) return match;
                    return `${prefix}[${url}](${url})`;
                  });
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
                      {(calendarLinks.google || calendarLinks.ics) ? (
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
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {shortenedDescription ? (
                    <div className="text-xs text-[var(--muted-ink)]">
                      {isDescriptionOpen ? (
                        <div className="space-y-2">
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {shortenedDescription.fullMarkdown}
                            </ReactMarkdown>
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
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-ink)]">
          No creator NFTs or POAPs detected yet. Join community events to start collecting!
        </p>
      )}
    </div>
  );
}
