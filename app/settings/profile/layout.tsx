"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; segment: string | null };

const NAV_ITEMS: NavItem[] = [
  { href: "/settings/profile", label: "Profile", segment: null },
  { href: "/settings/profile/membership", label: "Membership", segment: "membership" },
];

export default function ProfileLayout({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">Profile Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage your profile details, membership renewals, and linked wallets from one place.
        </p>
      </div>
      <div className="border-b">
        <nav className="flex flex-wrap gap-2 -mb-px text-sm">
          {NAV_ITEMS.map((item) => {
            const active = segment === item.segment;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-3 py-2 border-b-2 transition-colors",
                  active
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-primary"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
