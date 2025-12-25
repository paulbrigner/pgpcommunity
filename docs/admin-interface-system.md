# Admin Interface System

This document describes how the admin interface works today, the underlying technical architecture, and operational guidance for admins and developers.

## Overview
- Purpose: give designated admins visibility and controls over memberships (Unlock-based), email comms, and refund/cancel requests.
- Source of truth: Unlock contracts remain authoritative for membership status, expiries, token IDs, and refunds; Dynamo/NextAuth hold user/admin flags, refund requests, and email metadata only.
- Access: gated by `isAdmin` on the NextAuth user; admins who are also lock managers can execute on-chain refunds.

## Major Capabilities
1) **Members roster**
   - Fields: name/email, primary wallet, status, tier labels (highest + next), expiries, auto-renew allowance snapshot, ETH/USDC balances, email status, admin toggle.
   - Filters: text search + status filter (default shows Active; can switch to expired/none/all).
   - Actions per member: cancel & refund (on-chain), send welcome/custom email, toggle admin.
2) **Refund requests**
   - Members submit from the Membership tab; stored in Dynamo with status (`pending/processing/completed/rejected`) and active lock metadata.
   - Admin panel shows requests, allows issue/refund (on-chain) or reject; clear-all available.
3) **Email tooling**
   - Admin can send welcome or custom emails per member; logs to user metadata via the email send API.
4) **Admin gating**
   - Nav entry and `/admin` route are gated to `isAdmin`. Roster hides the currently logged-in admin.

## Architecture
- **Frontend**: Next.js (App Router), client components for admin interactions.
- **Auth**: NextAuth with Dynamo adapter. `isAdmin` flows through JWT/session and gates admin routes/UI.
- **Data services**:
  - `membership-state-service` fetches membership snapshots (status, expiry, tokenIds, allowances) per wallet set.
  - Balances: per-wallet ETH (`getBalance`) and USDC (`balanceOf`) on Base RPC.
  - Dynamo tables: NextAuth users (includes `isAdmin`, email metadata), refund requests (`REFUND_REQUEST#id` with GSI1), email logs (per-event records).
  - Roster cache rebuilds are handled by a standalone Lambda (SAM stack in `infra/admin-roster-rebuild`) that updates the cache table asynchronously.
- **APIs**:
  - `/api/admin/members`: build roster (user + membership snapshot + balances).
  - `/api/admin/members/token-ids`: active token IDs per user across locks (returns `tokenIds` map and `activeLocks` list).
  - `/api/admin/members/rebuild`: admin-gated trigger for the external roster-rebuild Lambda.
  - `/api/admin/email/send`: admin-gated email sender; logs events and updates per-user email fields.
  - `/api/admin/users/adminize`: set/unset `isAdmin` by userId/email/wallet.
  - `/api/admin/refund/requests`: list refund requests with `canExecute` based on lock-manager check.
  - `/api/admin/refund/requests/update`: update status (completed/rejected).
  - `/api/admin/refund/requests/clear`: clear all requests.
  - `/api/membership/refund-request`: member-submitted cancellation/refund request.
  - `/api/membership/refund-request/status`: member view of latest refund request status.
- **Lock manager checks**: `lib/admin/lock-manager.ts` (`isLockManager`) used to gate refund execution visibility.
- **Email logging**: `lib/admin/email-log.ts` records email sends and updates user metadata (welcome/last email timestamps, bounce/suppression flags).

## Refund & Cancellation Flow
### Member
- On Membership tab: submit a cancellation/refund request (optional reason).
- A `REFUND_REQUEST` record is written; admin notified via email (best-effort).
- Membership tab shows status banner (pending/processing/completed); hides the form while pending/completed.
### Admin
- Refund Requests panel (admin page) lists requests with lock manager eligibility (`canExecute`). Actions: Issue refund (on-chain) or Reject; Clear-all.
- Member row action “Cancel & refund”:
  - Fetches active tokenIds (filtered to active locks).
  - Determines refund amount per key:
    - Admin override (if provided) is used as a cap.
    - Otherwise uses `refundFor` when supported; if unavailable, falls back to `keyPrice`.
  - Uses lock currency decimals (USDC → 6, otherwise 18) to parse amounts.
  - Calls `expireAndRefundFor(tokenId, amount)` directly (no simulation); lock must be funded and allow refunds.
  - Sends a confirmation email summarizing refunded locks/amounts on success.
  - Errors surface inline (e.g., underfunded lock, refunds disabled) and in the console for debugging.
### Notes and limitations
- Refunds require the connected admin wallet to be a lock manager on the target lock(s).
- Locks must have sufficient token balance; otherwise the tx reverts (“transfer amount exceeds balance”).
- If `refundFor` is unsupported or disabled, the app falls back to `keyPrice`; admin override can lower the amount but not increase it beyond what the lock allows in practice.
- We now target only active locks/keys to avoid errors on expired memberships.

## Email Flow
- Admin page per-member actions: “Send welcome/Resend” and “Send custom” (modal). Uses `/api/admin/email/send`, which logs via `recordEmailEvent` and updates user metadata.
- Member metadata fields: `welcomeEmailSentAt`, `lastEmailSentAt`, `lastEmailType`, `emailBounceReason`, `emailSuppressed`.
- Emails use the configured SMTP settings from env.

