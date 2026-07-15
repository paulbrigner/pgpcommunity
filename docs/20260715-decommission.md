# PGP Community production decommission

The production `pgpcommunity` application was retired on July 15, 2026 after members were notified of the transition to PGPZ.

## Redirect retained

- `https://community.pgpforcrypto.org` is associated with the existing `pgpz-community` Amplify app (`d2xb9ethk5a24j`).
- The app has a permanent `301` domain redirect to `https://community.pgpz.org`.
- The `pgpforcrypto.org` domain association uses the shared wildcard ACM certificate and the `community` CNAME in the existing Route 53 hosted zone.
- Paths and query parameters are forwarded by the Amplify domain redirect.

## Legacy AWS resources removed

- Amplify app `d3t4iaihhh357` and its `main` branch.
- DynamoDB tables `NextAuth` and `AdminRosterCache`.
- CloudFormation stack `admin-roster-rebuild`, including its Lambda, API Gateway API, EventBridge schedule, and IAM role.
- Lambda `generateSignedUrl`, its public function URL, and legacy Lambda/Amplify log groups.
- The `assets.pgpforcrypto.org` DNS record and its legacy private-content CloudFront distribution.
- S3 bucket `pgpcommunity`, its origin access control, signing key group/public key, and Secrets Manager signing key.
- Legacy Amplify compute/secrets roles, their app-specific customer-managed IAM policies, and the roster SAM artifact prefix.

## Shared resources deliberately preserved

- The `pgpforcrypto.org` Route 53 hosted zone, wildcard ACM certificate, root website, and all SES/MX/DKIM/SPF/DMARC mail infrastructure.
- `ses-smtp-user.pgpcommunity`, because the PGPZ Community and Coalition still use the same SMTP credentials despite the legacy-looking name.
- The shared Amplify SSR logging role used by other production applications.
- DynamoDB tables `EventMetadata` and `EventCheckin`, which are owned by ZecTix.
- The four immutable Base membership locks and their sponsor/manager key. The contracts have no AWS cost and still hold funds; withdrawing balances or changing lock management is a separate on-chain operation.
- The ignored local `.env.local` file, which contains the backed-up sponsor/manager key. Never commit or disclose it.

## Historical repository status

The source remains available for audit and reference, but it no longer has a production Amplify app or backend data store. Deploying this repository again would require new infrastructure, new secrets, and an explicit review of the retained on-chain contracts.
