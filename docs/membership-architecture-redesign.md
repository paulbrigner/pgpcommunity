# Membership Architecture Redesign (Recovered Summary)

## Design Overview
- On-chain membership is the source of truth (see `lib/membership-server.ts`). Sessions only cache briefly; no membership fields in Dynamo.
- Zero migration concerns (no active users): delete legacy pref storage/API routes; do a hard cutover.
- Treat Dynamo/NextAuth as auth/profile only. Membership state derives from Unlock locks, ERC20 allowances, and cached metadata.

## Membership State
- Fetch per-tier status/expiry via `getMembershipSummary`; enrich with token ids and allowances (USDC.allowance(owner, lock)).
- Cache snapshots per addresses+chain with short TTL; invalidate immediately after transactions.
- Include tokenIds, allowances, metadata so UIs render without DB lookups.

## Tier Change Flow
- Prefer extend over purchase when a key exists; if upgrading/downgrading, cancel/refund then purchase or schedule.
- Auto-renew based on USDC allowance; revoke to stop renewals. Highlight overlapping keys so users can clean up.

## Implementation Steps (hard cutover)
- Remove Dynamo-backed prefs/routes (`/api/profile/auto-renew`, `/api/profile/membership-tier`, related session fields).
- Expose helpers in `lib/membership-server.ts` / `membership-state-service` for token ids and allowances; surface via server actions.
- Wrap Unlock SDK interactions in orchestrator (`lib/membership-actions.ts`) for purchase/extend/cancel with snapshot invalidation.
- Refactor UI (home/settings) to consume snapshots; show renew/extend CTAs based on derived state.

## Integration Status
- Settings page and home fetch snapshots server-side; checkout receives tokenIds and allowances and forces `extendKey` when a key exists to avoid max-keys reverts. The Settings CTA switches to “Renew” and is disabled when a key exists but no token id is available to avoid accidental purchases on max-keys locks.
- `/api/membership/expiry` and legacy cache/routes removed; profile uses the shared snapshot helper.
- Server snapshots now pull tokenIds from the Unlock subgraph (with on-chain enumeration fallback) so non-enumerable locks still surface ids; checkout re-checks the subgraph before dispatching and refuses to call `purchaseKey` when an existing key is detected without a resolvable token id.

## Next (if needed)
- Flesh out orchestrator with WalletService calls and transaction-aware invalidation.
- Add richer token/link metadata if UIs need per-key actions.
- Run full UI regression (signin/link, purchase/renew/disable, auto-renew prompts, event checkout, gated content, NFT lists) on the new flow.

## Current Issue Summary
- Purchasing or extending higher-tier memberships is still triggering `0x17ed8646` (“max keys per address”) reverts during gas estimation. Even though we’ve wired snapshots to provide token IDs and the client prefers `extendKey`, Metamask still attempts to run the `purchaseKey` calldata before falling back, so the warn/error shows up every time the wallet already holds a key on that lock.
- The problem is worst on locks where we do not always receive the tokenId (e.g., some users have keys minted earlier without enumerable support). When the tokenId is missing, the UI now disables the renew button, but when the server snapshot also misses it we still end up with a `purchaseKey` attempt, which causes the revert.
- Next Codex iteration should focus on ensuring the server always returns tokenIds for any existing keys (possibly by enumerating via Locksmith or a subgraph) and wiring checkout so no `purchaseKey` call is dispatched when a key exists. If enumeration is impossible for a lock, expose a server action to derive token ids on demand before opening checkout so we can call `extendKey` deterministically. **In progress:** subgraph token ids are now included in snapshots and checkout blocks purchases when an existing key is detected but the token id cannot be resolved.
