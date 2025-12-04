# Home Page Architecture (app/home-client.tsx)

## Overview
The home page now composes small hooks and UI components to keep concerns isolated:
- `useMembership`: fetches membership status/summary/expiry, allowances, and token IDs for the current addresses. Uses React Query for caching and preserves a previously active tier if a stale downgrade arrives.
- `useMemberNfts`: fetches owned, missed, and upcoming NFTs for the member; also provides a set of missed keys for styling.
- `useEventRegistration`: handles RSVP/membership checkout initiation through the Unlock checkout flows.
- UI slices: `UpcomingMeetings`, `NftCollection`, and `MembershipPanels` render the main sections based on the hook data.

## Data Flow
- Membership: `home-client` builds `addressesKey` from linked wallets → `useMembership` queries `/api/actions/membership-state` via `fetchMembershipStateSnapshot` → response is normalized with `snapshotToMembershipSummary` → React Query caches results for 3 minutes and keeps them for 10.
- NFTs: `useMemberNfts` queries `/api/nfts?addresses=${addressesKey}` → returns owned/missed/upcoming → React Query caches with the same TTLs. Toggling “show missed” uses the same cache, just a different projection.
- RSVP/Checkout: `useEventRegistration` calls `openMembershipCheckout` or `openEventCheckout` (from `useUnlockCheckout`) based on the target. On completion, membership and NFT queries are refetched to reflect new keys.

## Refresh Triggers
- After checkout completion (`onMembershipComplete`, `onEventComplete`) → refetch membership/NFT queries.
- Address changes (`addressesKey`) → queries rerun automatically via React Query.
- Manual refresh: `useMemberNfts.refresh()` and `useMembership.refreshMembership()` call `refetch` with current keys.

## UI Composition
- Auth state gates the rendering paths: unauthenticated landing, unknown (loading), active member panels, or purchase flow.
- `MembershipPanels` handle auto-renew prompting and active member views; `NftCollection` displays owned/missed/future NFTs with badges; `UpcomingMeetings` manages RSVP vs. event details links.

## Config Touchpoints
- Membership tiers and network constants live in `lib/config` and `lib/membership-tiers`.
- Unlock checkout behavior comes from `useUnlockCheckout`, which relies on lock addresses and chain IDs (Base).
- Any new data fetch should use React Query with keys scoped by `addressesKey` (and feature flags like `includeMissed` if needed).
