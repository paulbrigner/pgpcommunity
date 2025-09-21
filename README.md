# PGP Community Platform

## Overview
Community platform built with Next.js 15+, deployed on AWS Amplify. Auth is handled via NextAuth (email) with SIWE wallet linking, and Unlock Protocol for membership gating. Gated content is served from CloudFront using server‑generated signed URLs (see `lib/cloudFrontSigner.ts`) with the signing key loaded from server environment variables.

## Security Warning
This software is under active development and has not undergone a full independent security review. Deploy at your own risk. Do not store production‑critical secrets or funds in connected wallets unless you understand the risks and have performed your own assessment. If you discover a potential vulnerability, please report it privately to the maintainers rather than opening a public issue.

## Features

- **Authentication/Authorization**:
  - NextAuth for email sign-in and SIWE wallet linking
  - Wallet-first sign-up flow that guides new users through wallet connection, email verification, and automatic wallet linking after verification
  - Unlock Protocol for membership gating
  - API route at `/app/api/content/[file]/route.ts` issues CloudFront signed URLs
- **Secure Content Delivery**:
  - Private files in S3 accessed via CloudFront signed URLs
  - **Origin Access Control (OAC)** restricts S3 bucket access to CloudFront only
  - Signed URL generation handled in‑app via `lib/cloudFrontSigner.ts`
  - Private key provided via server env var `PRIVATE_KEY_SECRET`
- **Creator NFT collection**:
  - `/api/nfts` fetches member-held ERC-721s on Base created by the membership lock or its owner, consolidating metadata from Alchemy
  - Home page shows “Your PGP NFT Collection” with manual refresh option
  - Future meetings that the member has registered for automatically move into the collection, where they render formatted event date, time, timezone, and location instead of the long-form description
  - Registered future meetings display a “You’re Registered!” indicator plus quick actions to add the event to Google Calendar or download a `.ics` file
- **Secrets Management**:
  - Server environment variables store sensitive credentials including:
    - CloudFront private key for signed URL generation (`PRIVATE_KEY_SECRET`)
    - CloudFront distribution config values (`CLOUDFRONT_DOMAIN`, `KEY_PAIR_ID`)

