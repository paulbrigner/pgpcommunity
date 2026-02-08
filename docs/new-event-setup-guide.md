# New Event Setup Guide

This document covers the end-to-end process for creating a new event on the PGP Community platform. It explains each step, including the tokenURI configuration that ensures event metadata is served from your own infrastructure rather than Unlock Protocol's backend.

---

## Why Self-Hosted Metadata Matters

When a member RSVPs to an event, they receive an NFT (a "key") from the event's Unlock lock contract. Wallets, marketplaces, and apps display NFT details by calling `tokenURI(tokenId)` on the contract. By default, Unlock locks point this at **Unlock's Locksmith backend**, which means:

- **Unlock stores and serves your event metadata** (title, description, date, location, images). You don't control what is displayed or when it updates.
- **Member activity is exposed to a third party**. When a wallet or marketplace fetches metadata, the request goes to Unlock's servers, revealing which tokens are being viewed and by whom.
- **Availability depends on Unlock's infrastructure**. If Locksmith is down or rate-limited, event NFTs display broken or missing metadata.

By redirecting `tokenURI` to your own app (`/api/events/metadata/{lockAddress}/{tokenId}`), you gain:

- **Full control over event metadata**. Content is stored in your DynamoDB table (`EVENT_METADATA_TABLE`) and edited via the Admin Events UI. Changes take effect immediately without waiting on a third party.
- **Reduced third-party data exposure**. Metadata requests are served by your app. Unlock never sees which tokens are being queried or by which wallets/IPs.
- **Independent availability**. Your event metadata is served from your own infrastructure (AWS Amplify + DynamoDB), not dependent on Unlock's backend uptime.
- **Draft/publish control**. Unpublished events return a safe placeholder ("Details coming soon.") rather than exposing draft content.

This is the same principle behind the broader goal of reducing Locksmith dependencies across the platform.

---

## Prerequisites

Before creating an event, ensure you have:

- **Unlock Protocol access**: Ability to create locks on Base via the Unlock dashboard
- **Event sponsor wallet**: The private key for the wallet that sponsors gas for RSVPs (`EVENT_SPONSOR_PRIVATE_KEY`). This wallet must be added as a lock manager on each event lock.
- **Base RPC URL**: A working RPC endpoint (`BASE_RPC_URL` or `EVENT_SPONSOR_RPC_URL`)
- **Node.js**: For running the tokenURI setup script
- **Admin access**: An admin account on the PGP Community app for metadata management

---

## Step-by-Step Process

### 1. Create the Lock on Unlock Protocol

Go to the Unlock Protocol dashboard and create a new lock on Base (chain ID 8453).

Configuration:
- **Price**: Set to 0 (free) with token address = zero address for gas-sponsored RSVPs. If you want paid RSVPs, set the token to USDC and the desired price.
- **Duration**: Set based on the event (e.g., unlimited for a one-time event, or a specific duration).
- **Max keys**: Set the maximum number of attendees, or leave unlimited.

Note the deployed lock address. You will need it for the remaining steps.

### 2. Add the Sponsor Wallet as a Lock Manager

On the Unlock dashboard, navigate to the new lock's settings and add the event sponsor wallet address as a **Lock Manager**.

This is required for two reasons:
- The sponsor wallet needs lock manager permissions to execute gas-sponsored RSVP transactions on behalf of members.
- The `set-event-token-uri.mjs` script calls `setLockMetadata()`, which requires lock manager permissions.

To verify this was set correctly, you can check on-chain:
```
cast call <LOCK_ADDRESS> "isLockManager(address)(bool)" <SPONSOR_WALLET_ADDRESS> --rpc-url <RPC_URL>
```

### 3. Verify On-Chain Discovery

The app discovers event locks by checking whether they share a deployer or lock manager with the primary membership lock. Ensure at least one of these is true:

- The event lock was deployed by the **same wallet** that deployed the primary membership lock, OR
- The **primary lock owner** (the `owner()` of the first membership tier lock) is listed as a lock manager on the event lock

If neither condition is met, the app will not recognize the lock as a valid event and it will not appear in the UI. The discovery logic is in `lib/events/discovery.ts`.

### 4. Set the Token URI to Point to Your App

This is the step that redirects NFT metadata from Unlock's backend to your own.

Run the setup script:
```bash
EVENT_SPONSOR_PRIVATE_KEY=<your-sponsor-private-key> \
BASE_RPC_URL=<your-rpc-url> \
EVENT_METADATA_BASE_URL=https://pgpforcrypto.org \
  node scripts/setup/set-event-token-uri.mjs --lock <LOCK_ADDRESS>
```

**What this does**: The script calls `setLockMetadata(name, symbol, baseTokenURI)` on the lock contract. It preserves the existing lock name and symbol, but sets the base token URI to:

```
https://pgpforcrypto.org/api/events/metadata/<LOCK_ADDRESS>/
```

After this transaction confirms, when any wallet or marketplace calls `tokenURI(42)` on the lock, the contract returns:

