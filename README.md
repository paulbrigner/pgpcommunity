# PGP Community Platform

## Overview
Community platform built with Next.js 15+, deployed on AWS Amplify. Auth is handled via NextAuth (email) with SIWE wallet linking, and Unlock Protocol for membership. Direct Unlock checkout flows power memberships and on‑site event RSVPs.

## Security Warning
This software is under active development and has not undergone a full independent security review. Deploy at your own risk. Do not store production‑critical secrets or funds in connected wallets unless you understand the risks and have performed your own assessment. If you discover a potential vulnerability, please report it privately to the maintainers rather than opening a public issue.

## Features

- **Authentication/Authorization**:
  - NextAuth for email sign-in and SIWE wallet linking
  - Wallet-first sign-up flow that guides new users through wallet connection, email verification, and automatic wallet linking after verification
- **Membership & RSVPs**:
  - Unlock Protocol membership with on-site checkout; RSVP uses the same direct checkout flow
- **Creator NFT collection**:
  - `/api/nfts` fetches member-held ERC-721s on Base created by the membership lock or its owner. Metadata is consolidated via Alchemy to avoid repeated on-chain tokenURI fetches and to normalize image/trait fields; the API falls back to raw chain data when metadata is sparse.
  - Home page shows “Your PGP NFT Collection” with manual refresh option
  - Future meetings that the member has registered for automatically move into the collection, where they render formatted event date, time, timezone, and location instead of the long-form description
  - Registered future meetings display a “You’re Registered!” indicator plus quick actions to add the event to Google Calendar or download a `.ics` file
- **Membership logic**:
  - Membership state is derived on-chain (Unlock locks + USDC approvals) and cached briefly server-side; UI consumes snapshots.
  - Checkout/renewal, upgrades/downgrades, event registration, and auto-renew setup run client-side via Unlock JS; server helpers refresh/invalidate cache and rehydrate status.
  - Members can change tiers (upgrade/downgrade), cancel/disable auto-renew, request refunds (with reason/status tracking), and view expiry and allowances.

## Unlock Protocol Integration
- **Checkout & RSVPs**: Client-only Unlock checkout via `useUnlockCheckout` for memberships and event RSVPs. Lock/tier configs come from `NEXT_PUBLIC_LOCK_TIERS` and optional overrides in `CHECKOUT_CONFIGS`. After a checkout completes, the app invalidates membership caches and refetches status/allowances.
- **Membership state**: Membership is derived from Unlock locks on Base. The server snapshots status/expiry, tokenIds (when available), and USDC allowances for auto-renew, caches briefly, and hydrates the client. React Query keeps this data fresh with short TTLs.
- **Event NFTs**: `/api/nfts` pulls owned/earned event NFTs (and missed/upcoming data) on Base. Metadata is consolidated via Alchemy to avoid repeated on-chain tokenURI fetches and to normalize image/trait fields; fall back to raw chain data when metadata is sparse.
- **Subgraph/token IDs**: When locks are not enumerable, the app can use Unlock’s subgraph (`UNLOCK_SUBGRAPH_ID`/`UNLOCK_SUBGRAPH_API_KEY` or `NEXT_PUBLIC_UNLOCK_SUBGRAPH_URL`) to resolve token IDs for renewals and ownership checks.
- **Allowances for auto-renew**: The app checks and displays USDC allowances per lock to guide auto-renew setup. Requests avoid unlimited approvals (`SAFE_ALLOWANCE_CAP`) and default to 12-month coverage.
- **Error handling & fallbacks**: RPC/provider calls are retried modestly; membership state preserves a previously-active tier during transient fetch issues to avoid accidental downgrades in UI.

## Admin Functionality
- Roster management: view member roster, linked wallets, balances, allowances, and membership state snapshots.
- Refund workflow: review pending refund requests, update statuses, and issue refunds.
- Communications: send welcome or custom emails to selected users.
- Token visibility: inspect member token IDs and allowances per lock to troubleshoot renewals or auto-renew setup.
- Quick actions: adminize users, clear or refresh cached membership state as needed.

## Persistence & Data Flow
- **Sessions/Auth**: NextAuth with DynamoDB adapter stores Users, Accounts, and VerificationTokens. JWT-based sessions are enriched with profile and membership fields for short TTLs to reduce on-chain checks.
- **Profile data**: User profile fields (name, handles, email) are stored via NextAuth in DynamoDB and exposed on the session.
- **Membership state**: Derived from on-chain Unlock locks; cached briefly in-memory on the server (see `membershipStateService`). Server actions can invalidate/prime caches; client hydrates via React Query.
- **NFT/event data**: Fetched on demand from `/api/nfts`, which aggregates on-chain data with Alchemy metadata; not persisted server-side.
- **Refund requests/admin actions**: Tracked via API routes backed by DynamoDB (through the NextAuth adapter tables and custom entries where applicable).

