# Development Next Steps - Claude Assessment (February 4, 2026)

This document provides an independent assessment of the DevStral plan (`docs/20260131-devstral-next-steps.md`) and the two companion plans (base plan, Codex plan) based on a thorough review of the actual codebase at commit `03aca91`.

---

## Assessment of the DevStral Plan

### What the Plan Gets Right

**1. Priority ordering is correct.** Event check-in migration is the highest-value work. The current `checkin-status/route.ts` (248 lines) performs a Locksmith SIWE login on every status check, and `checkin-qr/route.ts` (362 lines) does the same for QR retrieval. These are the heaviest Locksmith dependencies and the most fragile external coupling.

**2. Schema design is sound.** The proposed `EVENT_CHECKIN#${lockAddress}` / `TOKEN#${tokenId}` composite key aligns with the existing `pk`/`sk` pattern used by the roster cache table and the NextAuth table. This is the correct DynamoDB single-table-adjacent design.

**3. Leveraging existing patterns is realistic.** The plan correctly identifies `roster-cache.ts` (402 lines) and `metadata-store.ts` (79 lines) as templates. The metadata store in particular is a clean, minimal pattern that should be replicated almost directly for check-in storage.

### Where the Plan is Over-Engineered (Given Early Beta)

**1. Phase 3 (Data Migration & Monitoring) is premature.** The plan devotes three full weeks (Weeks 6-8) to historical data migration, CloudWatch monitoring, alerting, operational dashboards, and cutover planning. For an early beta with test/few beta users:
- Historical check-in data has minimal value; past events are past.
- CloudWatch dashboards and alerting infrastructure can be added when there is meaningful traffic to monitor.
- Rollback procedures and user communication plans assume a mature production environment.

**2. Dual-system validation is unnecessary complexity.** The plan proposes "data consistency checks between systems," "sync status indicators," "manual sync buttons," and "reconciliation UI." With few users, the simpler approach is to cut over directly: new events use the new system, and old events' check-in data stays in Locksmith (read-only if needed). No ongoing synchronization.

**3. The 12-week timeline is too long.** Most of the actual implementation work (check-in store, check-in endpoint, QR generation, admin UI) is contained in Weeks 1-5. Weeks 6-12 are transition/migration/monitoring overhead that does not apply to a small beta.

**4. Feature flags add complexity without proportional benefit.** For a small user base, deploying the new system directly (with a simple environment variable to disable if needed) is sufficient. A full feature flag system is overhead.

### Where the Plan Has Gaps

**1. Code duplication across routes.** The plan does not address a real problem in the codebase. Three categories of duplication exist:

- `loginToLocksmith()` is duplicated in `checkin-status/route.ts` (lines 80-135) and `checkin-qr/route.ts` (lines 164-219) — identical implementations.
- `fetchSubgraph()` and subgraph URL resolution are duplicated across all three files: `checkin-status/route.ts` (lines 23-45), `checkin-qr/route.ts` (lines 28-50), and `lib/events/discovery.ts` (lines 21-48).
- `isAllowedEventLock()` has a local implementation in `checkin-qr/route.ts` (lines 125-153) that differs from the canonical version in `discovery.ts` (lines 149-152). Note: `checkin-status/route.ts` correctly imports from `discovery.ts` (line 15) and does _not_ have its own copy.

This duplication should be consolidated during the migration work.

**2. The event metadata table uses a simple key (`lockAddress`), while the plan proposes `pk`/`sk` composite keys for check-ins.** This is actually correct (different access patterns require different key designs), but the plan should explicitly note that check-in records need the composite key because you query by lock _and_ by token, while event metadata is always looked up by lock alone.

**3. No mention of the `@solana/spl-token` dependency in `package.json`.** This appears unused in the codebase. It is not related to the plan, but it adds unnecessary dependency weight.

**4. QR code strategy decision is left open.** Both the DevStral plan and the base plan list "signed payload vs. short-lived DB token" as an open question. A recommendation should be made.

---

## Recommended Simplified Roadmap

Given the early beta status and small user base, the following streamlined plan removes migration overhead and focuses on shipping the core functionality.

### Phase 1: Check-in Storage and API

**Goal**: Store check-ins locally; stop writing to/reading from Locksmith for new events.

#### Step 1: Create check-in store module

Create `lib/events/checkin-store.ts` following the `metadata-store.ts` pattern (79 lines). This should be equally simple.

```
Table: EVENT_CHECKIN_TABLE (new env var)
Key schema: pk (HASH, String), sk (RANGE, String)
```

