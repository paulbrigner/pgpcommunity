# Free “Member” Tier (Non‑Expiring + Gas‑Sponsored) — Implementation Plan

## Summary
Add a new **free**, **non‑expiring** membership tier called **Member** backed by an existing Unlock lock on Base:

- Member lock (Base): `0xCb9c9a907ca52d73Dacec83892696F47430f6dbb`

Unlike the existing paid tiers (Holder/Staker/Builder) which renew monthly (optionally via prior USDC approval), the Member tier should:

- Cost `0` (no USDC required)
- Not expire (no renewal / no auto‑renew UI)
- Be claimable even when the user has **0 ETH for gas** (app sponsors gas)

This document is a step‑by‑step plan to implement the change safely and incrementally.

---

## Goals
- Add a 4th tier, **Member**, to `NEXT_PUBLIC_LOCK_TIERS` and all tier-aware UI/logic.
- Provide a **gas‑sponsored** “Claim Member” flow that mints the free membership key to the user without requiring ETH.
- Ensure membership evaluation and UX correctly handle **lifetime/non‑expiring** keys (no bogus “expires in year 5e69” dates).
- Ensure “paid implies Member”: anyone with an active paid tier also has the free Member key (with guardrails for explicit “cancel all” choices).
- Adjust cancellation/refund behavior: paid tiers keep “request cancellation & refund”; Member tier supports “cancel membership” (terminate key) with **no refund**.
- Admin can draft and send tier-targeted emails (including Member → “everyone with membership”).
- Keep existing paid-tier checkout + auto‑renew flows working unchanged.
- Add anti‑abuse controls and an operational runbook for the sponsor wallet.

## Non‑Goals (for the first iteration)
- Replacing Unlock checkout for paid tiers.
- Introducing ERC‑4337/account abstraction unless required.
- Redefining entitlements/perks across tiers (unless the app currently assumes “paid-only” access).

---

## Implementation Status (as of 2025-12-16)
- Phase 0 (Lock validation): completed — lock is PublicLock v15; `expirationDuration` is `MAX_UINT256` (treated as “never expires”); cancel uses `expireAndRefundFor(..., 0)`; re-claim after cancel reactivates via `setKeyExpiration` (because `maxKeysPerAddress == 1` makes `purchase` revert with `MAX_KEYS_REACHED`).
- Phase 1 (Tier model + config): completed — tier flags (`renewable/gasSponsored/neverExpires`) supported; tier ranking updated so Member never eclipses paid tiers; docs/templates updated.
- Phase 2 (Backend sponsored claim/cancel): mostly completed — claim/cancel endpoints, DynamoDB nonce lease lock, kill switch, verified-email gate, rate limits, and Dynamo audit trail implemented; refund `postCancelPreference` is stored on refund requests (admin execution still pending).
- Phase 3 (Frontend claim/cancel UX): mostly completed — “Claim free membership” and “Cancel free membership” flows added; confusing “Claim with my wallet” fallback is only shown after claim errors; “Paid ⇒ Member” automation is wired after paid checkout + a one-time Settings auto-ensure for existing paid members; refund requests now capture “keep free vs cancel all” preference; remaining polish: occasional stale tier UI immediately after cancel/claim (see below).
- Phase 4 (Expiry + auto‑renew correctness): completed — lifetime keys render as “Never”; auto‑renew/allowance UI suppressed for Member; allowance fetching skipped for non-renewable tiers.
- Phase 5 (Abuse prevention + ops readiness): partially completed — baseline controls exist (verified email gate, per-day cap, min balance, kill switch, audit); monitoring/runbook documentation is still pending.
- Phase 6 (Tests, staging, rollout): partially completed — tests added for sponsor utilities and build/lint passes; backfill issuance tooling added as `scripts/backfill-member.mjs` (execution still pending) + staging/rollout checklist execution is still pending.
- Phase 7 (Admin tier email broadcasts): not started.

**Known issue / polish**
- Membership UI can briefly show stale tier state immediately after Member cancel/claim (status messages are correct, but the “current tier” label may lag until a full reload). Next step is to tighten cache invalidation + client refresh coordination around those mutations.

**Next step**
- Run the Phase 6 backfill (`scripts/backfill-member.mjs`), then implement refund `postCancelPreference` admin execution. Also tighten cache invalidation + client refresh coordination around Member cancel/claim.