## Setup
### Environment Variables
```bash
## Public (client + server)
NEXT_PUBLIC_LOCK_TIERS=[{"id":"holder","address":"0xed16cd934780a48697c2fd89f1b13ad15f0b64e1","label":"Holder","order":0},{"id":"staker","address":"0xb5d2e305c589b1d7a1873c73637adf9a52724105","label":"Staker","order":1},{"id":"builder","address":"0xdd7fff4931409e2d1da47be9798fd404cc44e9a9","label":"Builder","order":2}]
NEXT_PUBLIC_LOCK_ADDRESS=...
NEXT_PUBLIC_UNLOCK_ADDRESS=...
NEXT_PUBLIC_BASE_NETWORK_ID=8453
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
NEXT_PUBLIC_BASE_BLOCK_EXPLORER_URL=https://basescan.org
NEXT_PUBLIC_LOCKSMITH_BASE=https://locksmith.unlock-protocol.com
NEXT_PUBLIC_UNLOCK_SUBGRAPH_URL=

## Server-only (do not prefix with NEXT_PUBLIC_)
UNLOCK_SUBGRAPH_ID=
UNLOCK_SUBGRAPH_API_KEY=
HIDDEN_UNLOCK_CONTRACTS=
CHECKOUT_CONFIGS=
REGION_AWS=us-east-1

# NextAuth
# Server-only secrets
NEXTAUTH_URL=https://your-domain
NEXTAUTH_SECRET=your-long-random-secret
NEXTAUTH_TABLE=NextAuth
# If you also set NEXT_PUBLIC_NEXTAUTH_URL for client-only needs, keep it in sync with NEXTAUTH_URL.
# Do NOT expose NEXTAUTH_SECRET as a NEXT_PUBLIC_* variable.

# Email provider (AWS SES)
# Option A: Discrete SMTP vars (recommended to avoid URL encoding issues)
EMAIL_SERVER_HOST=email-smtp.us-east-1.amazonaws.com
EMAIL_SERVER_PORT=587
EMAIL_SERVER_USER=SMTP_USER
EMAIL_SERVER_PASSWORD=SMTP_PASS
EMAIL_SERVER_SECURE=false
EMAIL_FROM=PGP Community <no-reply@your-domain>

# Option B: Single SMTP URL (must URL-encode username/password if they contain special chars)
 # EMAIL_SERVER=smtp://SMTP_USER:SMTP_PASS@email-smtp.us-east-1.amazonaws.com:587
```

`CHECKOUT_CONFIGS` format example:

```
CHECKOUT_CONFIGS=0x1111111111111111111111111111111111111111:{"locks":{"0x1111111111111111111111111111111111111111":{"network":8453}},"title":"Register"};0x2222222222222222222222222222222222222222:{"locks":{"0x2222222222222222222222222222222222222222":{"network":8453}},"title":"Register"}
```

Each pair maps a lock address to a JSON config snippet (as a single-line JSON string). Separate pairs with semicolons. The new Unlock checkout helpers merge these overrides with sensible defaults when embedding the React-based checkout component. If an address is omitted, the UI falls back to the tier metadata in `lib/checkout-config.ts` and still renders a purchase drawer, but without the extra customizations from this map.

Notes:
- Ensure server-only env vars are set in Amplify build/deploy environment (not exposed to the client).
- DynamoDB table for NextAuth is created/used by the adapter (name via `NEXTAUTH_TABLE`). Ensure the Amplify role has read/write access to it.
- For deterministic membership tokenId lookups on non-enumerable locks, set either `NEXT_PUBLIC_UNLOCK_SUBGRAPH_URL` *or* both `UNLOCK_SUBGRAPH_API_KEY` and `UNLOCK_SUBGRAPH_ID`. Without these, checkout may refuse renewals when a key exists but the tokenId cannot be discovered.

### Authentication (NextAuth v4 + Email + SIWE)
- API route: `app/api/auth/[...nextauth]/route.ts` uses NextAuth v4 with:
  - Email provider (magic links) using SES SMTP via `EMAIL_SERVER`/`EMAIL_FROM`
  - Credentials provider to verify SIWE messages
  - DynamoDB adapter for User/Account/VerificationToken persistence
