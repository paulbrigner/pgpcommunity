# PGP Community Platform

## Overview
Community platform built with Next.js 15+, deployed on AWS Amplify. Auth is handled via NextAuth (email magic links) and SIWE for wallet sign-in/linking, with Unlock Protocol for membership gating. Gated content is served from CloudFront using server‑generated signed URLs (see `lib/cloudFrontSigner.ts`) with the signing key stored in AWS Secrets Manager.

## Features
- **Secure Content Delivery**:
  - Private files in S3 accessed via CloudFront signed URLs
  - **Origin Access Control (OAC)** restricts S3 bucket access to CloudFront only
  - Signed URL generation handled in‑app via `lib/cloudFrontSigner.ts` (no Lambda required)
  - Private key stored securely in AWS Secrets Manager
- **Authentication/Authorization**:
  - NextAuth (email magic links) + SIWE for wallet sign-in/linking
  - Unlock Protocol for membership gating
  - API route `/api/content/[file]` issues CloudFront signed URLs (see `app/api/content/[file]/route.ts`)
- **Secrets Management**:
  - AWS Secrets Manager stores sensitive credentials including:
    - CloudFront private key for signed URL generation
    - AWS CloudFront distribution configuration

## Setup
### Environment Variables (Amplify Gen 2)
In Amplify Hosting Gen 2, define client-safe variables under regular Environment Variables and server-only values as Secrets. The app reads them via Amplify’s virtual env modules with local fallbacks.

Public (client-safe)
```bash
NEXT_PUBLIC_LOCK_ADDRESS=...
NEXT_PUBLIC_UNLOCK_ADDRESS=...
NEXT_PUBLIC_BASE_NETWORK_ID=8453
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
NEXT_PUBLIC_CLOUDFRONT_DOMAIN=assets.pgpforcrypto.org
NEXT_PUBLIC_KEY_PAIR_ID=KERO2MLM81YXV
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN=arn:aws:secretsmanager:us-east-1:...:secret:pgpcommunity_pk-...
```

Server-only (Secrets)
```bash
# NextAuth
NEXTAUTH_URL=https://your-domain
NEXTAUTH_SECRET=your-long-random-secret
NEXTAUTH_TABLE=NextAuth

# Email provider (AWS SES)
# Option A: Discrete SMTP vars (recommended)
EMAIL_SERVER_HOST=email-smtp.us-east-1.amazonaws.com
EMAIL_SERVER_PORT=587
EMAIL_SERVER_USER=SMTP_USER
EMAIL_SERVER_PASSWORD=SMTP_PASS
EMAIL_SERVER_SECURE=false
EMAIL_FROM=PGP Community <no-reply@your-domain>

# Option B: Single SMTP URL (if preferred)
# EMAIL_SERVER=smtp://SMTP_USER:SMTP_PASS@email-smtp.us-east-1.amazonaws.com:587
```

Notes:
- Ensure the Amplify role has `secretsmanager:GetSecretValue` permission for the secret referenced by `NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN`.
- DynamoDB table for NextAuth is created/used by the adapter (name via `NEXTAUTH_TABLE`). Ensure the Amplify role has read/write access to it.

### Env Handling In Code
- Server code reads secrets/vars from `$amplify/env/server` with dev fallback to `process.env` in `lib/config.server.ts`.
- Client code reads public vars from `$amplify/env/client` with dev fallback to `process.env` in `lib/config.public.ts`.
- Do not mark server-only values as `NEXT_PUBLIC_*`.
- For local development, place values in `.env.local` (standard Next.js behavior).

### Authentication (NextAuth v4 + Email + SIWE)
- API route: `app/api/auth/[...nextauth]/route.ts` uses NextAuth v4 with:
  - Email provider (magic links) using SES SMTP via `EMAIL_SERVER`/`EMAIL_FROM`
  - Credentials provider to verify SIWE messages
  - DynamoDB adapter for User/Account/VerificationToken persistence
- Session fields: `session.user.id`, `session.user.email`, and `session.user.walletAddress`.
- Client helper: `lib/siwe/client.ts` exposes `signInWithSiwe()` to trigger SIWE sign-in.
- Email sign-in page: `app/(auth)/signin/page.tsx`.

Email-first UX and wallet linking
- Unlinked wallet sign-ins redirect to `/signin` with a helpful banner and `callbackUrl` back to where the user started.
- Authenticated users without a wallet see a “Link Wallet” action on the home page.
- Wallets are linked to the current user via `POST /api/auth/link-wallet` and shown as `session.user.wallets`.

Linking a wallet
- API route: `app/api/auth/link-wallet/route.ts` verifies a SIWE message and links the wallet to the currently signed-in user using the NextAuth adapter.
- Client helper: `linkWalletWithSiwe()` in `lib/siwe/client.ts` triggers the SIWE signature and POSTs to the link route.
- Conflict handling: returns HTTP 409 if the wallet address is already linked to a different account.

