import React from "react";
import dynamic from "next/dynamic";
import { OnboardingChecklist } from "@/components/site/OnboardingChecklist";
import { NftCollectionSkeleton, UpcomingMeetingsSkeleton } from "@/components/home/Skeletons";
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
  showUpcomingNfts: boolean;
  onToggleUpcoming: (value: boolean) => void;
  onRsvp: (lockAddress: string | null | undefined, fallbackUrl?: string | null, details?: EventDetails) => void;
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
  showUpcomingNfts,
  onToggleUpcoming,
  onRsvp,
  displayNfts,
  showAllNfts,
  onToggleShowAll,
  missedNfts,
  missedKeySet,
  creatorNftsLoading,
  creatorNftsError,
  creatorNfts,
}: ActiveMemberProps) {
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

          {upcomingNfts && upcomingNfts.length > 0 ? (
            <UpcomingMeetingsLazy
              items={upcomingNfts}
              show={showUpcomingNfts}
              onToggleShow={onToggleUpcoming}
              onRsvp={onRsvp}
            />
          ) : null}

          <NftCollectionLazy
            displayNfts={displayNfts}
            showAllNfts={showAllNfts}
            onToggleShowAll={onToggleShowAll}
            missedNfts={missedNfts}
            missedKeySet={missedKeySet}
            loading={creatorNftsLoading}
            error={creatorNftsError}
            creatorNfts={creatorNfts}
          />
        </section>
      ) : null}
    </div>
  );
}
