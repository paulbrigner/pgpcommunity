# Home Page Performance Options (app/home-client.tsx)

This doc lists practical ways to reduce initial load and perceived latency on the home page, with rough impact expectations. Most are additive; pick the low-effort/high-win items first.

## Completed
- Dynamic imports with skeletons: `UpcomingMeetings` and `NftCollection` are lazy-loaded with skeleton fallbacks; added `HomeShellSkeleton` at the page entry so the hero/skeleton render immediately while client JS loads.
- Markdown split: Markdown rendering is dynamically imported in `NftCollection` to keep the main bundle lean.
- React Query tuning: increased `staleTime`/`gcTime` (5m/15m) and prefetches NFTs on home navigation for authenticated, wallet-linked users to avoid duplicate fetches.
- Membership caching: membership snapshot TTL increased to ~3 minutes; home page uses cached snapshot instead of force refresh; added `/api/membership/invalidate` and checkout invalidation to bust cache when status changes.
- Server-side bootstrap: membership and NFT data are prefetched on the server and passed as initial data to hydrate React Query, removing extra client round-trips on initial render/navigation.

## Outstanding / Next
- Bundle analysis: run `next build --analyze` to spot remaining heavy chunks (hero media, Markdown, etc.) and create more dynamic splits if needed.
- Optimize hero media: ensure hero/profile images are as small as possible and use modern formats (WebP/AVIF).
- Network/API efficiency: consider batching membership + NFT initial fetch into a single call.
- Virtualize long lists: if NFT counts grow, add windowing to keep scroll performance smooth.

## Additional options (longer-term)
- Edge/ISR for semi-static content (news/updates) to reduce server time.
- Tree-shake client config and ensure no server-only config leaks into client bundles.
- Debounce/guard any remaining effects that might re-run unnecessarily.

Impact expectations remain approximate; the completed steps already improve perceived first paint by showing the banner/skeleton immediately and reducing redundant fetches. The outstanding items target further JS reduction and fewer round-trips.
