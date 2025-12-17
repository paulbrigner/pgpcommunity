# Membership Architecture

## Overview
- Unlock smart contracts are the single source of truth for memberships. No membership state is stored in Dynamo; sessions only cache short-lived summaries.
- Four tiers are supported (Member, Holder, Staker, Builder) via `NEXT_PUBLIC_LOCK_TIERS`. Member is a free, non-expiring tier; the first entry remains the primary lock for backward compatibility.
- All membership state (status, expiry, token IDs, allowances, metadata) is derived on-chain or from the Unlock subgraph and exposed through shared services used by server and client.

## Data Flow & Services
- `lib/membership-state-service.ts`: fetches per-tier status/expiry (`getMembershipSummary`), token IDs (Unlock subgraph with on-chain fallback), metadata, and USDC allowances per lock. Caches snapshots briefly and invalidates after transactions.
- `lib/membership-server.ts`: on-chain evaluation of lock membership; no DB storage. Used by server actions and API routes.
- `snapshotToMembershipSummary`: derives overall status, expiry, highest active tier, and maps token IDs/allowances for UI hydration.
- DynamoDB (NextAuth adapter): only persists auth + profile fields (name, email, wallets, first/last, xHandle, linkedinUrl). Membership state, auto-renew flags, and tier IDs (e.g., `autoRenewPreference`, `currentMembershipTierId`, `lastMembershipTierId`) are not used and can be pruned from existing records.

## Checkout & Tier Changes
- Shared hook `useUnlockCheckout` drives membership and event checkout using `NEXT_PUBLIC_LOCK_TIERS`.
- Extend vs purchase: prefers `extendKey` when a key exists; blocks purchase when an existing key is detected without a resolvable token ID to avoid max-keys reverts.
- Token IDs: fetched from subgraph first, with on-chain enumeration fallback; missing IDs block renewal to prevent accidental `purchaseKey` on max-keys locks.
- ERC20 safeguards: balance check before dispatch; approvals are capped to 12 months of membership cost instead of unlimited allowances (unless an explicit override is provided).
- Legacy paywall: removed. All entry points use the Unlock component flow (`useUnlockCheckout`) inside our drawer UI. The paywall dependency was dropped from docs/deps; tiers come from `NEXT_PUBLIC_LOCK_TIERS`, events from `CHECKOUT_CONFIGS`.

## UI & UX State
- Home/onboarding: tier picker passes explicit `tierId` into checkout. Quick-register routes membership locks through the same flow; paywall usage removed.
- Status display: shows current tier; if multiple tiers are active, “Next after expiry” appears only when another active tier expires later and auto-renew for the current tier is off (equal expiries suppress the message).
- Settings/Profile: surfaces per-tier status, expiry, token IDs, and auto-renew allowance; upgrade/downgrade uses the tier-aware checkout.

## Sessions & Caching
- NextAuth session includes membership summary and allowances for SSR; legacy fields retained for compatibility.
- Client keeps a short-lived cache to reduce RPC load but reconciles with server snapshots when available.

## Known Behavior & Fixes Implemented
- Max-keys protection: extend-first logic plus blocking purchases when token ID cannot be resolved.
- Subgraph-backed token IDs: non-enumerable locks are supported via subgraph lookup, with on-chain fallback.
- Auto-renew aware display: “next tier” hidden when current tier auto-renews or when active tiers share the same expiry.
- Underfunded transactions: ERC20 balance preflight prevents “transfer amount exceeds balance” reverts during gas estimation.

## Future Work
- Orchestrator polish: add transaction-aware invalidation hooks around checkout to tighten cache coherence.
- Richer metadata: surface lock/key metadata for per-key actions if needed.
- Entitlements: formalize tier-based gating rules and differentiated perks/content.
- Analytics/telemetry: capture tier adoption and checkout outcomes.
- Tests: expand unit/integration coverage for multi-tier checkout, allowance handling, and token ID fallback paths.
- Ops/docs: keep references to the old paywall removed; ensure onboarding docs mention the Unlock component flow and the `NEXT_PUBLIC_LOCK_TIERS` / `CHECKOUT_CONFIGS` env requirements.
