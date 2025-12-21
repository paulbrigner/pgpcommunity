import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

describe("MembershipPanels", () => {
  it("renders pending and prompt panels without crash", () => {
    render(<AutoRenewPendingPanel />);
    expect(screen.getByText(/just a moment/i)).toBeInTheDocument();

    render(
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
        autoRenewMessageNode={null}
      />
    );
    expect(screen.getByText(/finish setup by enabling auto-renew/i)).toBeInTheDocument();
  });

  it("renders active member panel with upcoming meetings and NFT collection and triggers RSVP", () => {
    const onRsvp = vi.fn();
    render(
      <ActiveMemberPanel
        greetingName="Alice"
        memberLevelLabel="Gold"
        autoRenewMessageNode={<div data-testid="auto-msg">msg</div>}
        walletLinked
        profileComplete
        upcomingNfts={upcoming}
        onRsvp={onRsvp}
        displayNfts={[nft]}
        showAllNfts={false}
        onToggleShowAll={() => {}}
        missedNfts={[]}
        missedKeySet={new Set()}
        creatorNftsLoading={false}
        creatorNftsError={null}
        creatorNfts={[nft]}
      />
    );

    expect(screen.getByText(/thank you for being a gold member/i)).toBeInTheDocument();
    expect(screen.getByText(/news & updates/i)).toBeInTheDocument();
    const upcomingTab = screen.getByRole("tab", { name: /upcoming meetings/i });
    fireEvent.click(upcomingTab);
    const rsvpButtons = screen.getAllByRole("button", { name: /rsvp now/i });
    fireEvent.click(rsvpButtons[rsvpButtons.length - 1]);
    expect(onRsvp).toHaveBeenCalled();
  });
});
