# PGP Community Platform

## Overview
Community platform built with Next.js 15+, deployed on AWS Amplify. Auth is handled via Privy and Unlock Protocol. Gated content is served from CloudFront using server‑generated signed URLs (see `lib/cloudFrontSigner.ts`) with the signing key stored in AWS Secrets Manager.

## Features
- **Secure Content Delivery**:
  - Private files in S3 accessed via CloudFront signed URLs
  - **Origin Access Control (OAC)** restricts S3 bucket access to CloudFront only
  - Signed URL generation handled in‑app via `lib/cloudFrontSigner.ts` (no Lambda required)
  - Private key stored securely in AWS Secrets Manager
- **Authentication/Authorization**:
  - Privy for login + wallet linking
  - Unlock Protocol for membership gating
  - API route at `/app/api/content/[file]/route.ts` issues CloudFront signed URLs
- **Secrets Management**:
  - AWS Secrets Manager stores sensitive credentials including:
    - CloudFront private key for signed URL generation
    - Privy API secret key
    - AWS CloudFront distribution configuration

## Setup
### Environment Variables
```bash
# Public (client + server)
NEXT_PUBLIC_PRIVY_APP_ID=...
NEXT_PUBLIC_LOCK_ADDRESS=...
NEXT_PUBLIC_UNLOCK_ADDRESS=...
NEXT_PUBLIC_BASE_NETWORK_ID=8453
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
NEXT_PUBLIC_CLOUDFRONT_DOMAIN=assets.pgpforcrypto.org
NEXT_PUBLIC_KEY_PAIR_ID=KERO2MLM81YXV
NEXT_PUBLIC_AWS_REGION=us-east-1

# Server-only (Amplify environment variables)
# Preferred:
PRIVATE_KEY_SECRET_ARN=arn:aws:secretsmanager:us-east-1:...:secret:pgpcommunity_pk-...
AWS_REGION=us-east-1
# Optional fallback (supported by code for compatibility):
NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN=arn:aws:secretsmanager:us-east-1:...:secret:pgpcommunity_pk-...
```

Notes:
- The API route reads `PRIVATE_KEY_SECRET_ARN` first and falls back to `NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN` for hosted envs where only NEXT_PUBLIC vars are available. Prefer server‑only vars in production.
- Ensure the Amplify role has `secretsmanager:GetSecretValue` for the secret.

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
2. **Store Privy API Secret**:
   ```bash
   # Create secret for Privy API access
   aws secretsmanager create-secret \
     --name privy-api-secret \
     --secret-string "{\"apiSecret\": \"your-privy-api-secret\"}"
   ```

## Security Architecture
### CloudFront Signed URLs Workflow
1. **User Authentication**: 
   - Privy/Unlock verifies wallet/NFT ownership
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
|                        | - Privy API secret key                                                     |
| **Origin Access Control** | Restricts S3 bucket access to authorized CloudFront distributions only     |
| **cloudFrontSigner.ts** | Server-side TypeScript implementation for signed URL generation            |

## Architecture Notes
- **OAC Configuration**:
  - Ensures S3 bucket only responds to CloudFront requests
  - Eliminates need for bucket policies targeting CloudFront IPs
- **Privy/Unlock Integration**:
  - Client uses Privy for authentication and wallet linking
  - Unlock checkout is opened client-side; after closing, the app refreshes membership status
- **CloudFront Distribution**:
  - Configured with Trusted Key Groups for signature validation
  - OAC ensures S3 only serves content via authenticated CloudFront requests

## Dependencies
- **Core**: Next.js 15+, TypeScript, AWS Amplify, Tailwind CSS v4 (CLI)
- **UI**: shadcn/ui (see `components.json`, `@/components/ui/*`)
- **Auth**: `@privy-io/react-auth`, `@unlock-protocol/paywall`
- **AWS SDK**: `@aws-sdk/client-secrets-manager`
- **Security**: AWS Secrets Manager, CloudFront OAC