## Key Decisions / Open Questions (answer before coding)
1. **Entitlements / gating**
   - Does **any active tier** (including Member) unlock all member-only content?
   - Or do some routes/features require paid tiers specifically?
2. **Tier priority**
   - If a user holds Member + a paid tier, which label should the UI show as “current tier”?
   - Recommendation: show the *highest paid tier* (Member is a baseline), and treat “never expires” as not outranking paid tiers.
3. **Claim authorization model**
   - Require a logged-in session with a linked wallet (recommended), vs. allow unauthenticated claims with only a wallet signature.
4. **Relaying strategy**
   - Use a managed relayer (preferred for production scale), vs. a self-managed sponsor private key running in the app server.
5. **Tier email targeting semantics**
   - Define “members of tier X” for email sends:
     - Recommended: “users with an **active key** for lock X” (not just `highestActiveTier`).
     - For **Member**, this should include all paid members (because “paid implies Member”), i.e. “everyone with membership”.
   - Decide whether admins also need an “All users (even non-members)” broadcast.
   - Decide policy for suppressed/bounced emails (`emailSuppressed`, `emailBounceReason`) and opt-out handling.
6. **Never-expiring representation**
   - Even if the Member lock is configured as non-expiring in Unlock, confirm how “lifetime” presents via:
     - `expirationDuration` (PublicLock v15 uses `MAX_UINT256` for “never expires”)
     - `keyExpirationTimestampFor` / `getHasValidKey`
   - Decide the canonical app representation:
     - Recommendation: treat “lifetime” as `expiry = null` + a tier flag `neverExpires=true`, and display “Never”.
7. **Sponsor kill-switch behavior**
   - Decide how the app behaves when sponsorship is disabled/out-of-funds:
     - Recommendation: hide sponsored CTAs, fall back to “claim with your wallet (pay gas)”, and return a clear error from claim/cancel endpoints.

---

## Lifecycle & Edge Scenarios (add to requirements)
These scenarios drive both UI behavior and backend guardrails.

### Baseline rule: “Paid implies Member”
- If a user holds any **paid** active tier, they should also hold the **Member** key (unless they explicitly chose “cancel all memberships”).
- Implementation intent:
  - After **any paid checkout success** (purchase/renew/upgrade), automatically call the sponsored Member-claim flow if the Member key is missing.
  - For **existing paid members** (pre-free-tier rollout), run a one-time “ensure Member” flow on next login/visit to Settings (with guardrails and rate limits).
  - To avoid “silent drop-offs” when paid keys expire for dormant users, run a **one-time backfill issuance** to existing paid members (see Rollout/Backfill in Phase 6).

### Upgrade: Member → Paid
- Member key remains active.
- Paid tier becomes the “current tier” display (Member becomes baseline).
- No change to Member cancellation/refund logic.

### Paid expiry: Paid → Member (automatic downgrade)
- When a paid tier expires, the user should still be **active** as a Member (baseline).
- UX should clearly communicate “paid benefits expired; you are still a Member” and offer an upgrade/renew CTA.

### Downgrade: Paid → Member (intentional)
User chooses to stop being paid going forward while keeping baseline access.

- Behavior:
  - Paid key remains valid until its expiry.
  - Member key is present (claim it if missing).
  - Any “auto-renew” pre-approval for that paid tier is revoked/disabled so renewals stop.
- Important constraint:
  - Revoking USDC allowance typically requires a **user-signed on-chain tx** (needs some Base ETH for gas). If the user has no ETH, provide guidance (“add a small amount of ETH”) or support fallback.

### Cancellation + refund request (paid tiers)
When requesting a paid cancellation/refund, prompt for what happens after the paid tier is canceled:

- Prompt options:
  1) “Refund paid membership and keep free Member access”
  2) “Refund paid membership and cancel all memberships (including free)”
- Refund should be processed either way (paid tier refund is independent of free tier choice).
- Implementation intent:
  - Always guide the user to **disable auto-renew** (revoke USDC allowance) for the paid tier as part of the flow (or clearly explain why it’s still enabled).
  - Store the user’s post-cancel preference on the refund request record so the admin workflow can execute it:
    - If “keep free”: ensure Member key exists (claim if missing).
    - If “cancel all”: after refund/cancellation is completed, expire/terminate the Member key (no refund).

