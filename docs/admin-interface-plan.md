# Admin Interface Plan

## Objectives
- Let designated admins view and manage memberships without changing the on-chain source of truth.
- Surface member roster details (status, expiry, tenure, auto-renew, wallet balances) to spot at-risk accounts.
- Provide outbound email tools (welcome and follow-ups) with delivery state visibility.
- Keep access scoped to authenticated admins and align with existing Unlock-driven membership evaluation.

## Admin Identity & Access Control
- User model: add `isAdmin: boolean` (and optional `roles: string[]` for future scopes) in Dynamo/NextAuth user records; expose in JWT/session.
- Elevation: seed/update admins via migration script or one-off admin dashboard toggle (gated to existing admins).
- Gating:
  - Route-level: protect `/admin` pages with server-side session check; redirect or 403 when non-admin.
  - API/server actions: shared `assertAdmin(session)` guard for all admin endpoints.
  - UI: conditionally render admin nav/actions when `session.user.isAdmin` is true.

## Data Sources
- Directory of users: NextAuth/Dynamo users (name, email, walletAddress, wallets[]).
- Membership state: `membership-state-service` outputs (status, expiry, token IDs, allowances). Extend to return `purchasedAt`/`start` timestamp from Unlock subgraph to compute tenure.
- Auto-renew: derive from USDC allowance per lock (existing snapshot) and active tier.
- Balances: Base ETH via provider `getBalance`; USDC via ERC20 `balanceOf` using configured Base RPC and USDC contract address.
- Email status: store `welcomeEmailSentAt`, `lastEmailSentAt`, `lastEmailType`, `emailBounceReason?`, `emailSuppressed?` per user plus an `EmailLog` table for history (id, userId, wallet, type, subject, status, providerMessageId).

## Core Admin Views
- Admin home: quick stats (total members by tier/status, soon-to-expire, auto-renew off, low balance wallets).
- Member table:
  - Columns: name/email, primary wallet, membership status/tier, tenure (now - purchasedAt), expiry, auto-renew flag, ETH balance, USDC balance, welcome email status.
  - Filters/sorts: tier, status, expiry window (e.g., expiring <30d), auto-renew off, balance thresholds, email not sent.
  - Actions: view member detail, send welcome/resend, send reminder, copy wallet, export filtered CSV.
- Member detail drawer/page:
  - Profile: contact info, wallets, notes.
  - Membership: per-tier status/expiry/tokenId, auto-renew allowance, history of renewals (from subgraph if available).
  - Balances: ETH/USDC with “funding needed” indicator when below configurable minimum for auto-renew + gas.
  - Email history and quick-send buttons (welcome, renewal reminder, manual/custom template).

## Email Workflows
- Templates: welcome, renewal reminder (auto-renew off), low balance, general announcement; rendered with user/tier context.
- Delivery: reuse existing email provider client; enqueue send via server action/route; log attempts/results in `EmailLog`; update per-user `welcomeEmailSentAt`.
- Idempotency: guard welcome email per user unless forced resend; batch sends use background queue to avoid UI blocking.
- Compliance: honor suppression/bounce flags; expose indicators in UI.

## UX & Performance Considerations
- Data fetching: SSR the initial table with cached snapshots; client-side refresh for balances/expiry to avoid cold RPC lag.
- Rate limiting: throttle balance lookups and subgraph calls; cache per-wallet balance for a short TTL; paginate table.
- Empty/edge states: users without wallets flagged; addresses with no membership marked “none”.
- Observability: add server logs for admin actions (view detail, send email) and errors.

## Implementation Plan
- Roles & Session
  - Add `isAdmin` (and optional `roles`) to user schema, JWT, and `types/next-auth.d.ts`.
  - Create admin seed script/CLI to mark users by email or wallet; ensure idempotent.
  - Add shared `requireAdmin` helper; wrap admin routes/actions.
- Data APIs
  - Extend `membership-state-service` to return `purchasedAt`/tenure data and expose per-user snapshot fetch by wallet.
  - Add balance helpers for Base ETH/USDC with caching and error tolerance.
  - Build admin roster API that joins user records with membership snapshot and balances; supports filters and pagination.
  - Add email log persistence (`EmailLog` model/table) and helper functions to record send attempts/results.
- UI
  - Create `/admin` layout with nav tabs (Dashboard, Members, Emails/Logs).
  - Members page: table with the columns/filters above; detail drawer; inline actions for emails.
  - Dashboard: counts and charts for active/expiring/auto-renew off; low-balance list.
  - Emails/logs view: searchable history with status/bounce info.
- Emails
  - Implement welcome/reminder templates; wire to provider; add resend and batch send actions.
  - Update sign-up flow to enqueue welcome email and mark `welcomeEmailSentAt`.
  - Add low-balance/expiry reminder jobs (cron/queue or on-demand admin trigger).
- Hardening & Ops
  - Add tests for admin gating, roster API aggregation, and email logging.
  - Document environment/config needs (USDC address, balance thresholds, email provider keys).
  - Provide runbook for adding/removing admins and troubleshooting delivery/balance fetch failures.
