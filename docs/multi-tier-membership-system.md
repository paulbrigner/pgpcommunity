# Multi-Tier Membership System

## Overview
The membership system supports four Unlock-based tiers (Member, Holder, Staker, Builder). Unlock is the source of truth; no membership state is persisted in Dynamo or sessions beyond short-lived caching. Server and client code derive status, expiry, allowances, and token IDs directly from the locks and the Unlock subgraph.

## Configuration
- `NEXT_PUBLIC_LOCK_TIERS`: JSON array of tier objects `{ id?, address, label?, order?, renewable?, gasSponsored?, neverExpires? }`. First entry becomes the primary lock for backward-compatibility.
- `NEXT_PUBLIC_UNLOCK_ADDRESS`: Unlock proxy on Base.
- `NEXT_PUBLIC_BASE_*`: network, RPC, explorer.
- Optional: `NEXT_PUBLIC_UNLOCK_SUBGRAPH_URL` (or ID/API key) for tokenId resolution; `CHECKOUT_CONFIGS` for event locks; `HIDDEN_UNLOCK_CONTRACTS` to hide specific locks.
- `.env.example` documents the tier array and related settings.

## Membership Evaluation
- Service: `lib/membership-state-service.ts` fetches per-tier status (`active`/`expired`/`none`), expiry, token IDs (subgraph first, on-chain fallback), metadata, and USDC allowance snapshots (per lock).
- Derived fields:
  - `highestActiveTier`: lowest-order active tier.
  - `nextActiveTier`: only shown when another active tier expires later than the current one and auto-renew on the current tier is **off**; equal expiries suppress the “next” display.
- Expiry/status: computed on-chain via Unlock; no DB storage. Snapshots are cached briefly and invalidated on transactions.

## Sessions & Caching
- NextAuth session embeds membership summary and allowances for SSR; legacy `membershipStatus`/`membershipExpiry` remain for compatibility.
- Client keeps a short-lived local cache to reduce RPC churn but always reconciles with server snapshots when available.

## Checkout & UX
- Tier picker: Home CTA and onboarding dialog present a radio list of tiers (name, status, optional price/benefit). Quick-register CTAs route membership locks through the same tier-aware checkout; no paywall usage remains.
- Wiring: All entry points pass an explicit `tierId` into the shared checkout helper (`useUnlockCheckout`), built from `NEXT_PUBLIC_LOCK_TIERS`.
- Extend vs purchase: checkout prefers `extendKey` when a key exists (guards max-keys reverts); blocks purchase when an existing key is detected but no tokenId can be resolved.
- Auto-renew/allowance: per-lock allowance is read and displayed; enabling auto-renew approves USDC for up to 12 months by default (renewable tiers only).
- Status display: UI shows current tier; if multiple active tiers exist, “Next after expiry” appears only when a later-expiring tier would remain and the current tier is not set to auto-renew.

## APIs & Data
- Membership snapshots: server actions and `/api` routes consume `membership-state-service` outputs for gating and UI hydration.
- `/api/nfts`: includes tier info when an NFT corresponds to a tier lock.
- Config helpers expose tier arrays, primary lock, Unlock address, and checkout overrides.

## Error Handling
- Unlock error codes are decoded for user-friendly messages.
- ERC20 balance checks prevent underfunded purchases before dispatching transactions.
- Missing token IDs block extend attempts to avoid max-keys purchase reverts.

## Future Work
- Tier entitlements: differentiate perks/content per tier; define gating rules formally.
- Analytics/telemetry: capture tier adoption and checkout outcomes.
- Tests: expand unit/integration coverage around multi-tier checkout, allowance handling, and tokenId fallback paths.
- Admin/ops: clarify reporting requirements and finalize config format (env vs committed JSON) for long-term maintenance.
