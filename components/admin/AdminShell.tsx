"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import {
  AdminSensitiveDataProvider,
  SensitiveDataText,
  SensitiveDataToggleButton,
} from "@/components/admin/sensitive-data";

type Props = {
  children: ReactNode;
  name: string;
  email?: string | null;
};

export function AdminShell({ children, name, email }: Props) {
  return (
    <AdminSensitiveDataProvider>
      <div className="mx-auto max-w-6xl space-y-6 px-5 pb-14">
        <div className="glass-surface relative overflow-hidden border border-white/40 bg-white/80 p-6 shadow-[0_26px_46px_-26px_rgba(11,11,67,0.38)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1.5">
              <p className="section-eyebrow text-[var(--brand-denim)]">Admin Console</p>
              <h1 className="text-3xl font-semibold text-[#0b0b43] sm:text-3xl">PGP Community</h1>
              <p className="text-sm text-muted-foreground">
                Signed in as <SensitiveDataText value={name} kind="name" fallback="Admin" />
                {email ? (
                  <>
                    {" - "}
                    <SensitiveDataText value={email} kind="email" />
                  </>
                ) : null}
                . Admin tools surface membership health, wallets, and messaging.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(67,119,243,0.3)] bg-[rgba(67,119,243,0.08)] px-4 py-2 text-[0.9rem] font-semibold text-[var(--brand-denim)] shadow-[0_10px_30px_-18px_rgba(11,11,67,0.45)]">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                Admin access
              </div>
              <SensitiveDataToggleButton />
            </div>
          </div>
          <div className="pointer-events-none absolute -left-14 -top-20 h-36 w-36 rounded-full bg-[rgba(67,119,243,0.15)] blur-3xl" />
          <div className="pointer-events-none absolute -right-6 bottom-0 h-24 w-24 rounded-full bg-[rgba(11,11,67,0.08)] blur-3xl" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin"
            className="rounded-full border border-[rgba(67,119,243,0.25)] bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-denim)] transition hover:border-[rgba(67,119,243,0.45)]"
          >
            Member roster
          </Link>
          <Link
            href="/admin/events"
            className="rounded-full border border-[rgba(67,119,243,0.25)] bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-denim)] transition hover:border-[rgba(67,119,243,0.45)]"
          >
            Event metadata
          </Link>
          <Link
            href="/admin/membership-metadata"
            className="rounded-full border border-[rgba(67,119,243,0.25)] bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-denim)] transition hover:border-[rgba(67,119,243,0.45)]"
          >
            Membership metadata
          </Link>
        </div>
        {children}
      </div>
    </AdminSensitiveDataProvider>
  );
}