Record shape:
```typescript
type CheckInRecord = {
  pk: string;           // EVENT_CHECKIN#<lockAddressLower>
  sk: string;           // TOKEN#<tokenId>
  checkedInAt: string;  // ISO timestamp
  checkedInBy: string;  // admin wallet or "system"
  method: "qr" | "manual";
  notes?: string | null;
  ownerAddress: string;
  createdAt: string;
  updatedAt: string;
};
```

Implementation: ~60-80 lines. Functions needed:
- `getCheckIn(lockAddress, tokenId)` - single lookup
- `getCheckInsByLock(lockAddress)` - query all check-ins for an event
- `putCheckIn(record)` - idempotent write
- `deleteCheckIn(lockAddress, tokenId)` - for admin corrections

Add `EVENT_CHECKIN_TABLE` to `lib/config.ts` (one line, following `EVENT_METADATA_TABLE` pattern at line 101).

#### Step 2: Extend table creation script

Add an `ensureEventCheckinTable()` function to `scripts/setup/create-dynamodb-tables.mjs` following the existing `ensureEventMetadataTable()` pattern (lines 266-298). Accept `--checkin-table` and `--skip-checkin` flags. This is ~35 lines of new code.

#### Step 3: Create admin check-in write endpoint

New route: `app/api/events/checkin/route.ts`

- POST handler: accepts `{ lockAddress, tokenId, method, notes? }`
- Requires admin session (reuse `lib/admin/auth.ts` pattern)
- Validates the lock is an allowed event lock via `isAllowedEventLock()` from `lib/events/discovery.ts`
- Verifies token ownership on-chain (reuse existing contract call patterns)
- Verifies on-chain key validity via `isValidKey(tokenId)` — this is critical when processing QR scans, since the HMAC payload is signed at generation time and the key could become invalid between generation and scan (e.g., RSVP cancelled)
- Writes to DynamoDB via the new store module
- Returns the check-in record

This endpoint replaces the need for Locksmith as the check-in authority.

**Important simplification**: Unlike the current routes, this endpoint does _not_ require event sponsor configuration. The existing `checkin-status` and `checkin-qr` routes both gate on `EVENT_SPONSORSHIP_ENABLED` and a valid sponsor private key (see `checkin-status/route.ts:148-152`, `checkin-qr/route.ts:280-285`) solely because they need the sponsor wallet to authenticate with Locksmith. With local DynamoDB storage, the check-in write endpoint only needs admin auth and a read-only RPC provider for on-chain verification. This removes a confusing coupling where "sponsorship disabled" meant "check-in unavailable."

#### Step 4: Update check-in status to read from DB

Modify `app/api/events/checkin-status/route.ts`:
- After resolving `tokenId` (existing logic, lines 183-197), query the local DB first.
- If a check-in record exists locally, return it directly without contacting Locksmith.
- If no local record and `LOCKSMITH_CHECKIN_FALLBACK` env var is truthy, fall back to the existing Locksmith flow (for pre-migration events).
- If no local record and fallback is off, return `{ checkedIn: false }`.

This preserves backward compatibility while defaulting to local data.

**HTTP method note**: The current `checkin-status` route uses `POST` (accepting `{ lockAddress, recipients[] }` in the body), while `checkin-qr` uses `GET` with query params. Since the new local check-in status is a simple DB lookup by lock + token, switching to `GET` with query params (`?lockAddress=...&tokenId=...`) is more appropriate and consistent with the QR route. The sponsor config removal (see Step 3) also means we no longer need the `recipients[]` array to resolve token IDs via the sponsor wallet — the client can pass the token ID directly.

### Phase 2: QR Code Independence

**Goal**: Generate and validate QR codes without Locksmith.

#### Step 5: Implement QR code generation

**Recommended approach: HMAC-signed payload.** Rationale:
- No additional DynamoDB writes/reads for token storage.
- QR codes are self-contained and verifiable without a DB round-trip.
- Stateless validation is simpler to implement and debug.
- Re-scanning the same QR works (useful at event doors).
- Expiration is embedded in the payload, not managed via TTL.

Implementation in `lib/events/checkin-qr.ts`:

```typescript
// Payload: lockAddress|tokenId|ownerAddress|issuedAt|expiresAt
// Signature: HMAC-SHA256 with NEXTAUTH_SECRET (already available)
// QR content: base64url(payload + "." + signature)
```

The `qrcode` npm package (or similar) generates the QR image. The check-in endpoint validates the signature and checks expiration.