- Session fields: `session.user.id`, `session.user.email`, and `session.user.walletAddress`.
- Client helper: `lib/siwe/client.ts` exposes `signInWithSiwe()` (returns `{ ok, error, address }`).
- Sign-in page: `app/(auth)/signin/page.tsx` handles both wallet-first sign-up and legacy email sign-in flows.

#### Sign-up Flow
- Visiting `/signin?reason=signup` presents a wallet-first wizard:
  1. **Connect wallet** – Attempts SIWE. If the wallet is already linked, the user is signed in instantly. Otherwise, the wallet address is captured for the pending signup state.
  2. **Enter email** – Submitting stores `{ email, wallet }` via `POST /api/signup/pending` and triggers the NextAuth magic-link email.
  3. **Check email** – Confirmation screen summarises the wallet + email and instructs the user to verify their address.
- After email verification, the NextAuth session callback consumes the pending record, links the wallet to the user, and clears the temporary entry so the home page immediately recognises the wallet as linked.

Email-first UX and wallet linking
- Legacy email-first flows still redirect to `/signin` with a helpful banner and `callbackUrl` back to where the user started.
- Authenticated users without a wallet see a “Link Wallet” action on the home page.
- Wallets are linked to the current user via `POST /api/auth/link-wallet` and shown as `session.user.wallets`.

Linking a wallet
- API route: `app/api/auth/link-wallet/route.ts` verifies a SIWE message and links the wallet to the currently signed-in user using the NextAuth adapter.
- Client helper: `linkWalletWithSiwe()` in `lib/siwe/client.ts` triggers the SIWE signature and POSTs to the link route.
- Conflict handling: returns HTTP 409 if the wallet address is already linked to a different account.

Unlinking a wallet
- API route: `app/api/auth/unlink-wallet/route.ts` removes a linked wallet for the current user.
- UI: See the Wallets section on `Settings → Profile` to unlink addresses.

Pending signup storage
- API route: `app/api/signup/pending/route.ts` persists `{ email, wallet }` pairs during wallet-first signup until the user verifies their email.
- The NextAuth session callback calls `consumePendingSignup()` to link the stored wallet as soon as the verification completes, then deletes the pending record.

Profile collection
- Sign-in page collects `firstName` (required), `lastName` (required), `xHandle` (optional), and `linkedinUrl` (optional) along with email.
- Client validation ensures required fields and basic URL format.
- The data is saved to the database after email verification via `POST /api/profile/update`.
- Session exposes `session.user.firstName`, `lastName`, `xHandle`, `linkedinUrl`, and the UI greets the user by first name.

Protecting API routes
- Use NextAuth’s JWT: in a route handler, import `getToken` from `next-auth/jwt` and require a valid token before serving content (see `app/api/content/[file]/route.ts`).
- Member-only endpoints should also verify Unlock membership before returning data.

## Deployment
### CI/CD (GitHub + AWS Amplify)
- Connected build: Amplify is linked to this GitHub repository. Pushes to the tracked branch (e.g., `main`) trigger an automatic build and deploy.
- Preview builds: pull requests create ephemeral preview deployments with unique URLs for review. Merge or close the PR to clean them up.
- Build config: the pipeline is defined in `amplify.yml` at the repo root. It sets the Node runtime and runs the Next.js build (including API routes/SSR) and any post‑build steps.
- Environment variables: set per Amplify environment in the Amplify Console (never commit secrets). Server‑only variables (no `NEXT_PUBLIC_` prefix) are injected at build/runtime for API routes and SSR.
- Branch environments: you can connect additional branches (e.g., `staging`) to create isolated Amplify environments with their own env vars and URLs.
- Rollbacks & retries: from the Amplify Console, redeploy a previous successful build or retry a failed one without a new commit.
- IAM & permissions: ensure the Amplify service role has access to required AWS resources (DynamoDB for NextAuth, SES for email, RPC provider access as needed).

## Security Architecture
### Authentication & Authorization
- **Identity providers**:
  - Email (magic link) via NextAuth Email provider + SES SMTP.
  - Wallet (SIWE) only for wallets already linked to the signed‑in user. Unlinked wallets are rejected with a clear message.
- **Session model (JWT)**:
  - NextAuth uses JWT sessions; the session callback enriches `session.user` with profile fields and linked `wallets` from DynamoDB.
  - Server periodically enriches the JWT with membership `status` and `expiry` (5‑minute TTL) using a server‑side RPC, reducing on‑chain calls from the client.
  - To avoid spoofing via a connected browser wallet, the app uses only addresses in the user’s linked `wallets` for membership checks and ignores unlinked browser wallets.