## Admin UI Behavior
- **Filters**: search + status filter (default Active). Admin user is excluded from the roster list.
- **Actions column**: Cancel & refund (visible for members with active lock info), send welcome/custom, admin toggle.
- **Wallet links**: member and refund-request wallets link to BaseScan.
- **Refund confirmation modal**: summarizes actions and optional override amount per key.
- **Refund requests panel**: shows status, wallet (clickable), tier label, created date, and actions (Issue refund/Reject).
- **Feedback**: Success/error banners inline; errors also logged to console for debugging.
- **Cache rebuild**: “Rebuild cache” calls the external Lambda via `/api/admin/members/rebuild`; the roster shows cached data while status polling waits for the rebuild to finish.

## Ops & Configuration
- Env:
  - Base RPC/chain: `NEXT_PUBLIC_BASE_RPC_URL`, `NEXT_PUBLIC_BASE_NETWORK_ID`.
  - USDC address: `NEXT_PUBLIC_USDC_ADDRESS` (used for balances/decimals fallback).
  - Email SMTP: `EMAIL_*`.
  - Dynamo: `NEXTAUTH_TABLE`, region, etc.
  - Roster rebuild Lambda: `ADMIN_ROSTER_REBUILD_URL`, `ADMIN_ROSTER_REBUILD_SECRET` (UI proxy calls Lambda).
  - Admin flag: `isAdmin` on user record; CLI `scripts/adminize.ts` and API `adminize` route available.
- Roster cache rebuild Lambda:
  - Deployed via SAM in `infra/admin-roster-rebuild`.
  - Triggered on a schedule + on demand from `/api/admin/members/rebuild`.
  - Uses a shared header secret (`ADMIN_ROSTER_REBUILD_SECRET`) so the endpoint is not public.
- Permissions:
  - Lock manager role required for on-chain refunds; ensure admin wallet is manager on all membership locks.
  - Refund locks must have sufficient balance; if underfunded, on-chain tx reverts.
- Data retention:
  - Refund requests live in Dynamo; Clear-all endpoint wipes them.
  - Email logs stored via `recordEmailEvent`.

## Known Behaviors / Troubleshooting
- **Refund reverts**: If tx reverts with “transfer amount exceeds balance,” the lock is underfunded for the requested amount. Top up the lock or lower the override.
- **Refund disabled**: If `refundFor` or `expireAndRefundFor` reverts with custom errors, the lock may have refunds disabled/penalty 100%; use a lower override or enable refunds in the lock config.
- **Token decimals**: We default to USDC=6, ETH=18. If a lock uses a different ERC20, add tokenAddress/decimals handling as needed.
- **Admin not seeing actions**: Ensure `isAdmin=true` and the admin wallet is a lock manager; roster hides the current admin from listing.

## Change Log Highlights (current implementation)
- Admin roster with status filter; excludes current admin.
- Refund requests lifecycle with admin actions and clear-all.
- Per-member email actions with logging.
- Cancellation/refund flow aligned to on-chain Unlock calls (`expireAndRefundFor`), using override/keyPrice and per-lock decimals; active-key targeting only.

## Performance Options (Admin UI Loading)
- **Cached roster + background rebuild (current)**  
  - Pros: Fast initial load from Dynamo cache; rebuilds happen asynchronously via Lambda to avoid Amplify timeouts.  
  - Cons: Snapshot freshness depends on cache TTL; details/balances still lag until fetched.
- **Incremental client fetch (lazy details)**  
  - Pros: Smaller initial payload; fetch balances/tokenIds on demand per row; reduces server load.  
  - Cons: Per-row spinners; perceived latency as rows populate; more client RPCs.
- **Background prefetch/queue for balances**  
  - Pros: Warms ETH/USDC balances in advance; smoother UI; lower RPC bursts during page view.  
  - Cons: Requires a scheduler/service; cache staleness risk; added infra complexity.
- **Pagination + virtualized table**  
  - Pros: Limits rows/render work; lowers data transfer; scales to large user counts.  
  - Cons: More UX complexity; filter/search across pages requires server support.
- **Selective fields by filter**  
  - Pros: Fetch fewer columns (e.g., omit balances/allowances until expanded); lighter responses.  
  - Cons: More conditional UI states; extra fetches when expanding.
- **Edge caching of roster JSON**  
  - Pros: Faster TTFB if cacheable; offloads origin for read-heavy scenarios.  
  - Cons: Staleness; tricky with auth/`isAdmin`; invalidation needed after updates.
- **Parallelized API calls with retry/backoff**  
  - Pros: Faster aggregate fetch when multiple RPCs are needed (balances, allowances).  
  - Cons: Potential rate-limit bursts; needs tuned concurrency.
- **Optimize membership snapshot scope**  
  - Pros: Limit to active wallets/locks only; fewer tokenId/allowance calls; less data.  
  - Cons: Missing historical/expired context unless explicitly fetched.