### Cancel free membership (Member tier)
- Member-only users (or users who explicitly want no membership) can terminate the Member key (no refund).
- Guardrail: if the user has any **active paid tier**, do **not** allow canceling the Member key unless they explicitly choose “cancel all memberships”.
- Implemented detail: this lock uses `maxKeysPerAddress == 1`, so “re-claim after cancel” is implemented by reactivating the existing key via `setKeyExpiration` (not by calling `purchase` again).

### Multi-tier edge cases
- Multiple paid tiers active:
  - Refund/cancel should allow selecting which paid tier is being refunded (or default to the highest paid tier) and should not mistakenly target the Member tier.
  - “Downgrade to Member” should disable auto-renew for the selected paid tier (and ideally allow selecting which tier).
- Multiple wallets linked:
  - “Ensure Member” and “Cancel Member” should operate on a specific recipient wallet (usually the primary/connected wallet), and the UI should be explicit about which wallet is affected.
  - Backfill issuance should target the wallet(s) that actually hold paid keys (on-chain owners) so the free tier persists when paid expires.

---

## Proposed Technical Approach (Recommended)
### A. Model the tier as “free + lifetime + no auto‑renew”
Extend `MembershipTierConfig` (parsed from `NEXT_PUBLIC_LOCK_TIERS`) with optional flags that drive behavior:

- `renewable?: boolean` (paid tiers true, Member false)
- `gasSponsored?: boolean` (Member true)
- `neverExpires?: boolean` (Member true)

This avoids sprinkling `if (tier.id === 'member')` throughout the codebase and makes future tier changes easier.

### B. Gas sponsorship via server-side transaction (relayer)
Implement an authenticated API route that:

1. Verifies the requester has a valid session and the requested recipient address belongs to that user’s linked wallets
2. Checks if the recipient already holds a valid key for the Member lock (idempotent)
3. If not, submits an on-chain tx from a sponsor wallet that mints the key to the user (e.g., `purchase` with price `0`, or `grantKeys` if the sponsor is a lock manager)
4. Returns `txHash` quickly, and the client polls/refreshes membership state

### C. Concurrency-safe nonce management
Serverless/edge environments can run concurrent instances. A single sponsor EOA needs nonce coordination to avoid “nonce too low” / “replacement underpriced”.

Plan options:

- **Option 1 (recommended): managed relayer** (OpenZeppelin Defender Relay / Gelato Relay / Alchemy Gas Manager)  
  Pros: robust nonce mgmt, key custody outside app, retry tooling.  
  Cons: extra vendor + setup.
- **Option 2: DynamoDB-backed lease lock (chosen)** (fits current stack)  
  Use DynamoDB conditional writes to implement a short-lived “lease” so only one server instance can submit a sponsor-wallet transaction at a time. This prevents nonce collisions without requiring a third-party relayer.
- **Option 3: single-instance/dev only**  
  Acceptable only for local dev; not recommended for production.

### D. DynamoDB “lease lock” design (nonce coordination)
This is primarily a **reliability/concurrency** solution (not cryptographic security). It prevents multiple app instances from broadcasting sponsor-wallet txs with the same nonce.

**Table**
- Reuse the existing Dynamo table (`NEXTAUTH_TABLE`) used by `lib/dynamodb.ts`.

**Lock item shape (single item per sponsor wallet + chain)**
- `pk`: `NONCE_LOCK#<chainId>#<sponsorAddressLower>`
- `sk`: `NONCE_LOCK#<chainId>#<sponsorAddressLower>`
- `type`: `NONCE_LOCK`
- `chainId`: number (e.g., `8453`)
- `sponsorAddress`: lowercase hex address
- `leaseId`: random UUID (changes each acquisition)
- `leaseUntil`: epoch ms (when the lease expires)
- `nextNonce`: number (optional but recommended as a cross-RPC safety net)
- `updatedAt`: ISO string
- `lastNonce`: number | null
- `lastTxHash`: string | null
- `lastError`: string | null

**Acquire lease (atomic)**
- Generate a new `leaseId`.
- `UpdateItem` with a `ConditionExpression` that only succeeds if the lease is free/expired:
  - `attribute_not_exists(leaseUntil) OR leaseUntil < :now`
- On success, set:
  - `leaseId = :leaseId`
  - `leaseUntil = :nowPlusLeaseMs` (e.g., `now + 30_000`)
  - `updatedAt = :isoNow`
  - `type = if_not_exists(type, :type)`
  - `chainId/sponsorAddress` (optional for debugging)

If the conditional write fails, another instance is holding the lease; return `429` (or a retryable error) and let the client retry with backoff.

