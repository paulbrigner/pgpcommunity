# Admin Roster Rebuild Lambda (SAM)

This SAM stack deploys a standalone Lambda that rebuilds the admin roster cache on a schedule and via an on-demand API.

## Deploy (one time)
```bash
sam build --template-file infra/admin-roster-rebuild/template.yaml
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

## Required parameters
- `NextAuthTable`: DynamoDB table for NextAuth users.
- `AdminRosterCacheTable`: DynamoDB table for the roster cache.
- `AdminRosterRebuildSecret`: shared secret used by the API trigger.
- `NextPublicLockTiers` (or `NextPublicLockAddress`): membership tiers JSON.
- `NextPublicBaseRpcUrl`: Base RPC endpoint.
- `NextPublicUsdcAddress`: USDC address on Base.
- `NextPublicUnlockSubgraphUrl` or (`UnlockSubgraphId` + `UnlockSubgraphApiKey`).

## Outputs
- `AdminRosterRebuildApiUrl`: set this as `ADMIN_ROSTER_REBUILD_URL` in Amplify.
