export function AdminShellSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 animate-pulse">
      <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
        <div className="h-6 w-48 rounded bg-slate-200/80" />
        <div className="h-4 w-64 rounded bg-slate-200/60" />
        <div className="flex flex-wrap gap-3">
          <div className="h-9 w-32 rounded-lg bg-slate-200/70" />
          <div className="h-9 w-32 rounded-lg bg-slate-200/50" />
          <div className="h-9 w-48 rounded-lg bg-slate-200/40" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="space-y-2 rounded-2xl border border-slate-200/60 bg-white/80 p-4 shadow-sm">
            <div className="h-3 w-20 rounded bg-slate-200/60" />
            <div className="h-6 w-24 rounded bg-slate-200/80" />
            <div className="h-3 w-16 rounded bg-slate-200/50" />
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-9 w-60 rounded bg-slate-200/70" />
          <div className="h-9 w-36 rounded bg-slate-200/60" />
          <div className="h-9 w-28 rounded bg-slate-200/50" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white/70 p-3">
              <div className="h-10 w-10 rounded-full bg-slate-200/70" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 rounded bg-slate-200/80" />
                <div className="flex gap-2">
                  <div className="h-3 w-24 rounded bg-slate-200/60" />
                  <div className="h-3 w-20 rounded bg-slate-200/50" />
                  <div className="h-3 w-28 rounded bg-slate-200/50" />
                </div>
              </div>
              <div className="h-8 w-20 rounded bg-slate-200/60" />
              <div className="h-8 w-20 rounded bg-slate-200/60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
