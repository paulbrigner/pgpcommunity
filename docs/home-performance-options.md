# Home Page Performance Options (app/home-client.tsx)

This doc lists practical ways to reduce initial load and perceived latency on the home page, with rough impact expectations. Most are additive; pick the low-effort/high-win items first.

## Completed
- Dynamic imports with skeletons: `UpcomingMeetings` and `NftCollection` are lazy-loaded with skeleton fallbacks; added `HomeShellSkeleton` at the page entry so the hero/skeleton render immediately while client JS loads.
- Markdown split: Markdown rendering is dynamically imported in `NftCollection` to keep the main bundle lean.
- React Query tuning: increased `staleTime`/`gcTime` (5m/15m) and prefetches NFTs on home navigation for authenticated, wallet-linked users to avoid duplicate fetches.
- Membership caching: membership snapshot TTL increased to ~3 minutes; home page uses cached snapshot instead of force refresh; added `/api/membership/invalidate` and checkout invalidation to bust cache when status changes.
- Server-side bootstrap: membership and NFT data are prefetched on the server and passed as initial data to hydrate React Query, removing extra client round-trips on initial render/navigation.
- Navigation “instant paint” + hydrate:
  - Loading skeleton: added `app/loading.tsx` with `HomeShellSkeleton` so navigation to Home shows the shell immediately while hydration continues.
  - Defer revalidation when data is fresh: React Query uses `initialDataUpdatedAt` and `refetchOnMount=false` to show cached membership/NFT snapshots instantly.
  - Prefetch from heavy pages: Edit Profile prefetches the Home NFT query into the shared QueryClient; navigation back to Home reuses it instead of refetching.
  - Membership snapshot prefetch: Edit Profile seeds the membership query with the session snapshot so Home can hydrate membership instantly and revalidate in the background.
  - Streamed SSR: wrapped HomeClient in a Suspense boundary with `HomeShellSkeleton` fallback to stream the shell while client code hydrates.

## Outstanding / Next
- Bundle analysis: run `next build --analyze` to spot remaining heavy chunks (hero media, Markdown, etc.) and create more dynamic splits if needed.
- Optimize hero media: ensure hero/profile images are as small as possible and use modern formats (WebP/AVIF).
- Network/API efficiency: consider batching membership + NFT initial fetch into a single call.
- Virtualize long lists: if NFT counts grow, add windowing to keep scroll performance smooth.
- Navigation “instant paint” + hydrate (Home):
  - Strict first-render effects (ongoing): guard mount effects so they don’t block paint; move heavy refreshes to background/intent.

## Bundle analysis snapshot (npm run build)
- Home (`/`): 607 kB first-load JS; page bundle 38 kB. Shared chunk baseline is 102 kB.
- Settings/Profile: 125 kB first-load JS.
- Settings/Profile/Membership: 504 kB first-load JS (heavier client chunk).
- Signin: 355 kB first-load JS.
- Admin: 163 kB first-load JS.
- Key shared chunks: `1255-…` (45.4 kB), `4bd1b696-…` (54.2 kB) dominate shared JS.
Recommendations:
- Prioritize slimming the Home shared payload: consider further dynamic splits for heavy client-only utilities (checkout/Unlock, large icons, Markdown) and ensure large libraries aren’t bundled into the shared chunk.
- Profile/Membership page is large; consider code-splitting checkout/auto-renew UI there and lazy-loading less-common panels.

## Additional options (longer-term)
- Edge/ISR for semi-static content (news/updates) to reduce server time.
- Tree-shake client config and ensure no server-only config leaks into client bundles.
- Debounce/guard any remaining effects that might re-run unnecessarily.

Impact expectations remain approximate; the completed steps already improve perceived first paint by showing the banner/skeleton immediately and reducing redundant fetches. The outstanding items target further JS reduction and fewer round-trips.