```
https://pgpforcrypto.org/api/events/metadata/<LOCK_ADDRESS>/42
```

That URL is handled by your app's metadata endpoint (`app/api/events/metadata/[lockAddress]/[tokenId]/route.ts`), which:
1. Verifies the lock is a recognized event lock
2. Fetches metadata from your DynamoDB `EVENT_METADATA_TABLE`
3. Falls back to the on-chain lock name if no DB metadata exists
4. Returns standard NFT metadata JSON (name, description, image, attributes including event date/time/location)

**If the metadata is still in draft status**, the endpoint returns a placeholder description ("Details coming soon.") and omits date/location details, so unpublished events don't leak information.

**Environment variables used by the script**:
| Variable | Source | Required |
|----------|--------|----------|
| `EVENT_SPONSOR_PRIVATE_KEY` | `.env` or inline | Yes |
| `BASE_RPC_URL` (or `EVENT_SPONSOR_RPC_URL`, or `NEXT_PUBLIC_BASE_RPC_URL`) | `.env` or inline | Yes |
| `EVENT_METADATA_BASE_URL` | `.env` or inline | Yes |

### 5. Add and Publish Metadata in the Admin UI

1. Log in to the app as an admin
2. Navigate to **Admin > Events**
3. The new event lock should appear (discovered on-chain from Step 3)
4. Click to edit and fill in the metadata:
   - **Title** (overrides the on-chain lock name for display)
   - **Description**
   - **Date**, **Start Time**, **End Time**, **Timezone**
   - **Location**
   - **Image URL** (optional; supports IPFS URIs which are converted to Cloudflare IPFS gateway URLs)
5. Set the status to **Published**

Until you publish, the metadata endpoint returns placeholder content. After publishing, the full event details are served to any caller of `tokenURI`.

### 6. Verify the Event

Confirm everything is wired correctly:

- [ ] The event appears on the home page (in the events section)
- [ ] `/events/<LOCK_ADDRESS>` loads the event details page
- [ ] Event metadata displays correctly (title, date, time, location)
- [ ] Test an RSVP (gas-sponsored if `EVENT_SPONSORSHIP_ENABLED=true`)
- [ ] After RSVP, the event NFT appears in the member's collection with correct metadata
- [ ] Check the tokenURI on-chain returns your app's URL:
  ```bash
  cast call <LOCK_ADDRESS> "tokenURI(uint256)(string)" 1 --rpc-url <RPC_URL>
  ```
  Should return: `https://pgpforcrypto.org/api/events/metadata/<LOCK_ADDRESS>/1`
- [ ] Fetching that URL returns valid JSON with the published event details

### 7. Test Check-In (Current Workflow)

The current check-in system still uses Unlock's Locksmith API. Until the local check-in migration is complete (see `docs/20260204-claude-next-steps.md`, Phases 1-2), verify:

- [ ] Check-in QR code can be retrieved for a registered attendee
- [ ] Check-in status returns correctly

Once the local check-in system is deployed, this step will use the new DynamoDB-backed endpoints instead.

---

## Quick Reference

For experienced operators, here is the condensed checklist:

```
1. Create lock on Unlock dashboard (Base, free/paid, set max keys)
2. Add sponsor wallet as Lock Manager on the new lock
3. Verify discovery (same deployer or primary owner is lock manager)
4. Set tokenURI:
   EVENT_SPONSOR_PRIVATE_KEY=... BASE_RPC_URL=... EVENT_METADATA_BASE_URL=https://pgpforcrypto.org \
     node scripts/setup/set-event-token-uri.mjs --lock <LOCK_ADDRESS>
5. Admin > Events > Edit metadata > Publish
6. Verify: home page, event page, RSVP, NFT metadata
```

---

## Troubleshooting

**Event doesn't appear in the app**
- Check that the lock is discoverable (Step 3). The deployer or primary lock owner must be associated with the event lock.
- The event lock cache in `discovery.ts` has a 5-minute TTL. Wait and refresh.
- Verify the lock address is not in the `NEXT_PUBLIC_LOCK_TIERS` list (membership tier locks are filtered out).

**tokenURI still points to Unlock**
- The `set-event-token-uri.mjs` script requires the signer to be a lock manager. Verify with `isLockManager()`.
- Confirm the transaction was confirmed on-chain (check the tx hash on Basescan).
- Some NFT indexers cache tokenURI results. The on-chain value updates immediately, but third-party caches may take time to refresh.

**Metadata shows "Details coming soon."**
- The event metadata is still in draft status. Go to Admin > Events and set the status to Published.

**Sponsor wallet transaction fails**
- Check the sponsor wallet has sufficient ETH for gas on Base.
- Verify `EVENT_SPONSOR_PRIVATE_KEY` and `BASE_RPC_URL` are set correctly.
- Ensure the sponsor wallet is a lock manager on the target lock.

**RSVP fails with "SPONSOR_NOT_MANAGER"**
- The sponsor wallet is not a lock manager on the event lock. Add it via the Unlock dashboard (Step 2).
