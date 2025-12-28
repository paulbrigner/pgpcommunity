import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { DateTime } from "luxon";
import { OnboardingChecklist } from "@/components/site/OnboardingChecklist";
import { NftCollectionSkeleton, UpcomingMeetingsSkeleton } from "@/components/home/Skeletons";
import { MEMBERSHIP_TIER_ADDRESSES } from "@/lib/config";
import { buildNftKey } from "@/lib/home-utils";
import { Select } from "@/components/ui/select";
import type { EventDetails } from "@/lib/hooks/use-event-registration";

type UpcomingItem = {
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
  eventStatus?: "active" | "expired" | null;
  expiresAt?: number | null;
  eventTimestamp?: number | null;
};

const isMeetingNft = (nft: DisplayNft) =>
  Boolean(nft.eventDate || nft.subtitle || nft.startTime || nft.endTime || nft.location || nft.eventStatus);

const resolveEventTimestamp = (nft: DisplayNft): number | null => {
  if (typeof nft.eventTimestamp === "number" && Number.isFinite(nft.eventTimestamp)) {
    return nft.eventTimestamp;
  }
  const zone = nft.timezone || "UTC";
  if (nft.eventDate) {
    const rawDate = DateTime.fromISO(String(nft.eventDate), { zone });
    if (rawDate.isValid) {
      if (nft.startTime) {
        const combined = DateTime.fromISO(`${rawDate.toISODate()}T${nft.startTime}`, { zone });
        if (combined.isValid) return combined.toUTC().toMillis();
      }
      if (String(nft.eventDate).includes("T")) {
        return rawDate.toUTC().toMillis();
      }
      return rawDate.endOf("day").toUTC().toMillis();
    }
    if (nft.startTime) {
      const fallback = DateTime.fromISO(`${nft.eventDate}T${nft.startTime}`, { zone });
      if (fallback.isValid) return fallback.toUTC().toMillis();
    }
    const parsed = Date.parse(String(nft.eventDate));
    if (Number.isFinite(parsed)) return parsed;
  }
  if (nft.subtitle) {
    const parsed = Date.parse(String(nft.subtitle));
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof nft.expiresAt === "number" && Number.isFinite(nft.expiresAt) && nft.expiresAt > 0) {
    return nft.expiresAt * 1000;
  }
  return null;
};

const resolveEventYear = (nft: DisplayNft): number | null => {
  const timestamp = resolveEventTimestamp(nft);
  if (typeof timestamp === "number") {
    return DateTime.fromMillis(timestamp).toUTC().year;
  }
  return null;
};

const UpcomingMeetingsLazy = dynamic(
  () => import("@/components/home/UpcomingMeetings").then((mod) => mod.UpcomingMeetings),
  { loading: () => <UpcomingMeetingsSkeleton /> }
);

const NftCollectionLazy = dynamic(
  () => import("@/components/home/NftCollection").then((mod) => mod.NftCollection),
  { loading: () => <NftCollectionSkeleton /> }
);

type AutoRenewPromptProps = {
  greetingName: string;
  walletLinked: boolean;
  profileComplete: boolean;
  membershipStatus: "active" | "expired" | "none";
  autoRenewReady: boolean;
  autoRenewEnabled: boolean;
  autoRenewProcessing: boolean;
  autoRenewDismissed: boolean;
  onEnableAutoRenew: () => void;
  onSkipAutoRenew: () => void;
  autoRenewMessageNode: React.ReactNode;
};

export function AutoRenewPendingPanel() {
  return (
    <div className="glass-surface space-y-3 p-6 text-center text-[var(--muted-ink)] md:p-8">
      <h2 className="text-xl font-semibold text-[var(--brand-navy)]">Just a moment…</h2>
      <p className="text-sm">
        Confirming your membership and renewal options. This should only take a second.
      </p>
    </div>
  );
}

export function AutoRenewPromptPanel({
  greetingName,
  walletLinked,
  profileComplete,
  membershipStatus,
  autoRenewReady,
  autoRenewEnabled,
  autoRenewProcessing,
  autoRenewDismissed,
  onEnableAutoRenew,
  onSkipAutoRenew,
  autoRenewMessageNode,
}: AutoRenewPromptProps) {
  return (
    <div className="glass-surface space-y-6 p-6 md:p-8">
      <div className="text-center text-[var(--muted-ink)]">
        Hello {greetingName}! Your membership is active—finish setup by enabling auto-renew or skip it for now.
      </div>
      <OnboardingChecklist
        walletLinked={walletLinked}
        profileComplete={profileComplete}
        membershipStatus={membershipStatus}
        autoRenewReady={autoRenewReady}
        autoRenewEnabled={autoRenewEnabled}
        autoRenewProcessing={autoRenewProcessing}
        autoRenewDismissed={autoRenewDismissed}
        onEnableAutoRenew={onEnableAutoRenew}
        onSkipAutoRenew={onSkipAutoRenew}
      />
      {autoRenewMessageNode}
    </div>
  );
}