**Choose nonce (under the lease)**
- Read the current lock item (or use the `UpdateItem` return values) to get `nextNonce`.
- Read the chain pending nonce: `provider.getTransactionCount(sponsor, "pending")`.
- Pick:
  - `nonceToUse = max(chainPendingNonce, nextNonce ?? 0)`

**Broadcast transaction (under the lease)**
- Submit the mint tx with `nonce: nonceToUse`.
- Only after a tx hash is returned, update the lock item:
  - `nextNonce = nonceToUse + 1`
  - `lastNonce = nonceToUse`
  - `lastTxHash = tx.hash`
  - `lastError = null`
  - `updatedAt = :isoNow`

**Release lease**
- `UpdateItem` with `ConditionExpression leaseId = :leaseId` (only the holder can release).
- Set `leaseUntil = 0` (or `:now - 1`), update `updatedAt`.

**Failure handling**
- If broadcast fails before a tx hash is returned:
  - Keep `nextNonce` unchanged (avoids nonce gaps).
  - Write `lastError` and release the lease (or let it expire quickly).
- If the process dies mid-flight:
  - The lease expires automatically via `leaseUntil`.
  - Next acquisition will recover by recalculating `nonceToUse` from `max(pendingNonce, nextNonce)`.

**Why store `nextNonce` at all?**
- `getTransactionCount(..., "pending")` depends on the RPC node’s view of the mempool. If different instances hit different RPC backends, “pending” can lag. Persisting `nextNonce` makes nonce allocation deterministic across instances.

**Lease duration**
- Start with `30s`. The critical section is short (build tx → broadcast → write lock → release).
- If you add receipt waiting (not recommended for the request/response path), you must also add a “heartbeat” (extend `leaseUntil`) or longer leases.

**DoS / abuse note**
- The lease lock prevents nonce collisions, but does not prevent endpoint abuse. Keep rate limits and “recipient must be linked wallet” validation regardless.

---

## Environment / Configuration Changes
### 1) Add Member tier to `NEXT_PUBLIC_LOCK_TIERS`
Update `.env.local` (and later `.env.example`) to include Member as the **lowest-priority** tier (highest `order`) so it doesn’t become the primary lock.

Example (shape only; keep your existing tiers and append Member):

```bash
NEXT_PUBLIC_LOCK_TIERS='[
  {"id":"holder","address":"0xed16cd934780a48697c2fd89f1b13ad15f0b64e1","label":"Holder","order":0},
  {"id":"staker","address":"0xb5d2e305c589b1d7a1873c73637adf9a52724105","label":"Staker","order":1},
  {"id":"builder","address":"0xdd7fff4931409e2d1da47be9798fd404cc44e9a9","label":"Builder","order":2},
  {"id":"member","address":"0xcb9c9a907ca52d73dacec83892696f47430f6dbb","label":"Member","order":3,"renewable":false,"gasSponsored":true,"neverExpires":true}
]'
```

Notes:
- Use the checksum address if you prefer; the app normalizes to lowercase for comparisons.
- Keep paid tiers’ `order` values unchanged.

### 2) Add server-only env vars for the sponsor wallet
Add new env vars (names can be adjusted to match conventions, but keep them **server-only**, no `NEXT_PUBLIC_`):

- `MEMBER_SPONSORSHIP_ENABLED` — set `false` to disable all sponsored claim/cancel/backfill behavior (kill switch)
- `MEMBER_SPONSOR_PRIVATE_KEY` — EOA private key used to submit the mint tx
- `MEMBER_SPONSOR_RPC_URL` (optional) — override RPC if desired (defaults to existing Base RPC)
- `MEMBER_SPONSOR_MIN_BALANCE_WEI` (optional) — refuse to sponsor if wallet is below threshold
- `MEMBER_SPONSOR_MAX_TX_PER_DAY` (optional) — coarse abuse limit

Store these in the secret manager / hosting environment (Amplify env vars, etc). Do not commit them.

---

## Phase Plan

### Phase 0 — Validate the Member lock on-chain (pre-work)
**Outcome:** confirm the lock behaves as required and identify the correct mint method + ABI.

- Confirm on Base that the Member lock:
  - has `keyPrice == 0`
  - has **no expiration** (`expirationDuration == MAX_UINT256` on PublicLock v15, or equivalent behavior)
  - allows minting to arbitrary recipients (`purchase` supports `recipient`, or `grantKeys` exists and sponsor can call it)
  - has sane per-address limits (ideally `maxKeysPerAddress == 1`)
