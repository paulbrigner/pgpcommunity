import type { Meta, StoryObj } from "@storybook/react";
import { NftCollection } from "@/components/home/NftCollection";

const baseNft = {
  owner: "0xowner",
  contractAddress: "0xlock",
  tokenId: "1",
  title: "Weekly Meetup",
  description: "A gathering of PGP members with agenda and discussion.",
  subtitle: "January session",
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

const meta: Meta<typeof NftCollection> = {
  title: "Home/NftCollection",
  component: NftCollection,
  args: {
    showAllNfts: false,
    onToggleShowAll: () => {},
    loading: false,
    error: null,
  },
};

export default meta;
type Story = StoryObj<typeof NftCollection>;

export const Default: Story = {
  args: {
    displayNfts: [baseNft],
    missedNfts: [],
    missedKeySet: new Set(),
    creatorNfts: [baseNft],
  },
};

export const WithMissed: Story = {
  args: {
    displayNfts: [baseNft],
    missedNfts: [baseNft],
    missedKeySet: new Set(["0xlock-1"]),
    showAllNfts: true,
    creatorNfts: [],
  },
};

export const Loading: Story = {
  args: {
    displayNfts: [],
    missedNfts: [],
    missedKeySet: new Set(),
    loading: true,
  },
};

export const ErrorState: Story = {
  args: {
    displayNfts: [],
    missedNfts: [],
    missedKeySet: new Set(),
    error: "Failed to load NFTs",
  },
};
