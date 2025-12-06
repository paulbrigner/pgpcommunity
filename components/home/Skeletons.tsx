import React from "react";

export function HomeShellSkeleton() {
  return (
    <div className="relative mx-auto w-full max-w-6xl space-y-12 px-4 md:px-6 animate-pulse">
      <section className="community-hero p-8 md:p-12">
        <div className="community-hero__frame">
          <div className="community-hero__content mx-auto flex w-full max-w-4xl flex-col items-center gap-8 text-center md:flex-row md:items-stretch md:gap-12 md:text-left">
            <div className="flex flex-1 flex-col gap-4 md:max-w-xl">
              <div className="h-4 w-40 rounded bg-white/30" />
              <div className="space-y-3">
                <div className="h-8 w-48 rounded bg-white/40 md:h-10" />
                <div className="h-3 w-full max-w-md rounded bg-white/25 md:h-4" />
                <div className="h-3 w-2/3 rounded bg-white/20 md:h-4" />
              </div>
              <div className="flex gap-3">
                <div className="h-10 w-32 rounded-lg bg-white/50" />
                <div className="h-10 w-32 rounded-lg border border-white/30 bg-white/20" />
              </div>
            </div>
            <div className="mx-auto flex-shrink-0 rounded-[1.9rem] border border-white/20 bg-white/10 p-[6px] shadow-[0_28px_48px_-28px_rgba(11,11,67,0.55)] backdrop-blur-lg md:mx-0 md:self-center">
              <div className="relative h-28 w-28 overflow-hidden rounded-[1.6rem] bg-white/20 md:h-40 md:w-40" />
            </div>
          </div>
        </div>
      </section>
      <div className="space-y-4 rounded-2xl border border-white/20 bg-white/30 p-6 shadow-sm">
        <div className="h-4 w-56 rounded bg-white/50" />
        <div className="h-3 w-full max-w-lg rounded bg-white/30" />
      </div>
      <NftCollectionSkeleton />
    </div>
  );
}

export function UpcomingMeetingsSkeleton() {
  return (
    <div className="glass-item space-y-4 p-5 md:col-span-2 animate-pulse">
      <div className="flex items-center justify-between gap-2">
        <div className="h-5 w-40 rounded bg-slate-200/70" />
        <div className="h-4 w-32 rounded bg-slate-200/60" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((key) => (
          <div key={key} className="muted-card flex gap-3 p-3">
            <div className="h-20 w-20 shrink-0 rounded-md bg-slate-200/70" />
            <div className="min-w-0 space-y-2">
              <div className="h-4 w-36 rounded bg-slate-200/80" />
              <div className="h-3 w-28 rounded bg-slate-200/70" />
              <div className="h-3 w-32 rounded bg-slate-200/60" />
              <div className="h-3 w-24 rounded bg-slate-200/50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NftCollectionSkeleton() {
  return (
    <div className="glass-item space-y-4 p-5 md:col-span-2 animate-pulse">
      <div className="h-5 w-48 rounded bg-slate-200/70" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((key) => (
          <div key={key} className="muted-card flex gap-3 p-3">
            <div className="h-20 w-20 shrink-0 rounded-md bg-slate-200/70" />
            <div className="min-w-0 space-y-2">
              <div className="h-4 w-32 rounded bg-slate-200/80" />
              <div className="h-3 w-24 rounded bg-slate-200/70" />
              <div className="h-3 w-28 rounded bg-slate-200/60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