- Confirm there is a viable **termination** method for the Member key (no refund):
  - Prefer a lock-manager-only method that can set expiry to `now` (e.g., `expireAndRefundFor(..., 0)` / equivalent).
  - Ensure the sponsor wallet will have the required role (lock manager / key manager) to perform this action.
- Confirm the “never expires” representation used by the lock:
  - If `keyExpirationTimestampFor` returns `0`, `MAX_UINT`, or a far-future timestamp, document it.
  - Decide the threshold (if needed) for treating “far future” as “Never” in UI.
- Decide the mint path:
  - Prefer `purchase` with price `0` if it’s public and stable across lock versions.
  - Use `grantKeys` if the sponsor will be a lock manager and you want stricter issuance control.
- Capture the exact ABI fragment needed for the chosen method and add it to a shared server utility.

### Phase 1 — Tier model + config plumbing
**Outcome:** the app recognizes a 4th tier and can label/classify it correctly.

- Update `lib/config.ts` types to accept the optional tier flags (`renewable`, `gasSponsored`, `neverExpires`).
- Update tier helpers (`lib/membership-tiers.ts`) to:
  - pick “current tier” in a way that doesn’t let a lifetime tier eclipse paid tiers
  - handle “never expires” cleanly in `pickNextActiveTier` logic
- Update docs and templates:
  - `.env.example` to include the Member tier entry + sponsor env var placeholders
  - `docs/multi-tier-membership-system.md` and `docs/membership-architecture.md` to mention the free lifetime tier + sponsorship flow

### Phase 2 — Backend: sponsored claim endpoint
**Outcome:** a safe API exists to mint the Member key using sponsored gas.

- Implement a server-side sponsor service (new module) that:
  - constructs an `ethers` signer with `MEMBER_SPONSOR_PRIVATE_KEY`
  - checks balance thresholds and network id
  - enforces kill switch: if `MEMBER_SPONSORSHIP_ENABLED === false`, refuse and return a typed error
  - checks idempotency (`getHasValidKey` / `balanceOf`) before submitting a tx
  - submits the mint tx and returns `{ txHash }`
  - supports retries and produces structured logs
- Add an authenticated API route, e.g. `POST /api/membership/claim-member`:
  - Reads user session (NextAuth) and loads linked wallets
  - Requires a **verified email** on the user account before sponsoring gas:
    - Recommendation: require `user.email` and `user.emailVerified` (from the NextAuth user record) to be non-null.
  - Validates requested recipient is linked to that user
  - Rate-limits (at minimum per-user + per-IP)
  - Writes an audit record for every attempt (success/failure) with `userId`, recipient, IP, user-agent, action, and `txHash` when available
  - Calls sponsor service, then invalidates membership cache for that wallet
  - Returns status: `already-member | submitted | failed` plus `txHash` when submitted
  - Reactivation nuance (PublicLock v15): if the user previously held a Member key that was canceled/expired, `purchase` can revert with `MAX_KEYS_REACHED` when `maxKeysPerAddress == 1`; in that case, reactivate by calling `setKeyExpiration(tokenId, MAX_UINT256)` instead.
- Add an authenticated API route for **Member cancellation**, e.g. `POST /api/membership/cancel-member`:
  - Validates session + recipient wallet ownership (same rules as claim)
  - Enforces “cancel all” guardrail: refuse if the user has an active paid tier unless the request explicitly includes `cancelAll=true`
  - Enforces kill switch + verified-email requirement (same as claim)
  - Locates the Member key tokenId for the recipient (subgraph-first, on-chain fallback)
  - Submits an on-chain tx from the sponsor wallet to **expire/terminate** the key with `refund=0`
  - Returns status: `already-canceled | submitted | failed` plus `txHash`
  - Invalidates membership cache so the UI reflects the termination promptly
- Audit trail (Dynamo)
  - Add a new record type to the existing Dynamo table for sponsored actions, e.g. `SPONSOR_ACTION`.
  - Suggested record shape:
    - `pk/sk`: `SPONSOR_ACTION#<uuid>`
    - `type`: `SPONSOR_ACTION`
    - `action`: `claim-member | cancel-member | backfill-claim | refund-followup-claim | refund-followup-cancel`
    - `status`: `attempted | submitted | already-member | already-canceled | rejected | failed`
    - `userId`: string | null
    - `email`: string | null
    - `recipient`: wallet address (lowercase)
    - `ip`: string | null
    - `userAgent`: string | null
    - `txHash`: string | null
    - `lockAddress`: Member lock address
    - `createdAt/updatedAt`: ISO strings
    - `error`: string | null
    - `metadata`: object (optional; e.g., rate-limit counters, nonce used, chainId)
  - Add `GSI1PK = "SPONSOR_ACTION"` and `GSI1SK = "<createdAt>#<uuid>"` for time-based admin/debug queries.
