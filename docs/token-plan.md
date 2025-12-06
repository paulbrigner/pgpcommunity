# $PGP Utility Token Plan (Base)

Goal: A non-investment, utility/rewards token earned for actions (membership renewal, referrals, event check-ins) and usable inside the PGP community (e.g., redeem for perks, access, or on-site utilities). No speculation/price promotion.

## 1) Token definition
- Chain: Base (low fees, aligned with existing membership flow).
- Type: ERC-20 utility token (soul-light: freely transferable, but positioned as non-financial). Consider pausable mint and capped supply for safety.
- Metadata: Name `$PGP`, symbol `PGP`, 18 decimals, capped max supply (e.g., 1B) to avoid runaway inflation; mintable only by a rewards distributor contract.
- Admin controls: pausable mint, role-based access (OWNER for upgrades/emergency pause, MINTER for distributor).

## 2) Launch approach
- Simple path: use OpenZeppelin ERC20 + AccessControl, deployed via a minimal script (e.g., Hardhat/Foundry) on Base.
- Alternative platforms that streamline deployment:
  - thirdweb: UI + SDK for ERC20 on Base with role management and claim conditions.
  - OpenZeppelin Defender + Contracts Wizard: generate ERC20 (mintable, capped), deploy via Hardhat, manage roles via Defender UI.
- Recommendation: Use OZ Contracts Wizard to generate mintable+capped ERC20, deploy via Hardhat on Base, manage roles via Defender.

## 3) Distribution mechanics (rewards)
- Distributor contract (or server-side signer) mints to users based on events:
  - Membership renewal: mint X PGP per renewal (X configurable).
  - Referrals: mint Y PGP to referrer when referred account activates membership.
  - Event check-in: mint Z PGP per verified check-in.
- To reduce on-chain calls per user action:
  - Use signed mint vouchers (EIP-712) redeemed by the user’s wallet OR
  - Use a distributor contract callable by a backend signer that executes periodic batch mints (e.g., weekly).
- Rate limits: enforce per-action caps (per wallet per period) to prevent abuse.

## 4) Integration points in the app
- Track balances via read-only calls (ethers/viem) and show in the profile/home dashboard.
- On actions (renewal/referral/check-in), queue a reward event server-side; periodically batch-mint or issue a signed claimable voucher.
- Provide a “Claim PGP” or “View balance” UX; optionally add on-chain “redeem” for perks (e.g., swap for merch coupon via backend).

## 5) Compliance & positioning
- No investment language; avoid suggesting appreciation or trading incentives.
- Avoid liquidity pools/DEX listings; focus on utility/redemption.
- Consider geofencing and ToS updates to clarify non-financial nature and eligibility.
- Consider per-country restrictions if distributing to users in regulated regions.

## 6) Security/safety
- Use a capped supply, pausable minting, and distinct MINTER role for distributor.
- Multi-sig (e.g., Safe) as OWNER for role changes/emergency pause.
- Optionally timelock major role changes.

## 7) Phased rollout
- Phase 1: Deploy ERC20 (mintable, capped) on Base; wire a distributor with MINTER role; add basic balance display in app; batch mint for renewals/referrals/check-ins.
- Phase 2: Add claimable vouchers (EIP-712) for self-serve claiming; add redemption hooks (e.g., coupons, gated content).
- Phase 3: Analytics and abuse monitoring; adjust emission rates; consider cross-app integrations.

## 8) Tooling & infra
- Contracts: OpenZeppelin ERC20 + AccessControl + capped; optional custom distributor with per-action rate limits.
- Deployment: Hardhat/Foundry script to Base; verify on BaseScan.
- Ops: OpenZeppelin Defender/Safe for role management; cron/queue for batch mints if using server-side distributor.

## Potential downsides/risks
- Regulatory ambiguity if perceived as a financial asset; mitigate with clear utility-only positioning and no trading encouragement.
- Abuse/farming of rewards; mitigate with rate limits, verification on referrals/check-ins, and MINTER controls.
- Added maintenance (contract updates, key management, monitoring).
