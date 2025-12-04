// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { UpcomingMeetings } from "@/components/home/UpcomingMeetings";

const baseItem = {
  contractAddress: "0xlock",
  title: "Future Event",
  description: "Deep dive on governance.",
  subtitle: "Jan 20",
  startTime: "10:00",
  endTime: "11:00",
  timezone: "UTC",
  location: "Online",
  image: null,
  registrationUrl: "https://event.test",
  quickCheckoutLock: "0xquick",
};

const meta: Meta<typeof UpcomingMeetings> = {
  title: "Home/UpcomingMeetings",
  component: UpcomingMeetings,
  args: {
    show: true,
    onToggleShow: () => {},
    onRsvp: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof UpcomingMeetings>;

export const Default: Story = {
  args: {
    items: [baseItem],
  },
};

export const Hidden: Story = {
  args: {
    show: false,
    items: [baseItem],
  },
};

export const MissingLink: Story = {
  args: {
    items: [{ ...baseItem, contractAddress: "", registrationUrl: "" }],
  },
};