- Update paid refund request backend to support the new scenarios:
  - `/api/membership/refund-request` must select a **refundable paid tier** (ignore Member tier) and reject Member-only requests.
  - Include a `postCancelPreference` field on the stored refund request record (e.g., `keep-free` vs `cancel-all`).
  - When an admin marks a refund request `completed`, execute the stored preference:
    - `keep-free`: ensure Member exists (claim if missing).
    - `cancel-all`: terminate Member (no refund) after paid cancellation is completed.
- Nonce strategy (chosen):
  - Implement the DynamoDB **lease lock** described above to serialize sponsor-wallet tx submission and eliminate nonce collisions.
  - Reuse the same lease lock for both claim and cancel operations (single sponsor wallet).
  - Reuse the same lease lock for any admin-executed Member claim/cancel actions tied to refund processing.

### Phase 3 — Frontend: “Claim Member” UX (no gas required)
**Outcome:** users can join for free without ETH; paid tiers still use checkout.

- Update tier selection UI on Home and Settings:
  - Show **Member** as “Free” and “No expiry”
  - Update wallet requirement copy:
    - Member: “No USDC needed” + “No ETH needed (sponsored)”
    - Paid tiers: keep existing USDC + ETH messaging
- Add a new action path when the selected tier is gas-sponsored:
  - Replace “Continue” → “Claim Free Membership”
  - Call `POST /api/membership/claim-member`, show progress, then refresh membership state
  - Provide a fallback CTA: “Claim with my wallet (I’ll pay gas)” that uses the existing checkout path
  - If sponsorship is disabled/out-of-funds or the user lacks verified email, display a clear CTA to:
    - verify/add email, and/or
    - proceed with wallet-paid claim
- Enforce “Paid implies Member” in the paid purchase/renew/upgrade UX:
  - After paid checkout succeeds, automatically ensure the Member key exists (call `POST /api/membership/claim-member` if missing).
  - For existing paid members (pre-rollout), show a lightweight “We’re adding a free Member pass” notice and auto-claim once (idempotent + rate-limited).
- Update the existing **cancellation/refund** UI in Settings:
  - For paid tiers: keep “Request cancellation & refund” (admin workflow).
  - For Member tier: replace with “Cancel free membership” that calls `POST /api/membership/cancel-member` and does **not** create a refund request.
- Ensure the refund request flow cannot be triggered for Member-only accounts:
  - Hide/disable the refund request UI when the current tier is non-refundable.
  - Backend guard: `/api/membership/refund-request` should return an error like “No refundable membership” when only non-refundable tiers are active.
- Expand the refund request UI for paid tiers to capture the post-cancel scenario:
  - Prompt: “After cancellation, do you want to keep free Member access?”
  - If “keep free”: ensure Member exists (claim if missing).
  - If “cancel all”: record preference and clearly explain when free access will end (typically after admin completes cancellation).
- Update the unauthenticated landing copy (“How it works”) to mention the free tier (and that paid tiers are optional upgrades/support).

### Phase 4 — Expiry + auto‑renew correctness
**Outcome:** lifetime membership never shows weird expiry dates; auto‑renew UI is suppressed when irrelevant.

- Normalize “never expires” across server + client:
  - Because the Member lock is configured as non-expiring, prefer detecting `expirationDuration == MAX_UINT256` (PublicLock v15) and map to `expiry = null` + `neverExpires = true`.
  - If Unlock returns a far-future timestamp (or `MAX_UINT`), map it to `expiry = null` + `neverExpires = true` as a compatibility fallback.
  - Update any date formatting to display “Never” when `neverExpires`.
- Disable auto‑renew prompts and settings for non-renewable tiers:
  - Home onboarding checklist: hide the “Enable auto‑renew” step when current tier isn’t renewable.
  - Settings membership page: show “No renewal required” for Member tier, and hide USDC allowance controls.
  - Admin roster: avoid treating Member as “expiring soon”; show expiry as `null`/“Never”.
