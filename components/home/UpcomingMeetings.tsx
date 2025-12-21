import React from "react";
import { Button } from "@/components/ui/button";
import type { EventDetails } from "@/lib/hooks/use-event-registration";

type UpcomingNft = {
  contractAddress: string;
  title: string;
  description: string | null;
  subtitle?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string | null;
  location?: string | null;
  image: string | null;
  registrationUrl: string;
  quickCheckoutLock: string | null;
};

type Props = {
  items: UpcomingNft[];
  show: boolean;
  onToggleShow: (value: boolean) => void;
  onRsvp: (lockAddress: string | null | undefined, fallbackUrl?: string | null, details?: EventDetails) => void;
  rsvpProcessing?: boolean;
  showToggle?: boolean;
};

export function UpcomingMeetings({
  items,
  show,
  onToggleShow,
  onRsvp,
  rsvpProcessing = false,
  showToggle = true,
}: Props) {
  if (!items.length) return null;
  const displayItems = showToggle ? show : true;
  return (
    <div className="glass-item space-y-4 p-5 md:col-span-2">
      <div className="flex items-center justify-between gap-2 text-[var(--muted-ink)]">
        <h2 className="text-lg font-semibold text-[var(--brand-navy)]">Upcoming PGP Meetings</h2>
        {showToggle ? (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={show}
              onChange={(e) => onToggleShow(e.target.checked)}
            />
            Show upcoming events
          </label>
        ) : null}
      </div>
      {displayItems ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[...items]
            .sort((a, b) => {
              const titleA = a.title?.toLowerCase() ?? "";
              const titleB = b.title?.toLowerCase() ?? "";
              if (titleA > titleB) return -1;
              if (titleA < titleB) return 1;
              return 0;
            })
            .map((nft) => {
              const eventDetails: EventDetails = {
                title: nft.title ?? "Event Registration",
                date: nft.subtitle || null,
                time: nft.startTime || null,
                location: nft.location || null,
                description: nft.description || null,
              };
              return (
                <div
                  key={`upcoming-${nft.contractAddress}`}
                  className="muted-card flex gap-3 p-3"
                >
                  {nft.image ? (
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-white/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={nft.image} alt={nft.title} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="h-20 w-20 shrink-0 rounded-md bg-white/50" />
                  )}
                  <div className="min-w-0 space-y-1">
                    <div className="font-medium truncate text-[var(--brand-navy)]">{nft.title}</div>
                    {nft.subtitle ? (
                      <div className="text-xs text-[var(--muted-ink)]">Date: {nft.subtitle}</div>
                    ) : null}
                    {nft.startTime || nft.endTime ? (
                      <div className="text-xs text-[var(--muted-ink)]">
                        Time: {nft.startTime ?? "TBD"}
                        {nft.endTime ? ` - ${nft.endTime}` : ""}
                        {nft.timezone ? ` (${nft.timezone})` : ""}
                      </div>
                    ) : null}
                    {nft.location ? (
                      <div className="text-xs text-[var(--muted-ink)] whitespace-pre-wrap">Location: {nft.location}</div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs"
                        onClick={() =>
                          onRsvp(
                            (nft.quickCheckoutLock as string) || nft.contractAddress,
                            nft.registrationUrl,
                            eventDetails
                          )
                        }
                        isLoading={rsvpProcessing}
                        disabled={rsvpProcessing || (!nft.contractAddress && !nft.registrationUrl)}
                      >
                        RSVP now
                      </Button>
                      {nft.registrationUrl ? (
                        <a
                          href={nft.registrationUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--brand-denim)] hover:underline"
                        >
                          View event details
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-ink)]">Turn on to see upcoming meetings available for registration.</p>
      )}
    </div>
  );
}
