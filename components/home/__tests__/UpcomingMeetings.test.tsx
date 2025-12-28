import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { UpcomingMeetings } from "@/components/home/UpcomingMeetings";

const baseItem = {
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
};

describe("UpcomingMeetings", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when no items", () => {
    const { container } = render(
      <UpcomingMeetings items={[]} show={true} onToggleShow={() => {}} onRsvp={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows toggle off state message", () => {
    render(
      <UpcomingMeetings
        items={[baseItem]}
        show={false}
        onToggleShow={() => {}}
        onRsvp={() => {}}
      />
    );
    expect(screen.getByText(/show upcoming events/i)).toBeInTheDocument();
    expect(screen.getByText(/turn on to see upcoming meetings/i)).toBeInTheDocument();
  });

  it("disables RSVP when no lock or registration url", () => {
    render(
      <UpcomingMeetings
        items={[
          { ...baseItem, contractAddress: "", registrationUrl: "" },
        ]}
        show={true}
        onToggleShow={() => {}}
        onRsvp={() => {}}
      />
    );
    const btn = screen.getByRole("button", { name: /rsvp now/i });
    expect(btn).toBeDisabled();
  });

  it("calls onRsvp with quick checkout lock when provided", () => {
    const onRsvp = vi.fn();
    render(
      <UpcomingMeetings
        items={[baseItem]}
        show={true}
        onToggleShow={() => {}}
        onRsvp={onRsvp}
      />
    );

    const btns = screen.getAllByRole("button", { name: /rsvp now/i });
    fireEvent.click(btns[btns.length - 1]);
    expect(onRsvp).toHaveBeenCalledWith("0xquick", "https://event.test", expect.any(Object));
  });

  it("falls back to contract address when no quick checkout lock", () => {
    const onRsvp = vi.fn();
    render(
      <UpcomingMeetings
        items={[{ ...baseItem, quickCheckoutLock: null }]}
        show={true}
        onToggleShow={() => {}}
        onRsvp={onRsvp}
      />
    );
    const btns = screen.getAllByRole("button", { name: /rsvp now/i });
    fireEvent.click(btns[btns.length - 1]);
    expect(onRsvp).toHaveBeenCalledWith("0xlock", "https://event.test", expect.any(Object));
  });

  it("links to internal event details when contract address exists", () => {
    render(
      <UpcomingMeetings
        items={[baseItem]}
        show={true}
        onToggleShow={() => {}}
        onRsvp={() => {}}
      />
    );
    const links = screen.getAllByText(/view event details/i);
    expect(links[links.length - 1]).toHaveAttribute("href", "/events/0xlock");
  });

  it("falls back to external event details when contract address is missing", () => {
    render(
      <UpcomingMeetings
        items={[{ ...baseItem, contractAddress: "" }]}
        show={true}
        onToggleShow={() => {}}
        onRsvp={() => {}}
      />
    );
    const links = screen.getAllByText(/view event details/i);
    expect(links[links.length - 1]).toHaveAttribute("href", "https://event.test");
  });
});