- Performance tweaks (do in the first release)
  - Skip USDC allowance fetches for non-renewable tiers (Member) to reduce RPC calls.
  - Avoid loading/deriving auto-renew state when the current tier is non-renewable.
  - Prefer `includeAllowances=false` when hydrating pages that don’t need them.

### Phase 5 — Abuse prevention + operational readiness
**Outcome:** sponsoring gas doesn’t become an unbounded faucet.

- Implement controls:
  - per-user daily cap (e.g., 1 claim/day)
  - per-IP cap + basic bot mitigation (captcha, or require verified email)
  - deny-list / allow-list hooks (optional)
- Add monitoring and runbooks:
  - log tx hashes + failures
  - keep an eye on `SPONSOR_ACTION` failure/reject volume (abuse/bug signals)
  - alert when sponsor balance drops below threshold
  - document how to rotate sponsor keys and how to top up Base ETH
  - document kill-switch usage (`MEMBER_SPONSORSHIP_ENABLED=false`) and the expected user-facing behavior when disabled

### Phase 6 — Tests, staging, rollout
**Outcome:** confidence that the change works and doesn’t regress paid tiers.

- Add tests:
  - tier sorting logic with lifetime + paid tiers
  - “never expires” formatting helpers
  - API route auth + recipient validation + idempotent responses
  - refund-request route rejects Member-only memberships; cancel-member route expires the key (mocked)
  - “Paid implies Member” behavior: after a mocked paid checkout completion, ensure Member claim is triggered when missing
  - claim-member rejects when email is unverified; cancel-member enforces “active paid tier” guardrail unless `cancelAll=true`
  - sponsor kill-switch disables claim/cancel/backfill paths cleanly
- Manual staging checklist:
  - new user with 0 ETH can claim Member and becomes active
  - Member can cancel membership and becomes inactive (no refund request created)
  - existing paid member can claim Member (or is already active) without breaking paid tier display
  - paid member can downgrade to Member (disable auto-renew; paid remains until expiry; Member remains)
  - refund request flow prompts for “keep free vs cancel all” and the preference is recorded for admin processing
  - paid tier checkout still works and auto-renew still works
- Rollout:
  - recommended rollout approach: implement incrementally locally, deploy to staging/preview after each milestone (avoid a single “big bang” deploy)
  - keep `MEMBER_SPONSORSHIP_ENABLED=false` in production until:
    - claim/cancel flows are validated in staging, and
    - the sponsor wallet has been funded and verified as lock manager/key manager where needed
  - enable sponsorship gradually:
    - staging: small-funded sponsor wallet + limited allow-list (optional) + close monitoring
    - production: start with conservative rate limits, then expand
  - monitor sponsor wallet spend, `SPONSOR_ACTION` reject/failure rate, and endpoint abuse signals
  - suggested milestone sequence (each as a small PR):
    - [x] **M1 (Config/UI)**: add Member tier config + display “Free / Never expires”; keep sponsored claim hidden/disabled
    - [x] **M2 (Backend claim)**: add sponsor service + Dynamo lease lock + `SPONSOR_ACTION` audit + verified-email gate + kill switch; ship with sponsorship disabled in prod
    - [x] **M3 (Frontend claim)**: add “Claim free membership” UX + fallback to wallet-paid claim; enable in staging
    - [x] **M4 (Paid ⇒ Member)**: after paid checkout success, auto-ensure Member when missing; add copy for paid expiry → still Member
    - [ ] **M5 (Cancel/refund scenarios)**: add cancel-member, refund preference prompt (“keep free vs cancel all”), and API guardrails (no cancel Member while paid unless `cancelAll=true`) — *partially complete* (cancel-member + backend refund guard + preference capture stored/displayed done; admin execution pending)
    - [ ] **M6 (Backfill)**: run one-time issuance for existing paid members (ops step after deploy)
    - [ ] **M7 (Admin email broadcast)**: add tier-targeted broadcast emails with “send test to me” first
  - one-time backfill issuance for existing paid members:
    - Decide scope: recommended “all currently-active paid key owners” (optionally include recently-expired paid keys if you want to grant baseline access to lapsed members).
    - Build and run a one-off script (or admin-only job) that:
      - enumerates paid key owners (prefer Unlock subgraph for the paid locks to avoid relying on app user records)
      - for each owner address, checks whether a Member key already exists (idempotent)
      - if missing, mints Member via the sponsor wallet using the same DynamoDB lease lock for nonce safety
      - respects `MEMBER_SPONSORSHIP_ENABLED` and emits audit log entries for each attempted mint
      - logs tx hashes and failures, supports `--dry-run`, and can resume pagination/cursors safely
    - Implementation note: the backfill script lives at `scripts/backfill-member.mjs`:
      - Dry run: `node scripts/backfill-member.mjs --dry-run --no-audit`
      - Small batch: `node scripts/backfill-member.mjs --limit 25`
    - Verify results by sampling addresses and ensuring membership state remains “active” after paid expiry when Member is present.