Key design decisions:
- Use `NEXTAUTH_SECRET` as the HMAC key (no new secrets needed).
- Set expiration to 24 hours (event-day window; generous for beta).
- QR encodes a URL like `https://pgpforcrypto.org/checkin?t=<signed-token>` that the admin check-in UI can process.
- Preserve the email verification gate from the current `checkin-qr/route.ts` (lines 269-271): require `emailVerified` before generating QR codes. This is a reasonable security measure that prevents unverified accounts from obtaining check-in tokens.
- On-chain `isValidKey(tokenId)` should be checked at QR generation time (as the current route does at lines 296-318), but the admin check-in endpoint (Step 3) must _also_ verify key validity at scan time. Since QR codes are valid for 24 hours, an RSVP could be cancelled after the QR is generated.

#### Step 6: Update QR routes

Modify `app/api/events/checkin-qr/route.ts`:
- Replace the Locksmith QR fetch (lines 321-356) with local QR generation.
- Keep the existing ownership verification (lines 296-318) - this is good security.
- Remove the Locksmith login flow (~70 lines of code deleted).

Modify `app/api/events/checkin-qr/email/route.ts`:
- The current email route fetches the QR image from Locksmith and sends it as an email attachment.
- With local QR generation, the image is produced in-process via the `qrcode` package — no external fetch needed.
- Update the email attachment to use the locally generated QR image buffer instead of the Locksmith response bytes.
- Remove the Locksmith login flow from this route as well.

This eliminates the most complex Locksmith interaction in the codebase. Combined with the sponsor config decoupling (Step 3), neither the QR generation nor the email route will require sponsor wallet configuration — only a read-only RPC provider for ownership verification.

### Phase 3: Admin UI and Consolidation

**Goal**: Give admins the ability to check in attendees and view attendance.

#### Step 7: Add check-in admin UI

Extend `app/admin/events/` with check-in management:
- List of attendees per event with check-in status
- Manual check-in button (calls the new endpoint from Step 3)
- QR scan input (validates signed payload and calls check-in endpoint)

This can be built as a new section in the existing `admin-events-client.tsx` or as a sub-page.

#### Step 8: Consolidate duplicated code

During the migration work, extract shared utilities:
- Move `loginToLocksmith()` to `lib/locksmith/auth.ts` (if any Locksmith dependency remains)
- Move subgraph URL resolution to a shared constant (it is currently computed identically in 3+ files)
- Remove the duplicate `isAllowedEventLock()` from `checkin-qr/route.ts` in favor of the canonical version in `lib/events/discovery.ts`

This is cleanup, not new functionality, but reduces future maintenance burden.

### Phase 4: Membership Metadata (Lower Priority)

**Goal**: Self-host membership tier metadata like event metadata is already self-hosted.

#### Step 9: Create membership metadata store

Follow the exact pattern of `lib/events/metadata-store.ts`. Create `lib/membership/metadata-store.ts`.

The metadata table can share the roster cache table (using a different `pk` prefix like `MEMBERSHIP_META#<lockAddress>`, `sk = META`) or be a dedicated table. Using the roster cache table is simpler since it already has `pk`/`sk` keys and is always provisioned for admin use.

Record shape:
```typescript
type MembershipMetadataRecord = {
  pk: string;           // MEMBERSHIP_META#<lockAddressLower>
  sk: string;           // META
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  tierOrder: number;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string | null;
};
```

#### Step 10: Admin UI for membership metadata

Pattern after `app/admin/events/admin-events-client.tsx`. Form fields: name, description, image URL, tier order.

#### Step 11: Update frontend to use DB metadata

Modify components that display tier names/descriptions to check the DB first, falling back to on-chain data. The membership tiers are already configured via `NEXT_PUBLIC_LOCK_TIERS` with a `label` field - the DB metadata would supplement or override these.

---

## Comparison of All Three Plans

| Aspect | Base Plan | Codex Plan | DevStral Plan | This Assessment |
|--------|-----------|------------|---------------|-----------------|
| Phase count | 3 | 4 | 4 | 4 (simplified) |
| Check-in priority | Correct | Correct | Correct | Correct |
| Schema design | Sound | Sound | Sound | Sound |
| Migration tooling | Included | Minimal ("if required") | Extensive (3 weeks) | Skip for beta |
| Monitoring/alerting | Phase 3 | Not covered | Phase 3 (1 week) | Defer |
| QR strategy | Options listed | Options listed | Options listed | HMAC recommended |
| Transition planning | Detailed | Notes section | Extensive | Simplified |
| Code consolidation | Not addressed | Not addressed | Not addressed | Included |
| Timeline realism | Reasonable | Lean | Over-scoped | Lean |

**The Codex plan is the closest to what I would recommend** - it is the most pragmatic, identifies the same priorities, and avoids over-engineering. Its "Notes / Decisions to Confirm" section correctly flags the open questions without prematurely solving them.