Unlinking a wallet
- API route: `app/api/auth/unlink-wallet/route.ts` removes a linked wallet for the current user.
- UI: See the Wallets section on `Settings → Profile` to unlink addresses.

Profile collection
- Sign-in page collects `firstName` (required), `lastName` (required), `xHandle` (optional), and `linkedinUrl` (optional) along with email.
- Client validation ensures required fields and basic URL format.
- The data is saved to the database after email verification via `POST /api/profile/update`.
- Session exposes `session.user.firstName`, `lastName`, `xHandle`, `linkedinUrl`, and the UI greets the user by first name.

Protecting API routes
- Use NextAuth’s JWT: in a route handler, import `getToken` from `next-auth/jwt` and require a valid token before serving content. Example in `app/api/content/[file]/route.ts`.

Config files
- Server-only: `lib/config.server.ts`
- Client-safe: `lib/config.public.ts`

## Deployment
### Step 5: Configure Origin Access Control (OAC)
1. **Create OAC Policy** in CloudFront console:
   ```bash
   aws cloudfront create-cloud-front-origin-access-control \
     --name pgpcommunity-oac \
     --type s3 --description "Restrict S3 access to CloudFront"
   ```
2. **Attach OAC to Distribution**:
   - In CloudFront console, update distribution settings to use the OAC policy

### Step 6: Configure AWS Secrets Manager
1. **Store CloudFront Private Key**:
   ```bash
   # Create secret with your private key (from openssl genrsa step)
   aws secretsmanager create-secret \
     --name cloudfront-private-key \
     --secret-string "$(cat private_key.pem)"
   ```

## Security Architecture
### CloudFront Signed URLs Workflow
1. **User Authentication**:
   - NextAuth (email) + SIWE handle user and wallet authentication
   - Unlock verifies membership (lock/NFT ownership)
2. **Server-Side Signing**:
   - API runs on Node.js runtime (`export const runtime = "nodejs"`)
   - Retrieves the private key from Secrets Manager
   - Generates a 5‑minute signed URL via `lib/cloudFrontSigner.ts`
   - Returns `{ url }` from `/api/content/[file]`
3. **CloudFront Validation**:
   - Validates signature using public key
   - Serves content only if OAC policy and signature are valid

### Key Security Components
| Component              | Description                                                                 |
|------------------------|-----------------------------------------------------------------------------|
| **AWS Secrets Manager** | Stores sensitive credentials including:                                    |
|                        | - CloudFront private key for signing URLs                                  |
| **Origin Access Control** | Restricts S3 bucket access to authorized CloudFront distributions only     |
| **cloudFrontSigner.ts** | Server-side TypeScript implementation for signed URL generation            |

## Architecture Notes
- **Unlock Integration**:
  - Wallet auth via NextAuth + SIWE (only for previously linked wallets)
  - Unlock checkout is opened client-side; after closing, the app refreshes membership status
- **CloudFront Distribution**:
  - Configured with Trusted Key Groups for signature validation
  - OAC ensures S3 only serves content via authenticated CloudFront requests

## Dependencies
- **Core**: Next.js 15+, TypeScript, AWS Amplify, Tailwind CSS v4 (CLI)
- **UI**: shadcn/ui (see `components.json`, `@/components/ui/*`)
- **Auth**: `next-auth@^4`, `siwe`, `@next-auth/dynamodb-adapter`, `@unlock-protocol/paywall`
- **AWS SDK**: `@aws-sdk/client-secrets-manager`
- **Security**: AWS Secrets Manager, CloudFront OAC
Notes:
- Amplify env access uses virtual modules `$amplify/env/server` and `$amplify/env/client`; no extra NPM dependency is required.

## Node 22 Migration Checklist (Later)
- Update runtime: change `amplify.yml` to `runtime.nodejs: 22` and use `nvm install 22 && nvm use 22` in preBuild.
- Update local defaults: set `.nvmrc` to `22` and in `package.json` set `engines.node` to `"^22"` (or `">=22 <23"`).
- Verify deps on Node 22: run `npm i && npm run build` locally; watch for OpenSSL/crypto warnings.
- CloudFront signer: if Node 22/ OpenSSL rejects `RSA-SHA1` in `lib/cloudFrontSigner.ts`, switch to `@aws-sdk/cloudfront-signer` (SHA256) or update the signing logic accordingly.
- Amplify deploy: redeploy with Node 22 and confirm SSR/API routes, SIWE sign-in, Unlock checkout, and `/api/content/[file]` return signed URLs.
- Rollback plan: keep a branch with Node 20 configs to revert quickly if needed.