- **Wallet linking**:
  - SIWE signature is verified in `POST /api/auth/link-wallet`. On success the address is added to the user record and shown in `session.user.wallets`.
  - Unlinking is available via `POST /api/auth/unlink-wallet` and in Settings → Profile.
- **Authorization**:
  - Member‑only content: gated via Unlock membership (by linked wallets).
  - API protection: routes verify an authenticated session (e.g., `getToken`) and/or membership before returning data.
  - Admin routes (roadmap): add a role flag on the user record; protect `/admin/*` routes by role in the session callback.
- **CSRF & replay protection**:
  - NextAuth’s built‑in CSRF protection for email sign‑in flow; SIWE uses NextAuth’s CSRF token as the nonce.
  - All state‑changing routes require an authenticated session and validate inputs server‑side.
- **Secrets & RPC**:
  - Client uses `NEXT_PUBLIC_BASE_RPC_URL` (browser‑safe, domain‑allow‑listed keys if using a managed provider).
  - Server uses a private `BASE_RPC_URL` (no `NEXT_PUBLIC_`) and can be extended to try multiple providers for redundancy.

### Key Security Components
| Component | Description |
|---|---|
| Authentication | NextAuth Email (magic links) and SIWE for wallets. SIWE is accepted only for wallets already linked to the signed-in user. |
| Authorization & Gating | Unlock Protocol membership gates access. |
| Session (JWT) | Server enriches JWT with profile, linked wallets, and membership (status/expiry) with a 5‑minute TTL to reduce chain calls. |
| Wallet Linking | `POST /api/auth/link-wallet` verifies SIWE and writes the address to the user; `POST /api/auth/unlink-wallet` removes it. UI to manage under Settings → Profile. |
| API Protection | Auth‑required routes check NextAuth tokens (e.g., via `getToken`). Member‑only routes also verify Unlock membership before responding. |
| Secrets Management | Secrets live in Amplify environment variables (or local `.env`). Never expose secrets with `NEXT_PUBLIC_`. |
| RPC Strategy | Client uses a browser‑safe `NEXT_PUBLIC_BASE_RPC_URL`. Server uses a private `BASE_RPC_URL` (and can add redundancy) for reliable membership checks. |
| Data Storage (DynamoDB) | NextAuth adapter persists Users/Accounts/VerificationTokens. The app reads linked wallets and profile fields from DynamoDB in session callbacks. |
| Email Delivery | SES SMTP credentials power NextAuth Email provider and outbound notifications (where used). |
| CSRF & Nonce | NextAuth built‑in CSRF for email; SIWE uses NextAuth’s CSRF token as the SIWE nonce to prevent replay. |
| Roles (Admin) | Planned: add an admin flag on the user record to gate `/admin/*` routes and admin features. |
| Observability | Planned: add structured logs/metrics around auth, wallet linking, and membership checks; alert on RPC failures. |

## Architecture Notes
- Wallet auth via NextAuth + SIWE (only for previously linked wallets).
- Client-side Unlock checkout opens on demand; tiers come from `NEXT_PUBLIC_LOCK_TIERS` and event configs from `CHECKOUT_CONFIGS`. After checkout, membership and allowances are refreshed.

## Dependencies
- **Core**: Next.js 15+, TypeScript, AWS Amplify, Tailwind CSS v4 (CLI)
- **UI**:
  - shadcn/ui (see `components.json`, `@/components/ui/*`)
  - Radix UI primitives (`@radix-ui/react-navigation-menu`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-slot`)
  - lucide-react icons
- **Auth/Wallet**: `next-auth@^4`, `siwe`, `@next-auth/dynamodb-adapter`, `ethers`, `@unlock-protocol/unlock-js`, `@unlock-protocol/networks`
- **Data/Fetch**: `@tanstack/react-query`, `axios`
- **Scheduling/Calendar**: `luxon`, `ics`
- **Content**: `react-markdown`, `remark-gfm`
- **Testing/Tooling**: Vitest + @testing-library/*, Storybook 8, eslint 9, TypeScript 5.9

## License
All code in this workspace is licensed under either of

- Apache License, Version 2.0 (see `LICENSE-APACHE` or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license (see `LICENSE-MIT` or http://opensource.org/licenses/MIT)

at your option.

## Contribution
Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache‑2.0 license, shall be dual licensed as above, without any additional terms or conditions.