## Setup
### Environment Variables
```bash
## Public (client + server)
NEXT_PUBLIC_LOCK_ADDRESS=...
NEXT_PUBLIC_UNLOCK_ADDRESS=...
NEXT_PUBLIC_BASE_NETWORK_ID=8453
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
NEXT_PUBLIC_BASE_BLOCK_EXPLORER_URL=https://basescan.org
NEXT_PUBLIC_LOCKSMITH_BASE=https://locksmith.unlock-protocol.com
NEXT_PUBLIC_UNLOCK_SUBGRAPH_URL=

## Server-only (do not prefix with NEXT_PUBLIC_)
CLOUDFRONT_DOMAIN=assets.pgpforcrypto.org
KEY_PAIR_ID=KERO2MLM81YXV
UNLOCK_SUBGRAPH_ID=
UNLOCK_SUBGRAPH_API_KEY=
HIDDEN_UNLOCK_CONTRACTS=
CHECKOUT_CONFIGS=
PRIVATE_KEY_SECRET='-----BEGIN RSA PRIVATE KEY-----...'
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

Each pair maps a lock address to a JSON Paywall config snippet (as a single-line JSON string). Separate pairs with semicolons. The app merges this with sensible defaults (network, order, etc.) when launching the in-page paywall modal. If an address is omitted, a default config is generated automatically.

Notes:
- Ensure these server-only env vars are set in Amplify build/deploy environment (not exposed to the client).
- DynamoDB table for NextAuth is created/used by the adapter (name via `NEXTAUTH_TABLE`). Ensure the Amplify role has read/write access to it.

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
- Connected build: the Amplify app is linked to this GitHub repository. Pushes to the tracked branch (e.g., `main`) trigger an automatic build and deploy to the Production environment.
- Preview builds: pull requests create ephemeral preview deployments with unique URLs for review. Merge or close the PR to clean them up.
- Build config: the pipeline is defined in `amplify.yml` at the repo root. It sets the Node runtime and runs the Next.js build (including API routes/SSR) and any post‑build steps.
- Environment variables: set per Amplify environment in the Amplify Console (never commit secrets). Server‑only variables (no `NEXT_PUBLIC_` prefix) are injected at build/runtime for API routes and SSR.
- Branch environments: you can connect additional branches (e.g., `staging`) to create isolated Amplify environments with their own env vars and URLs.
- Rollbacks & retries: from the Amplify Console, redeploy a previous successful build or retry a failed one without a new commit.
- IAM & permissions: ensure the Amplify service role has access to required AWS resources (S3/CloudFront for assets, DynamoDB for NextAuth, SES for email).

### Step 5: Configure Origin Access Control (OAC)
1. **Create OAC Policy** in CloudFront console:
   ```bash
   aws cloudfront create-cloud-front-origin-access-control \
     --name pgpcommunity-oac \
     --type s3 --description "Restrict S3 access to CloudFront"
   ```
2. **Attach OAC to Distribution**:
   - In CloudFront console, update distribution settings to use the OAC policy

<!-- Secrets are provided via environment variables. -->

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
  - Member‑only content: gated via Unlock membership. The server checks membership (by linked wallets) and issues time‑boxed CloudFront signed URLs for assets.
  - API protection: routes verify an authenticated session (e.g., `getToken` in `/api/content/[file]`) and/or membership before returning data.
  - Admin routes (roadmap): add a role flag on the user record; protect `/admin/*` routes by role in the session callback.
- **CSRF & replay protection**:
  - NextAuth’s built‑in CSRF protection for email sign‑in flow; SIWE uses NextAuth’s CSRF token as the nonce.
  - All state‑changing routes require an authenticated session and validate inputs server‑side.
- **Secrets & RPC**:
  - Client uses `NEXT_PUBLIC_BASE_RPC_URL` (browser‑safe, domain‑allow‑listed keys if using a managed provider).
  - Server uses a private `BASE_RPC_URL` (no `NEXT_PUBLIC_`) and can be extended to try multiple providers for redundancy.

### CloudFront Signed URLs Workflow
1. **User Authentication**:
   - NextAuth verifies email sessions; SIWE verifies wallet ownership; Unlock enforces membership
2. **Server-Side Signing**:
   - API runs on Node.js runtime (`export const runtime = "nodejs"`)
   - Reads the private key from environment variable `PRIVATE_KEY_SECRET`
   - Generates a 5‑minute signed URL via `lib/cloudFrontSigner.ts`
   - Returns `{ url }` from `/api/content/[file]`
3. **CloudFront Validation**:
   - Validates signature using public key
   - Serves content only if OAC policy and signature are valid

### Key Security Components
| Component | Description |
|---|---|
| Authentication | NextAuth Email (magic links) and SIWE for wallets. SIWE is accepted only for wallets already linked to the signed-in user. |
| Authorization & Gating | Unlock Protocol membership gates access; server issues short‑lived CloudFront signed URLs for protected assets. |
| Session (JWT) | Server enriches JWT with profile, linked wallets, and membership (status/expiry) with a 5‑minute TTL to reduce chain calls. |
| Wallet Linking | `POST /api/auth/link-wallet` verifies SIWE and writes the address to the user; `POST /api/auth/unlink-wallet` removes it. UI to manage under Settings → Profile. |
| API Protection | Auth‑required routes check NextAuth tokens (e.g., via `getToken`). Member‑only routes also verify Unlock membership before responding. |
| CloudFront Signed URLs | `app/api/content/[file]` returns time‑boxed, signed URLs generated by `lib/cloudFrontSigner.ts`. Only valid for a few minutes. |
| Origin Access Control (OAC) | S3 buckets are not public; CloudFront accesses S3 with OAC so files are only retrievable via valid CloudFront requests. |
| Secrets Management | Secrets live in Amplify environment variables (or local `.env`). Never expose secrets with `NEXT_PUBLIC_`. |
| RPC Strategy | Client uses a browser‑safe `NEXT_PUBLIC_BASE_RPC_URL`. Server uses a private `BASE_RPC_URL` (and can add redundancy) for reliable membership checks. |
| Data Storage (DynamoDB) | NextAuth adapter persists Users/Accounts/VerificationTokens. The app reads linked wallets and profile fields from DynamoDB in session callbacks. |
| Email Delivery | SES SMTP credentials power NextAuth Email provider and outbound notifications (where used). |
| CSRF & Nonce | NextAuth built‑in CSRF for email; SIWE uses NextAuth’s CSRF token as the SIWE nonce to prevent replay. |
| Roles (Admin) | Planned: add an admin flag on the user record to gate `/admin/*` routes and admin features. |
| Observability | Planned: add structured logs/metrics around auth, wallet linking, and membership checks; alert on RPC failures. |

## Architecture Notes
- **Unlock Integration**:
  - Wallet auth via NextAuth + SIWE (only for previously linked wallets)
  - Unlock checkout is opened client-side; after closing, the app refreshes membership status
- **CloudFront Distribution**:
  - Configured with Trusted Key Groups for signature validation
  - OAC ensures S3 only serves content via authenticated CloudFront requests

## Dependencies
- **Core**: Next.js 15+, TypeScript, AWS Amplify, Tailwind CSS v4 (CLI)
- **UI**:
  - shadcn/ui (see `components.json`, `@/components/ui/*`)
  - Radix UI (primitives):
    - `@radix-ui/react-navigation-menu`
    - `@radix-ui/react-alert-dialog`
    - `@radix-ui/react-slot`
    - Note: adding more shadcn components may add additional `@radix-ui/*` packages.
- **Auth**: `next-auth@^4`, `siwe`, `@next-auth/dynamodb-adapter`, `@unlock-protocol/paywall`
- **Security**: CloudFront OAC
- **Scheduling**:
  - `luxon` for timezone-aware event formatting on the client
  - `ics` to generate downloadable calendar files on the fly
  - `@types/luxon` (dev) to satisfy TypeScript builds in Amplify and locally

## Node 22 Migration Checklist (Later)
- Update runtime: change `amplify.yml` to `runtime.nodejs: 22` and use `nvm install 22 && nvm use 22` in preBuild.
- Update local defaults: set `.nvmrc` to `22` and in `package.json` set `engines.node` to `"^22"` (or `">=22 <23"`).
- Verify deps on Node 22: run `npm i && npm run build` locally; watch for OpenSSL/crypto warnings.
- CloudFront signer: if Node 22/ OpenSSL rejects `RSA-SHA1` in `lib/cloudFrontSigner.ts`, switch to `@aws-sdk/cloudfront-signer` (SHA256) or update the signing logic accordingly.
- Amplify deploy: redeploy with Node 22 and confirm SSR/API routes, SIWE sign-in, Unlock checkout, and `/api/content/[file]` return signed URLs.
- Rollback plan: keep a branch with Node 20 configs to revert quickly if needed.

## License
All code in this workspace is licensed under either of

- Apache License, Version 2.0 (see `LICENSE-APACHE` or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license (see `LICENSE-MIT` or http://opensource.org/licenses/MIT)

at your option.

## Contribution
Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache‑2.0 license, shall be dual licensed as above, without any additional terms or conditions.
