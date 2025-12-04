# Home Page Maintainability Plan (app/home-client.tsx)

This document outlines the remaining refactors to make the home page easier to understand, test, and evolve.

## 1) Extract membership state into a hook (`useMembership`)
- Scope: status/expiry, summary/tiers, allowances, tokenIds, auto-renew readiness, selected tier, refresh sequencing, last-known safeguards.
- Inputs: `session` (wallets/addresses), initial server props (summary/status/expiry/allowances/tokenIds), `ready/authenticated`.
- Outputs:
  - `membershipStatus`, `membershipSummary`, `membershipExpiry`
  - `allowances`, `tokenIds`
  - `autoRenew`: `ready`, `enabled`, `months`, `processing`, `message`, handlers for enable/skip
  - `selectedTierId`, setter and `currentTier`/`memberLevelLabel`
  - `refreshMembership()` with built-in stale-response guards (preserve last-known active).
- Behavior: preserve last-known active protection, keep 5-min client cache (optional via SWR cache), refresh after checkout.
- Placement: `lib/hooks/use-membership.ts`.
- Wiring: Replace membership-specific state/refs in `home-client.tsx` with the hook; pass hook outputs into existing panels.

## 2) Introduce query caching for membership/NFTs
Use React Query with keys `["membership", addressesKey]` and `["nfts", addressesKey, includeMissed]`. Set up a QueryClient and wrap the app with the provider. Enable retries/backoff and set reasonable `staleTime`/`cacheTime`. Trigger refetches after checkout (`onMembershipComplete/onEventComplete`), on address changes, and when toggling includeMissed. Expose mutations for membership/NFT refresh as needed.

Preserve current refresh flows:
- After checkout (`onMembershipComplete/onEventComplete`) → refetch membership/NFTs.
- On address changes → refetch.
- Keep short TTL, retry/backoff defaults.

Remove manual `lastKnownMembership`, `refreshSeq`, `localStorage` cache if React Query covers stale-while-revalidate; otherwise, keep minimal client cache for initial hydration only.

## 3) Cleanup and dead code removal
- Remove unused helpers/imports left in `home-client.tsx` now that `home-utils`, `NftCollection`, `UpcomingMeetings`, and `MembershipPanels` exist.
- Decide on the member tools/viewer block: either wire it (with a hook for signed URLs) or delete the commented block to reduce noise.
- Ensure there are no duplicate constants (e.g., `MAX_AUTO_RENEW_MONTHS` defined once).

## 4) Tests and stories
- Component tests (React Testing Library):
  - `UpcomingMeetings`: RSVP disabled when no contract/link, event details shown, sorts by title, calls `onRsvp`.
  - `NftCollection`: shows missed rings (red), upcoming registration rings (blue), calendar links, description toggle, video link.
  - `MembershipPanels`: renders pending/prompt/active flows with provided props.
- Hook tests:
  - `useMemberNfts`: happy path, error path, includeMissed toggle affects display ordering, refresh on force.
  - Future `useMembership`: applies initial props, preserves last-known active on stale downgrades, sets auto-renew readiness.
- Stories (Storybook or equivalent):
  - Upcoming meetings card variants, NFT card variants (owned/missed/future), membership panels states.

## 5) Documentation
- Add a short README near `app/home-client.tsx` (or `docs/home-architecture.md`) describing:
  - Data flow: membership fetch → RSVP checkout → refresh; NFT fetch; upcoming events; missed vs owned display.
  - Hook contracts: `useMembership`, `useMemberNfts`, `useEventRegistration`.
  - UI composition: which panels/components render under which membership state.
  - Env/config touchpoints: `CHECKOUT_CONFIGS`, `NEXT_PUBLIC_*` lock addresses, Base RPC, etc.

## 6) Rollout steps
- Implement `useMembership` first; wire `home-client.tsx` to it; remove legacy membership refs/caches.
- Switch NFT/member data to SWR/Query; drop manual fetch seq/localStorage if covered.
- Run lint/build; add/adjust tests; update docs.

## 7) Nice-to-have polish
- Consolidate RSVP/event detail model so both `UpcomingMeetings` and checkout share the same type.
- Add loading/skeleton states for membership and NFTs via the hooks.
- Ensure transaction hash link shows only when a valid hash is present (already improved, keep guard). 
