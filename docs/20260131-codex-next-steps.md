# Development Next Steps (Codex) - January 31, 2026

This plan is grounded in the current codebase state. It focuses on removing Unlock Locksmith dependencies for event check-ins first, then migrating membership metadata storage.

## Current State (as of commit 84f00db)

- Event check-in status is fetched from Locksmith in `app/api/events/checkin-status/route.ts`.
- QR code generation and emailing rely on Locksmith in:
  - `app/api/events/checkin-qr/route.ts`
  - `app/api/events/checkin-qr/email/route.ts`
  - UI entry point in `components/home/NftCollection.tsx`.
- Event metadata already lives in DynamoDB and is editable via the admin UI:
  - Storage: `lib/events/metadata-store.ts`
  - Admin UI: `app/admin/events/admin-events-client.tsx`
- Membership metadata still depends on Unlock infrastructure.

## Phase 1: Event Check-in Source of Truth (Highest Priority)

### 1) Create Check-in Storage (DynamoDB)

Goal: store check-ins locally and treat our DB as the source of truth.

Tasks:
- Add `EVENT_CHECKIN_TABLE` to `lib/config.ts`.
- Extend `scripts/setup/create-dynamodb-tables.mjs` to create the check-in table.
- Add a new storage module, e.g. `lib/events/checkin-store.ts`.

Suggested table design:
- Primary key: `pk = EVENT_CHECKIN#<lockAddress>`, `sk = TOKEN#<tokenId>`
- Fields: `checkedInAt`, `checkedInBy`, `method`, `notes`, `ownerAddress`, `createdAt`, `updatedAt`
- Optional GSI for `ownerAddress` lookups (only if needed).

Verification:
- Table exists in dev and staging.
- Basic read/write works with a mock record.

### 2) Add Check-in Write Endpoint (Admin / Staff)

Goal: support staff/admin check-in that writes to our DB.

Tasks:
- Create an API route (new) such as `app/api/events/checkin/route.ts`.
- Require admin session via `lib/admin/auth.ts`.
- Validate:
  - event lock is allowed via `lib/events/discovery.ts`
  - token ownership is valid on-chain (reuse provider/contract patterns from check-in QR routes)
- Write idempotently to the new table.
- Add audit logging (who checked in, when, method).

Verification:
- Admin can check in a valid token; repeat checks are idempotent.
- Unauthorized users are rejected.

### 3) Read Check-in Status from DB (with optional fallback)

Goal: update check-in status to prefer local DB.

Tasks:
- Update `app/api/events/checkin-status/route.ts` to:
  1. Resolve tokenId as it currently does.
  2. Query DB for check-in status by lock+tokenId.
  3. If missing and fallback is enabled, read Locksmith and optionally cache.
- Add a feature flag (env) to enable/disable Locksmith fallback during transition.

Verification:
- Attendance status reads from DB for checked-in users.
- Fallback still works when DB is empty (if enabled).

### 4) Staff Check-in UI

Goal: a minimal admin/staff page to process check-ins.

Tasks:
- Add a new admin page (e.g. `app/admin/events/checkin`) or extend `app/admin/events`.
- Allow manual entry of lockAddress + tokenId, or QR scanning input.
- Call the new check-in write endpoint.

Verification:
- Staff can check in an attendee and see success/failure states.

## Phase 2: QR Code Independence

### 5) Replace QR Generation

Goal: stop relying on Locksmith for QR images.

Options:
- Signed payload (HMAC/JWT): QR encodes a short-lived token.
- Short-lived DB token: QR encodes a UUID and server verifies via a TTL table.

Tasks:
- Implement a generator in `lib/events/checkin-qr.ts`.
- Update `app/api/events/checkin-qr/route.ts` and `app/api/events/checkin-qr/email/route.ts` to return app-generated QR.
- Update `components/home/NftCollection.tsx` to consume the new QR output (image or data URL).
- Add verification logic in the check-in write endpoint.

Verification:
- New QR codes work end-to-end.
- Locksmith QR support can remain during transition (if needed).

## Phase 3: Data Migration (If Required)

### 6) Backfill Historical Check-ins

Goal: import past check-ins from Locksmith for continuity.

Tasks:
- Create a script (e.g. `scripts/migrate/checkins-from-locksmith.mjs`).
- Implement reconciliation (counts by lock).

Verification:
- Backfill succeeds with >99% match (or documented exceptions).

## Phase 4: Membership Metadata Migration

### 7) Create Membership Metadata Store

Goal: store and serve membership metadata from our DB.

Tasks:
- Add a new table (or extend existing) for membership metadata.
- Implement store module in `lib/membership-metadata-store.ts` (patterned after `lib/events/metadata-store.ts`).
- Add admin CRUD UI (patterned after `app/admin/events`).

Verification:
- Admin can create/edit tier metadata.
- Data is persisted and visible in the UI.

### 8) Update Membership Views

Goal: use DB metadata first, with on-chain fallback.

Tasks:
- Update membership UI components to read metadata from DB.
- Keep on-chain name as fallback.

Verification:
- UI shows DB metadata when available.

## Immediate Actions (This Week)

1) Add check-in table + config + store module.
2) Create admin check-in write endpoint.
3) Add minimal staff check-in UI.
4) Switch check-in status reads to DB (with fallback flag).

## Notes / Decisions to Confirm

- QR strategy (signed payload vs short-lived DB token).
- Whether historical check-in data must be migrated.
- Whether staff check-in should be admin-only or have a separate role.
- How long Locksmith fallback should remain enabled.
