import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NftCollection } from "@/components/home/NftCollection";

vi.mock("@/lib/home-utils", () => ({
  buildNftKey: (addr: string, tokenId: string) => `${addr}-${tokenId}`,
  buildCalendarLinks: () => ({ google: "https://google.test", ics: "ICS_DATA" }),
  downloadIcs: vi.fn(),
  formatEventDisplay: () => ({ dateLabel: "Jan 1", timeLabel: "10:00 AM" }),
  stripMarkdown: (value: string) => value,
}));

describe("NftCollection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T12:00:00Z"));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const baseNft = {
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

  it("shows loading and error states", () => {
    const { rerender } = render(
      <NftCollection
        displayNfts={[]}
        showAllNfts={false}
        onToggleShowAll={() => {}}
        missedNfts={[]}
        missedKeySet={new Set()}
        loading={true}
        error={null}
      />
    );
    expect(screen.getByText(/loading your collection/i)).toBeInTheDocument();

    rerender(
      <NftCollection
        displayNfts={[]}
        showAllNfts={false}
        onToggleShowAll={() => {}}
        missedNfts={[]}
        missedKeySet={new Set()}
        loading={false}
        error="oops"
      />
    );
    expect(screen.getByText(/oops/i)).toBeInTheDocument();
  });

  it("shows empty state when no NFTs", () => {
    render(
      <NftCollection
        displayNfts={[]}
        showAllNfts={false}
        onToggleShowAll={() => {}}
        missedNfts={[]}
        missedKeySet={new Set()}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByText(/no creator nfts or poaps/i)).toBeInTheDocument();
  });

  it("renders missed meetings toggle and highlights missed item in red when showAllNfts is true", () => {
    const missedKeySet = new Set<string>(["0xlock-1"]);
    const onToggle = vi.fn();
    const { container } = render(
      <NftCollection
        displayNfts={[baseNft]}
        showAllNfts={true}
        onToggleShowAll={onToggle}
        missedNfts={[baseNft]}
        missedKeySet={missedKeySet}
        loading={false}
        error={null}
      />
    );

    expect(screen.getByLabelText(/show meetings you missed/i)).toBeInTheDocument();
    const card = container.querySelector('[class*="muted-card"]');
    expect(card?.className).toContain("ring-[rgba(239,68,68,0.45)]");
  });

  it("marks upcoming owned registrations with blue ring", () => {
    const ownedNft = { ...baseNft };
    const { container } = render(
      <NftCollection
        displayNfts={[ownedNft]}
        showAllNfts={false}
        onToggleShowAll={() => {}}
        missedNfts={[]}
        missedKeySet={new Set()}
        loading={false}
        error={null}
        creatorNfts={[{ ...ownedNft, owner: "0xowner" }]}
      />
    );

    const card = container.querySelector('[class*="muted-card"]');
    expect(card?.className).toContain("ring-[rgba(67,119,243,0.45)]");
    expect(screen.getByText(/you're registered/i)).toBeInTheDocument();
  });

  it("allows toggling description preview", () => {
    render(
      <NftCollection
        displayNfts={[
          {
            ...baseNft,
            eventDate: null,
            startTime: null,
            endTime: null,
            description: "Long description with a link https://example.com",
          },
        ]}
        showAllNfts={false}
        onToggleShowAll={() => {}}
        missedNfts={[]}
        missedKeySet={new Set()}
        loading={false}
        error={null}
      />
    );

    const preview = screen.getByText(/long description/i);
    fireEvent.click(preview);
    expect(screen.getByText(/hide description/i)).toBeInTheDocument();
  });

  it("shows calendar actions when event details are present", () => {
    render(
      <NftCollection
        displayNfts={[baseNft]}
        showAllNfts={false}
        onToggleShowAll={() => {}}
        missedNfts={[]}
        missedKeySet={new Set()}
        loading={false}
        error={null}
      />
    );

    const googleLinks = screen.getAllByText(/add to google calendar/i);
    expect(googleLinks.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/download .ics/i)).toBeInTheDocument();
  });
});
