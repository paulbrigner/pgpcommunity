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

## Next Steps
1. Gather tier requirements and finalize configuration format.
2. Begin Phase 1 refactor in a feature branch; maintain this document with updates as work progresses.
3. Schedule time for end-to-end Unlock purchase testing once multi-tier changes land.
