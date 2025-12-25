# Admin Page Performance Options

This doc outlines practical steps to improve load and interaction performance on the admin page. The admin surface usually loads heavier data (members, NFTs, refunds), so focus on data-fetch efficiency, bundle size, and perceived responsiveness.

## 1) Reduce shipped JavaScript
- **Dynamic imports for heavy panels**: Lazy-load rarely used admin panels (refund queues, bulk email tools, charts) with suspense fallbacks. Potential: defer 20–50 kB until those panels are opened. ✅ Admin shell now uses a dynamic client import with a skeleton fallback to improve perceived load.
- **Client/server split**: Move data fetching to server components/routes where possible so the client bundle carries only UI/render logic. Potential: 10–25% less JS for admin route.
- **Prune unused deps**: Ensure admin-only utilities aren’t pulled into shared bundles; isolate in the admin route folder. Potential: small (<5%) but avoids leaks into other routes.

## 2) Data fetching and caching
- **React Query tuning**: Use generous `staleTime` for slow-changing datasets (e.g., member lists), shorter for volatile queues (refund requests). Pre-fetch lists when navigating to admin. Potential: 100–300 ms saved per revisit.
- **Cursor/paginated queries**: Fetch members/refunds in pages, not all at once. Potential: first paint much faster on large datasets; reduces memory/CPU.
- **Server-side filtering/search**: Do search/sort/filter on the server to avoid shipping large lists to the client. Potential: significant when data grows (hundreds/thousands of rows).
- **Batch related data**: Combine common lookups (members + token IDs + allowances) into a single API call when loading the dashboard. Potential: save 1–2 RTTs (~50–400 ms).
- **Background roster cache rebuild (implemented)**: Offload cache rebuilds to a standalone Lambda (SAM) that runs on a schedule and via the “Rebuild cache” button, avoiding Amplify request timeouts.

## 3) Optimize rendering
- **Virtualize tables/lists**: Use windowing for member/refund tables when row counts grow. Potential: stable frames for >100 rows, avoids layout thrash.
- **Memoize derived views**: Memoize filtered/sorted arrays and expensive cell renders; avoid recomputing on every keystroke. Potential: smoother typing/search.
- **Debounce inputs**: Debounce search/filter inputs to reduce query churn. Potential: fewer network calls and renders under fast typing.

## 4) Perceived performance
- **Skeletons/placeholders**: Show table skeleton rows and card placeholders while data loads. Potential: better perceived speed; no network savings.
- **Progressive disclosure**: Collapse advanced sections (bulk actions, charts) and load on expand. Potential: defers non-critical work until requested.
- **Optimized media**: If avatars or NFT thumbnails appear in admin, use small/optimized images and lazy loading. Potential: tens to hundreds of ms saved on slow networks.

## 5) Network/API efficiency
- **Edge caching for static/admin assets**: Ensure static assets and admin UI bundles use proper cache headers/CDN. Potential: 50–200 ms per asset on cold loads.
- **Server streaming/SSR**: For admin dashboards, SSR critical counts/stats so the shell appears with data immediately, then hydrate for interactions. Potential: removes a client round-trip for initial metrics.
- **Rate-limit retries and backoff**: For admin API calls, use sensible retry/backoff to avoid hammering backend under transient errors; improves stability under load.

## 6) Build-time safeguards
- **Bundle analysis**: Run `next build --analyze` on the admin route to spot heavy chunks (charts, rich text) and move them to dynamic imports. Potential: identify 10–30% JS reduction.
- **Tree-shake config**: Keep server-only secrets/config out of client bundles; ensure admin-only config isn’t imported globally.

## Suggested rollout sequence
1) Add skeletons for admin tables/cards and lazy-load heavy/optional panels with suspense fallbacks.
2) Switch member/refund lists to paginated/virtualized views; debounce search/filter and memoize derived arrays.
3) Tune React Query caching (staleTime/gcTime) and prefetch when navigating to admin.
4) Run bundle analyzer for the admin route; dynamically import charts/bulk-email tools.
5) Add SSR/streaming for key stats/counts to avoid an extra client fetch on initial render.

Impact expectations are approximate; combined, these steps can reduce initial JS by 15–30% and cut first meaningful paint by a few hundred milliseconds, while keeping admin interactions smooth on large datasets.
