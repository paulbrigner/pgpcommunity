# Unlock Architecture (On-chain vs Off-chain)

## Summary
Unlock keeps the membership "source of truth" on-chain (keys/ownership, pricing, expirations, managers) but stores rich metadata and event presentation details off-chain. This split trades stronger immutability for lower gas costs, faster edits, and richer UX.

## Why Unlock Chose This Split
### Benefits
- Lower gas costs: rich descriptions, images, and event schedules are expensive to store on-chain.
- Faster updates: event details can change without contract upgrades or costly on-chain writes.
- Better UX: markdown/HTML, images, and layouts are easier to serve from a backend.
- Search and indexing: off-chain stores enable full-text search and fast queries.
- Cross-chain compatibility: same metadata can serve multiple chains/locks.
- Operational flexibility: approvals, email settings, and UI configuration can evolve without redeploying contracts.

### Tradeoffs
- Availability risk: off-chain services can be down or rate-limited.
- Data drift: metadata can diverge from on-chain state if not reconciled.
- Trust model: users must trust the backend to serve accurate descriptions.
- Censorship/immutability: content can be edited or removed off-chain.

## Where Data Lives
The lists below reflect what we observe in this app and the Unlock APIs we use.

### On-chain (Unlock Lock Contract)
- Lock address, owner, and lock managers.
- Key ownership and validity (who holds keys, expiration timestamps).
- Pricing and payment: key price and token address.
- Lock configuration: expiration duration, max keys.
- Lock name (string stored in the contract).

### Off-chain (Unlock Backend + Indexes)
#### Locksmith metadata (per lock)
- Display name (can differ from on-chain name).
- Short description.
- Images and layout settings.
- Slug and external URL for event pages.
- Event/ticket fields: start/end date/time, timezone, location/address, in-person flag.
- Attributes and other presentation fields.
- Email sender and approval requirements.

#### Locksmith metadata (per key / NFT)
- Token metadata and attributes.
- Event- or ticket-specific metadata and images.

#### Unlock App event page
- Long-form event description (rich/markdown content).
- SEO/meta description used by the event page.

#### Subgraph/indexes (derived, not authoritative)
- Indexed views of keys/locks used for faster queries.
- Token IDs and historical data derived from on-chain events.

## Implications for This App
- Membership and RSVP validity remain on-chain (trusted).
- Event details (schedule, location, rich description) are off-chain today.
- If we want to avoid off-chain dependency, we should store event metadata ourselves and treat Unlock as the key ownership source only.

## Privacy Considerations
### What Unlock May Store Off-chain
- Email addresses used for email-required checkouts, QR delivery, and approvals.
- Attendee details collected via event forms (if enabled in Unlock checkout).
- Metadata tied to specific locks/keys (ticket info, RSVPs, NFT metadata).
- Logs and operational data (timestamps, IPs, user agents) for abuse prevention and auditing.

### Tradeoffs
- Convenience vs control: Unlock handles hosted forms, emails, and event pages, but that means member data lives in their systems.
- Compliance burden: if you collect attendee data via Unlock, you share responsibility for privacy policies and data retention practices.
- Visibility: you may not control all downstream usage (analytics, operational logging).
- Trust model: relying on Unlock’s storage requires trust in their security posture and policies.

### Mitigations (if you want to minimize off-chain exposure)
- Avoid collecting attendee fields in Unlock checkout; use your own forms and storage.
- Keep email-required off of Unlock if you intend to manage membership comms yourself.
- Store event descriptions and details in your own database and render them in your app.
- Use your own RSVP flow and only rely on Unlock for on-chain key ownership.
