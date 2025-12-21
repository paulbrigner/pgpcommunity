// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ActiveMemberPanel, AutoRenewPendingPanel, AutoRenewPromptPanel } from "@/components/home/MembershipPanels";

const upcoming = [{
  contractAddress: "0xlock",
  title: "Future Event",
  description: "Desc",
  subtitle: "Jan 20",
  startTime: "10:00",
  endTime: "11:00",
  timezone: "UTC",
  location: "Online",
  image: null,
  registrationUrl: "https://event.test",
  quickCheckoutLock: "0xquick",
}];

const nft = {
  owner: "0xowner",
  contractAddress: "0xlock",
  tokenId: "1",
  title: "Weekly Meetup",
  description: "A gathering",
  subtitle: "Subtitle",
  eventDate: "2025-01-20",
  startTime: "10:00",
  endTime: "11:00",
  timezone: "UTC",
  location: "Online",
  image: null,
  collectionName: "PGP",
  tokenType: "ERC721",
  videoUrl: "https://video.test",
  sortKey: 1,
};

export default {
  title: "Home/MembershipPanels",
} satisfies Meta;

type Story = StoryObj;

export const Pending: Story = {
  render: () => <AutoRenewPendingPanel />,
};

export const Prompt: Story = {
  render: () => (
    <AutoRenewPromptPanel
      greetingName="Alice"
      walletLinked
      profileComplete
      membershipStatus="active"
      autoRenewReady
      autoRenewEnabled={false}
      autoRenewProcessing={false}
      autoRenewDismissed={false}
      onEnableAutoRenew={() => {}}
      onSkipAutoRenew={() => {}}
      autoRenewMessageNode={<div>Enable auto-renew to stay current.</div>}
    />
  ),
};

export const Active: Story = {
  render: () => (
    <ActiveMemberPanel
      greetingName="Alice"
      memberLevelLabel="Gold"
      autoRenewMessageNode={<div>Auto-renew ready.</div>}
      walletLinked
      profileComplete
      upcomingNfts={upcoming}
      onRsvp={() => {}}
      displayNfts={[nft]}
      showAllNfts={false}
      onToggleShowAll={() => {}}
      missedNfts={[]}
      missedKeySet={new Set()}
      creatorNftsLoading={false}
      creatorNftsError={null}
      creatorNfts={[nft]}
    />
  ),
};