### Phase 7 — Admin: tier-targeted email broadcasts (optional but recommended)
**Outcome:** admins can draft an email and send it to all members of a selected tier (including Member).

- Recipient selection
  - Add a server-side helper that can resolve recipients for a given tier:
    - Input: `tierId` (or lock address) + `activeOnly=true`.
    - Output: a de-duped list of users with deliverable email addresses (respect `emailSuppressed` / bounces).
  - Recommended implementation (fast + consistent with “Unlock is source of truth”):
    - Use the Unlock subgraph to enumerate **active key owners** for the selected tier lock (paginate).
    - Scan users from Dynamo once, and include a user if any linked wallet intersects the owner set.
    - This avoids per-user RPC membership checks and automatically supports “Member → everyone” once backfilled.
  - Use “active key for tier lock” as the inclusion rule (not `highestActiveTierId`) so:
    - targeting **Holder/Staker/Builder** includes users who hold that tier even if they also hold higher tiers
    - targeting **Member** reaches all paid+free members (because paid implies Member)
  - Decide how to handle multi-wallet users (recommended: if any linked wallet has an active key for the tier, include the user once).

- Admin UI
  - Add a new panel on `/admin`:
    - Tier dropdown (`Member`, `Holder`, `Staker`, `Builder`) and an optional “All users” option
    - Subject + body editor (text, optional HTML) with a preview
    - “Estimate recipients” (count + a small sample list) before enabling “Send”
    - “Send test to me” (sends only to the current admin’s email) before enabling full send
    - Confirm modal with final count and warning copy (“This will email N people”)

- Sending model (avoid timeouts)
  - Implement a lightweight “broadcast job” in Dynamo:
    - `EMAIL_BROADCAST#<id>` record: tier, subject/body, createdBy, status, counts
    - recipient tracking records (per userId/email) with `queued/sent/failed` status
  - Add admin API routes:
    - `POST /api/admin/email/broadcast` → create job + queue recipients
    - `POST /api/admin/email/broadcast/run` → send next batch (e.g., 25–100) with throttling and resume support
    - (optional) `GET /api/admin/email/broadcast/:id` → progress and failures
  - Reuse `recordEmailEvent` for per-recipient logs and include broadcast metadata (tier, broadcastId).

- Safety controls
  - Require explicit admin confirmation, show counts, and throttle outbound sends.
  - Respect `emailSuppressed` and avoid re-sending to hard-bounced addresses.
  - Add a dry-run mode and ensure idempotency (don’t send twice if “run” is retried).
  - Clarify recipient scope:
    - “All members” means “all members with email addresses in Dynamo (registered accounts)”, not all on-chain key owners without accounts.

- Tests
  - Recipient selection: tier inclusion logic, dedupe, suppression handling.
  - Broadcast job: batching, idempotency, and progress updates.

---

## Acceptance Criteria (Definition of Done)
- [x] `NEXT_PUBLIC_LOCK_TIERS` includes the Member tier and the UI shows it as “Free” + “No expiry”.
- [x] A user with **0 ETH on Base** can claim Member successfully; the app shows completion and membership becomes active after confirmation.
- [x] After any successful paid purchase/renew/upgrade, the app ensures the Member key exists (auto-claimed if missing), and paid expiry leaves the user active as a Member.
- [x] Member tier does **not** trigger auto‑renew prompts or USDC approval UI.
- [x] The refund request flow is only available for refundable (paid) tiers; Member tier cancellation terminates membership with no refund.
- [x] Users with paid tiers still see the correct tier as “current” and can renew/auto‑renew as before.
- [x] Sponsor wallet secrets are server-only; rate limiting + basic anti‑abuse controls are in place; sponsor tx submission is concurrency-safe.
- [ ] Admin can draft and send a tier-targeted email broadcast, including selecting **Member** to reach all members (paid+free).