type ActiveMemberProps = {
  greetingName: string;
  memberLevelLabel: string;
  autoRenewMessageNode: React.ReactNode;
  walletLinked: boolean;
  profileComplete: boolean;
  upcomingNfts: UpcomingItem[] | null;
  onRsvp: (lockAddress: string | null | undefined, fallbackUrl?: string | null, details?: EventDetails) => void;
  rsvpProcessing?: boolean;
  onCancelRsvp?: (params: { lockAddress: string; recipient: string; tokenId: string }) => void;
  cancelRsvpProcessing?: boolean;
  displayNfts: DisplayNft[];
  showAllNfts: boolean;
  onToggleShowAll: (value: boolean) => void;
  missedNfts: DisplayNft[] | null;
  missedKeySet: Set<string>;
  creatorNftsLoading: boolean;
  creatorNftsError: string | null;
  creatorNfts: DisplayNft[] | null | undefined;
};

export function ActiveMemberPanel({
  greetingName,
  memberLevelLabel,
  autoRenewMessageNode,
  walletLinked,
  profileComplete,
  upcomingNfts,
  onRsvp,
  rsvpProcessing = false,
  onCancelRsvp,
  cancelRsvpProcessing = false,
  displayNfts,
  showAllNfts,
  onToggleShowAll,
  missedNfts,
  missedKeySet,
  creatorNftsLoading,
  creatorNftsError,
  creatorNfts,
}: ActiveMemberProps) {
  const [activeTab, setActiveTab] = useState<"rsvp" | "upcoming" | "past">("rsvp");
  const currentYear = DateTime.now().year;
  const [selectedPastYear, setSelectedPastYear] = useState<number>(currentYear);
  const ownedKeySet = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(creatorNfts)) {
      for (const nft of creatorNfts) {
        set.add(buildNftKey(nft.contractAddress, nft.tokenId ?? "upcoming"));
      }
    }
    return set;
  }, [creatorNfts]);
  const rsvpMeetings = useMemo(() => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const maxFutureSec = nowSec + 60 * 60 * 24 * 366;
    const isReasonableFutureExpiration = (expiresAt?: number | null) =>
      typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > nowSec && expiresAt <= maxFutureSec;
    return displayNfts.filter((nft) => {
      if (!isMeetingNft(nft)) return false;
      if (MEMBERSHIP_TIER_ADDRESSES.has(nft.contractAddress.toLowerCase())) return false;
      const key = buildNftKey(nft.contractAddress, nft.tokenId ?? "upcoming");
      if (!ownedKeySet.has(key)) return false;
      const timestamp = resolveEventTimestamp(nft);
      if (typeof timestamp === "number") return timestamp > now;
      return isReasonableFutureExpiration(nft.expiresAt);
    });
  }, [displayNfts, ownedKeySet]);
  const pastMeetings = useMemo(() => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const maxFutureSec = nowSec + 60 * 60 * 24 * 366;
    const isReasonableFutureExpiration = (expiresAt?: number | null) =>
      typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > nowSec && expiresAt <= maxFutureSec;
    return displayNfts.filter((nft) => {
      if (!isMeetingNft(nft)) return false;
      if (MEMBERSHIP_TIER_ADDRESSES.has(nft.contractAddress.toLowerCase())) return false;
      const timestamp = resolveEventTimestamp(nft);
      if (typeof timestamp === "number") return timestamp <= now;
      return !isReasonableFutureExpiration(nft.expiresAt);
    });
  }, [displayNfts]);
  const availablePastYears = useMemo(() => {
    const years = new Set<number>();
    years.add(currentYear);
    for (const meeting of pastMeetings) {
      const year = resolveEventYear(meeting);
      if (year) years.add(year);
    }
    const previewYear = currentYear + 1;
    years.add(previewYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [currentYear, pastMeetings]);
  const pastYearOptions = useMemo(
    () =>
      availablePastYears.map((year) => ({
        value: String(year),
        label: year > currentYear ? `${year} (coming soon)` : String(year),
        disabled: year > currentYear,
      })),
    [availablePastYears, currentYear]
  );
  const pastMeetingsForYear = useMemo(
    () => pastMeetings.filter((nft) => resolveEventYear(nft) === selectedPastYear),
    [pastMeetings, selectedPastYear]
  );
  const missedNftsForYear = useMemo(() => {
    if (!Array.isArray(missedNfts)) return missedNfts;
    return missedNfts.filter((nft) => resolveEventYear(nft) === selectedPastYear);
  }, [missedNfts, selectedPastYear]);
  const missedKeySetForYear = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(missedNftsForYear)) {
      for (const entry of missedNftsForYear) {
        set.add(buildNftKey(entry.contractAddress, entry.tokenId ?? "upcoming"));
      }
    }
    return set;
  }, [missedNftsForYear]);
  const upcomingItems = Array.isArray(upcomingNfts) ? upcomingNfts : [];
  const tabs = [
    { id: "rsvp" as const, label: "Your RSVPs" },
    { id: "upcoming" as const, label: "Upcoming meetings" },
    { id: "past" as const, label: "Past meetings" },
  ];
  return (
    <div className="space-y-8">
      <section className="glass-surface p-6 text-center text-[var(--muted-ink)] md:p-8 md:text-left">
        <p>
          Hello {greetingName}! Thank you for being a {memberLevelLabel} member.
        </p>
      </section>
      {autoRenewMessageNode}
      {walletLinked && profileComplete ? (
        <section className="grid gap-5 md:grid-cols-[minmax(0,1fr)]">
          <div className="glass-item space-y-3 p-5 md:col-span-2">
            <h2 className="text-lg font-semibold text-[var(--brand-navy)]">News & Updates</h2>
            <p className="text-sm text-[var(--muted-ink)]">
              Member announcements and updates will appear here.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
              Meetings
            </div>
            <div className="flex flex-wrap gap-2" role="tablist">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      isActive
                        ? "border-[var(--brand-denim)] bg-[rgba(67,119,243,0.18)] text-[var(--brand-navy)] font-bold shadow-sm ring-2 ring-[rgba(67,119,243,0.35)]"
                        : "border-[rgba(30,57,91,0.15)] bg-white/70 text-[var(--brand-navy)] hover:border-[var(--brand-navy)]"
                    }`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {activeTab === "rsvp" ? (
            <NftCollectionLazy
              title="Your RSVPs"
              displayNfts={rsvpMeetings}
              showAllNfts={false}
              onToggleShowAll={() => {}}
              missedNfts={missedNfts}
              missedKeySet={missedKeySet}
              loading={creatorNftsLoading}
              error={creatorNftsError}
              creatorNfts={creatorNfts}
              loadingMessage="Loading your RSVPs…"
              emptyMessage="You have not RSVPd for any meetings yet."
              showMissedToggle={false}
              onCancelRsvp={onCancelRsvp}
              cancelRsvpProcessing={cancelRsvpProcessing}
            />
          ) : null}

          {activeTab === "upcoming" ? (
            upcomingItems.length > 0 ? (
              <UpcomingMeetingsLazy
                items={upcomingItems}
                show={true}
                onToggleShow={() => {}}
                onRsvp={onRsvp}
                rsvpProcessing={rsvpProcessing}
                showToggle={false}
              />
            ) : (
              <div className="glass-item p-5 text-sm text-[var(--muted-ink)] md:col-span-2">
                No upcoming meetings available yet. Please check back soon.
              </div>
            )
          ) : null}

          {activeTab === "past" ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3 md:col-span-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                  Filter by year
                </div>
                <Select
                  label="Year"
                  options={pastYearOptions}
                  value={String(selectedPastYear)}
                  onChange={(value) => setSelectedPastYear(Number(value))}
                  className="min-w-[140px]"
                />
              </div>
              <NftCollectionLazy
                title="Past meetings"
                displayNfts={pastMeetingsForYear}
                showAllNfts={showAllNfts}
                onToggleShowAll={onToggleShowAll}
                missedNfts={missedNftsForYear}
                missedKeySet={missedKeySetForYear}
                loading={creatorNftsLoading}
                error={creatorNftsError}
                creatorNfts={creatorNfts}
                loadingMessage="Loading past meetings…"
                emptyMessage={`No past meetings found for ${selectedPastYear}.`}
                onCancelRsvp={onCancelRsvp}
                cancelRsvpProcessing={cancelRsvpProcessing}
              />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
