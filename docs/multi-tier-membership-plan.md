# Multi-Tier Membership Rollout Plan

## Background
The current site assumes a single Unlock lock (`LOCK_ADDRESS`) to determine membership status. Moving to multiple tiers (e.g., $1/$10/$100 per month) requires significant refactoring across configuration, membership checks, session enrichment, checkout flows, and UI. This document captures scope, risks, and the phased delivery plan so future work can resume even if context is lost.

## Scope Summary
- Replace singleton `LOCK_ADDRESS` usage with tier-aware configuration (likely an array of tier objects with lock address, name, price, benefits, and auto-renew defaults).
- Update membership helpers (`lib/membership.ts`, `lib/membership-server.ts`, `/api/membership/expiry`) to compute status/expiry per tier and expose aggregated results for gating logic.
- Adjust NextAuth JWT/session enrichment to store tier data while remaining backward compatible with existing `membershipStatus`/`membershipExpiry` fields.
- Redesign purchase/renewal UX to support tier selection, distinct Unlock checkout configs, and per-tier allowance/auto-renew management.
- Update onboarding/home/profile views where membership is surfaced (paywall, quick-register buttons, “Membership” card, auto-renew controls, etc.).
- Ensure server-side gating (e.g., `/api/content`, `/api/nfts`) recognizes tier entitlements.
- Plan configuration + documentation updates for Amplify environments and local `.env` files.

## Effort Estimate (Rough)
- Planning/spec alignment: 0.5–1 day
- Core config + membership services refactor: 2–3 days
- Session/JWT/API updates and regression fixes: 1–2 days
- UI/UX updates for onboarding, paywall, profile, auto-renew: 3–4 days
- Tier-specific entitlements/events + QA: ~2 days
- Rollout validation (staging deploy, manual purchase tests): 1–2 days
_Total:_ approximately 2–3 weeks elapsed time, assuming focused work and timely reviews.

## Phased Implementation
### Phase 0 – Definition
- Finalize tier matrix: names, pricing, lock addresses, benefits.
- Decide authorization rules (e.g., which tier unlocks baseline content, any tier-specific perks).
- Align on UX requirements for tier selection and status display.

### Phase 1 – Infrastructure Refactor
- Introduce tier-aware config (environment variables or JSON file) and migrate existing code from `LOCK_ADDRESS` to the new structure.
- Update membership helper modules and `/api/membership/expiry` to return structured tier results (status + expiry per tier, plus derived highest tier).
- Adjust NextAuth JWT/session enrichment to cache tier data. Preserve legacy fields until the UI migration completes.
- Review server-side gating logic (content API, NFT collection sourcing) to ensure tier coverage.

### Phase 2 – Purchase & Management UX
- Rework onboarding/home flows to present tier choices and launch Unlock checkout with the selected tier’s lock config.
- Update auto-renew/allowance management for per-tier approvals (settings page + in-flow prompts).
- Refresh membership cards, quick register buttons, and messaging to reflect tier information.

### Phase 3 – Tier Entitlements & Polish
- Implement differentiated perks (extra content, invites, etc.) where applicable.
- Add analytics/telemetry for tier adoption if desired.
- Expand automated tests (unit + integration) and update README/ops docs.

### Phase 4 – Rollout
- Deploy to staging with real tier configuration; run end-to-end purchase, renewal, and auto-renew tests for each tier.
- Monitor launch, add rollback levers (e.g., ability to hide higher tiers or fall back to single-tier configuration).

## Open Questions / Decisions Needed
- Configuration format for tiers (env string vs JSON file committed to repo).
- Entitlement mapping: does any active tier unlock all gated content, or do higher tiers unlock additional sections?
- Auto-renew defaults per tier and whether to support tier upgrades/downgrades in-app.
- Reporting requirements for tier subscriptions (analytics, admin dashboards).

## Immediate Implementation Tasks
We are now ready to execute Phase 1 for the three Unlock memberships:

- Holder: `0xed16cd934780a48697c2fd89f1b13ad15f0b64e1`
- Staker: `0xb5d2e305c589b1d7a1873c73637adf9a52724105`
- Builder: `0xdd7fff4931409e2d1da47be9798fd404cc44e9a9`

Status (2025-09-21): Tier-aware config, membership summary plumbing, NextAuth session enrichment, and primary UI surfaces (home + settings) now support multi-tier memberships.

### Environment & Config
- Replace `LOCK_ADDRESS` with a tier array (e.g. `NEXT_PUBLIC_LOCK_TIERS=[{"address":"0x...","label":"Holder"},…]`).
- Update `lib/config.ts` to expose both the tier collection and helper accessors (default tier list, optional primary lock for backwards compatibility).
- Ensure Amplify/`.env` templates document the new variables.

### Membership Evaluation
- Update `lib/membership.ts` / `lib/membership-server.ts` to iterate across all tier locks when checking expiry or status.
- Normalise the response shape so we can store:
  * per-tier status (`active`/`expired`/`none`),
  * latest expiry per tier,
  * highest active tier (for entitlement decisions),
  * base flags (`hasAnyActiveMembership`).
- Cache tier metadata (name, price, icon) from lock metadata or a local config for display and gating.

### Session & JWT
- Extend the NextAuth JWT callback to embed the tier summary (map of tierId → status/expiry) and the derived highest tier.
- Update the session callback to hydrate the same data for the client. Preserve existing `membershipStatus`/`membershipExpiry` fields for backward compatibility by mapping from the highest active tier.

### UI & UX Touchpoints
- Home/onboarding: surface tier list, show active tier badges, and adjust messaging when no membership is active but some tiers exist.
- Membership card: display current tier, expiry per tier, and optional upgrade CTA (even if tiers functionally identical today).
- Auto-renew flows: store allowance per lock; when a membership is purchased identify the lock/tier involved and handle approvals accordingly.
- Settings → Profile: list each tier with its auto-renew status and allow enabling/disabling per tier.

### API Updates
- `/api/membership/expiry`: accept watch list of addresses, return structured tier results rather than a single status.
- `/api/nfts`: continue to expose collected NFTs but include tier info when the NFT corresponds to one of the tier locks.

### Testing & QA
- Add unit coverage for the tier-aware membership helper.
- Manual testing matrix: purchase/renew each tier, auto-renew on/off per tier, login/logout flows, and regression for content gating.
- Update `docs`/README with instructions for setting tier env values, redeploy Amplify with new config.

### Deployment Checklist
- Update Amplify environment variables and re-run builds with new config.
- Seed staging with test purchases for each tier, verify analytics/logging, then promote to production.
