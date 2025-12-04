# Home Page Maintainability Plan (app/home-client.tsx)

This document outlines the remaining refactors to make the home page easier to understand, test, and evolve.

## 1) Extract membership state into a hook (`useMembership`) — completed
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
  - Status: Implemented in `lib/hooks/use-membership.ts`; `home-client.tsx` now consumes it and legacy refs/cache were removed.

## 2) Introduce query caching for membership/NFTs (completed via React Query)
Implemented with React Query keys `["membership", addressesKey]` and `["nfts", addressesKey]`. The app is wrapped in a `QueryClientProvider` with sensible `staleTime`/`gcTime`, retries, and no refetch-on-focus. Refetches are triggered after checkout (`onMembershipComplete/onEventComplete`) and on address changes. Manual fetch sequencing/localStorage caching was removed in favor of React Query’s cache.

## 3) Cleanup and dead code removal — completed
- Unused helpers/imports removed in `home-client.tsx` after component splits.
- Unused viewer block/state removed from `home-client.tsx`; `MembershipPanels` simplified.
- Duplicate constants avoided; auto-renew helpers retained in one place.

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
  - Status: `docs/home-architecture.md` created; expand if more detail is needed.

## 6) Rollout steps
- Implement `useMembership` first; wire `home-client.tsx` to it; remove legacy membership refs/caches.
- Switch NFT/member data to SWR/Query; drop manual fetch seq/localStorage if covered.
- Run lint/build; add/adjust tests; update docs.

## 7) Nice-to-have polish
- Consolidate RSVP/event detail model so both `UpcomingMeetings` and checkout share the same type.
- Add loading/skeleton states for membership and NFTs via the hooks.
- Ensure transaction hash link shows only when a valid hash is present (already improved, keep guard). 