**The DevStral plan is the most thorough** but assumes a production environment with meaningful traffic and data. Its monitoring, migration, and transition phases are appropriate for a later stage.

**The base plan** is a good middle ground but inherits some of the same over-engineering around transition planning.

---

## Specific Technical Recommendations

### 1. QR Code Strategy: Use HMAC-Signed Payloads

Rationale already detailed in Step 5 above. The short-lived DB token approach adds write amplification (one DynamoDB write per QR view) and requires TTL cleanup. HMAC payloads are stateless, free, and simpler.

### 2. Do Not Build Locksmith Synchronization

For beta, new events should use the new system exclusively. Old events' check-in data can remain in Locksmith. If an old event's check-in history is needed, a one-time manual export is sufficient. Ongoing sync adds complexity with no user value at this scale.

### 3. Reuse the Roster Cache Table for Membership Metadata

The `ADMIN_ROSTER_CACHE_TABLE` already uses `pk`/`sk` keys and is provisioned with pay-per-request billing. Adding membership metadata records with a `MEMBERSHIP_META#` prefix avoids creating another table. DynamoDB's single-table design pattern is well-suited to this.

### 4. Clean Up Unused Dependencies

`@solana/spl-token` in `package.json` appears to be unused. Removing it reduces install size and potential supply chain risk.

### 5. Extract Shared Locksmith/Subgraph Utilities

Before or during the check-in migration, consolidate the duplicated code:

| Duplicated Code | Current Locations | Suggested Location |
|-----------------|-------------------|--------------------|
| `loginToLocksmith()` | `checkin-status/route.ts`, `checkin-qr/route.ts` | `lib/locksmith/auth.ts` |
| `fetchSubgraph()` + URL resolution | `checkin-status/route.ts`, `checkin-qr/route.ts`, `discovery.ts` | `lib/subgraph/client.ts` |
| `isAllowedEventLock()` | `checkin-qr/route.ts` (local), `discovery.ts` | `lib/events/discovery.ts` only |

### 6. Consider the tokenURI Question Early

The event metadata system already solved this: events have `set-event-token-uri.mjs` which points `tokenURI` to the app's metadata endpoint. The same approach can work for membership tiers. However, membership lock tokenURI changes may require governance (if the contract owner is a multisig). Document this constraint and decide whether to pursue it before building the full metadata admin UI.

---

## Suggested Implementation Order

1. **Check-in store module + table script** (Steps 1-2)
2. **Admin check-in write endpoint** (Step 3)
3. **Update check-in status to read from DB** (Step 4)
4. **QR code generation with HMAC** (Steps 5-6)
5. **Admin check-in UI** (Step 7)
6. **Code consolidation** (Step 8)
7. **Membership metadata** (Steps 9-11, when needed)

Steps 1-4 form the critical path. Steps 5-6 can follow closely. Step 7 is useful but not blocking. Step 8 is maintenance. Steps 9-11 are a separate workstream.

**Infrastructure note**: Between Steps 2 and 3, deploy the empty DynamoDB table and add the `EVENT_CHECKIN_TABLE` environment variable to the Amplify configuration. This ensures the table exists before the admin check-in endpoint ships.

---

## Items Not Covered by Any Plan (Worth Noting)

1. **Test coverage**: The existing tests cover membership state, checkout config, and sponsor utils. There are no tests for the check-in or QR code routes. New check-in store operations should have unit tests from the start (the metadata store currently has none either).

2. **Rate limiting**: The check-in write endpoint should have basic rate limiting. The existing sponsor system has rate limiting via `lib/sponsor/audit.ts` which could serve as a pattern.

3. **The event metadata table lacks a sort key**: It uses `lockAddress` as a simple hash key. This is fine for the current use case (one metadata record per lock) but means it cannot be queried by status or date without a scan. If event listing by status becomes a frequent operation, a GSI on `status` would help. This is not urgent.

4. **Stale caches in module scope**: `discovery.ts` caches event locks in module-level variables with a 5-minute TTL. The Locksmith token is cached similarly in `checkin-status/route.ts` and `checkin-qr/route.ts`. These work in a long-running server but may behave unexpectedly in serverless/edge contexts depending on cold start behavior. Worth monitoring but not a blocking issue.

5. **Sponsor config decoupling**: After migration, the check-in status endpoint becomes a simple DB read and the QR generation only needs a read-only RPC provider. Neither requires `EVENT_SPONSORSHIP_ENABLED` or the sponsor private key. This simplification is not called out by any of the plans but meaningfully reduces operational coupling — event check-in availability will no longer depend on sponsor wallet configuration or balance.
