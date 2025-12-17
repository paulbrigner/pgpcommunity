import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { Contract, Wallet, getAddress, isAddress } from "ethers";
import { BASE_NETWORK_ID, MEMBERSHIP_TIERS, NEXTAUTH_SECRET } from "@/lib/config";
import { getRpcProvider } from "@/lib/rpc/provider";
import { membershipStateService, snapshotToMembershipSummary } from "@/lib/membership-state-service";
import { recordSponsorAction } from "@/lib/sponsor/audit";
import { getMemberSponsorConfig } from "@/lib/sponsor/config";
import {
  acquireNonceLease,
  NonceLeaseBusyError,
  recordNonceLockBroadcast,
  recordNonceLockError,
  releaseNonceLease,
} from "@/lib/sponsor/nonce-lock";
import { reserveDailySponsorTxSlot, SponsorRateLimitError } from "@/lib/sponsor/rate-limit";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import { isLockManager } from "@/lib/admin/lock-manager";

export const runtime = "nodejs";

const LOCK_ABI = [
  "function getHasValidKey(address _owner) view returns (bool)",
  "function expireAndRefundFor(address _keyOwner, uint256 _amount)",
  "function expireAndRefundFor(uint256 _tokenId, uint256 _amount)",
  "function keyExpirationTimestampFor(address _owner) view returns (uint256)",
] as const;

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function resolveMemberTier() {
  const byId = MEMBERSHIP_TIERS.find((tier) => tier.id === "member");
  if (byId) return byId;
  const byFlag = MEMBERSHIP_TIERS.find((tier) => tier.gasSponsored && tier.renewable === false);
  return byFlag ?? null;
}

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const sponsorConfig = getMemberSponsorConfig();

  let userId: string | null = null;
  let userEmail: string | null = null;
  let recipientLower: string | null = null;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = request.headers.get("user-agent") || null;
  const memberTier = resolveMemberTier();

  try {
    const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    userId = token?.sub ?? null;
    if (!userId) {
      return jsonError(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    if (!memberTier) {
      return jsonError(500, { error: "Member tier is not configured.", code: "NO_MEMBER_TIER" });
    }

    const userRes = await documentClient.get({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
    });
    const user = (userRes.Item || {}) as any;
    userEmail = typeof user.email === "string" && user.email.length ? user.email : null;

    const emailVerified = Boolean(user?.emailVerified);
    if (!userEmail || !emailVerified) {
      await recordSponsorAction({
        action: "cancel-member",
        status: "rejected",
        userId,
        email: userEmail,
        recipient: null,
        ip,
        userAgent,
        lockAddress: memberTier.checksumAddress,
        error: "Email not verified",
        metadata: { code: "EMAIL_NOT_VERIFIED" },
      }).catch(() => {});
      return jsonError(403, {
        error: "Verify your email before canceling the free membership.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const wallets: string[] = Array.isArray(user.wallets) ? user.wallets.map((w: any) => String(w).toLowerCase()) : [];
    const walletAddress: string | null = user.walletAddress ? String(user.walletAddress).toLowerCase() : null;
    const addresses = Array.from(new Set([walletAddress, ...wallets].filter(isNonEmptyString)));
    if (addresses.length === 0) {
      return jsonError(400, { error: "No wallet linked.", code: "NO_WALLET" });
    }

    const body = await request.json().catch(() => ({} as any));
    const requestedRecipient = typeof body?.recipient === "string" ? body.recipient.trim() : "";
    const cancelAll = body?.cancelAll === true;
    const recipient = requestedRecipient.length ? requestedRecipient : addresses[0] || "";
    if (!recipient || !isAddress(recipient)) {
      return jsonError(400, { error: "Invalid recipient wallet address.", code: "INVALID_RECIPIENT" });
    }
    const recipientChecksum = getAddress(recipient);
    recipientLower = recipientChecksum.toLowerCase();
    if (!addresses.includes(recipientLower)) {
      return jsonError(403, { error: "Recipient must be one of your linked wallets.", code: "RECIPIENT_NOT_LINKED" });
    }

    if (!sponsorConfig.enabled) {
      await recordSponsorAction({
        action: "cancel-member",
        status: "rejected",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: memberTier.checksumAddress,
        error: "Sponsorship disabled",
        metadata: { code: "SPONSOR_DISABLED" },
      }).catch(() => {});
      return jsonError(503, { error: "Sponsored cancellations are temporarily disabled.", code: "SPONSOR_DISABLED" });
    }

    if (!sponsorConfig.privateKey) {
      return jsonError(500, { error: "Sponsor wallet not configured.", code: "SPONSOR_NOT_CONFIGURED" });
    }

    const provider = getRpcProvider(sponsorConfig.rpcUrl, sponsorConfig.chainId);
    const sponsor = new Wallet(sponsorConfig.privateKey, provider);
    const sponsorAddress = sponsor.address.toLowerCase();

    if (sponsorConfig.minBalanceWei) {
      const balance = await provider.getBalance(sponsorAddress);
      if (balance < sponsorConfig.minBalanceWei) {
        await recordSponsorAction({
          action: "cancel-member",
          status: "rejected",
          userId,
          email: userEmail,
          recipient: recipientLower,
          ip,
          userAgent,
          lockAddress: memberTier.checksumAddress,
          error: "Sponsor wallet low balance",
          metadata: { code: "SPONSOR_LOW_BALANCE" },
        }).catch(() => {});
        return jsonError(503, { error: "Sponsored cancellations are unavailable right now.", code: "SPONSOR_LOW_BALANCE" });
      }
    }

    const snapshot = await membershipStateService.getState({
      addresses,
      forceRefresh: true,
      includeAllowances: false,
      includeTokenIds: false,
    });
    const { summary } = snapshotToMembershipSummary(snapshot);
    const hasActivePaidTier = (summary?.tiers || []).some((tier) => {
      if (tier?.status !== "active") return false;
      if (tier?.tier?.checksumAddress?.toLowerCase() === memberTier.checksumAddress.toLowerCase()) return false;
      return tier?.tier?.renewable !== false && tier?.tier?.neverExpires !== true;
    });
    if (hasActivePaidTier && !cancelAll) {
      await recordSponsorAction({
        action: "cancel-member",
        status: "rejected",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: memberTier.checksumAddress,
        error: "Active paid membership prevents Member cancellation without cancelAll=true",
        metadata: { code: "ACTIVE_PAID_TIER" },
      }).catch(() => {});
      return jsonError(409, {
        error: "You have an active paid membership. Cancel it first, or choose the cancel-all option.",
        code: "ACTIVE_PAID_TIER",
      });
    }

    const lockReader = new Contract(memberTier.checksumAddress, LOCK_ABI, provider);
    const hasKey: boolean = await lockReader.getHasValidKey(recipientChecksum);
    if (!hasKey) {
      await recordSponsorAction({
        action: "cancel-member",
        status: "already-canceled",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: memberTier.checksumAddress,
        metadata: { sponsorAddress, chainId: sponsorConfig.chainId },
      }).catch(() => {});
      membershipStateService.invalidate([recipientLower], BASE_NETWORK_ID);
      return NextResponse.json(
        { ok: true, status: "already-canceled" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const sponsorIsManager = await isLockManager(memberTier.checksumAddress, sponsorAddress, sponsorConfig.rpcUrl, sponsorConfig.chainId);
    if (!sponsorIsManager) {
      await recordSponsorAction({
        action: "cancel-member",
        status: "failed",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: memberTier.checksumAddress,
        error: "Sponsor wallet is not a lock manager for Member lock",
        metadata: { code: "SPONSOR_NOT_MANAGER", sponsorAddress, chainId: sponsorConfig.chainId },
      }).catch(() => {});
      return jsonError(500, {
        error: "Sponsor wallet must be a lock manager for the Member lock to cancel keys.",
        code: "SPONSOR_NOT_MANAGER",
        sponsorAddress,
        lockAddress: memberTier.checksumAddress,
        hint: "Add this sponsorAddress as a Lock Manager for the Member lock in the Unlock dashboard (or via addLockManager).",
      });
    }

    let lease: Awaited<ReturnType<typeof acquireNonceLease>> | null = null;
    try {
      lease = await acquireNonceLease({ chainId: sponsorConfig.chainId, sponsorAddress });
    } catch (err: any) {
      if (err instanceof NonceLeaseBusyError) {
        await recordSponsorAction({
          action: "cancel-member",
          status: "rejected",
          userId,
          email: userEmail,
          recipient: recipientLower,
          ip,
          userAgent,
          lockAddress: memberTier.checksumAddress,
          error: err.message,
          metadata: { code: "SPONSOR_BUSY", sponsorAddress, chainId: sponsorConfig.chainId },
        }).catch(() => {});
        return jsonError(429, { error: err.message, code: "SPONSOR_BUSY" });
      }
      throw err;
    }

    try {
      try {
        await reserveDailySponsorTxSlot({
          chainId: sponsorConfig.chainId,
          sponsorAddress,
          maxTxPerDay: sponsorConfig.maxTxPerDay,
        });
      } catch (err: any) {
        if (err instanceof SponsorRateLimitError) {
          await recordSponsorAction({
            action: "cancel-member",
            status: "rejected",
            userId,
            email: userEmail,
            recipient: recipientLower,
            ip,
            userAgent,
            lockAddress: memberTier.checksumAddress,
            error: err.message,
            metadata: { code: "SPONSOR_RATE_LIMIT", sponsorAddress, chainId: sponsorConfig.chainId },
          }).catch(() => {});
          await releaseNonceLease({
            chainId: sponsorConfig.chainId,
            sponsorAddress,
            leaseId: lease.leaseId,
          }).catch(() => {});
          return jsonError(429, { error: "Too many sponsored actions today. Please try again later.", code: "SPONSOR_RATE_LIMIT" });
        }
        throw err;
      }

      const pendingNonce = await provider.getTransactionCount(sponsorAddress, "pending");
      const nonceToUse = Math.max(pendingNonce, lease.nextNonce ?? 0);
      const lockWriter = new Contract(memberTier.checksumAddress, LOCK_ABI, sponsor);

      let tx: any;
      try {
        const fn = lockWriter.getFunction("expireAndRefundFor(address,uint256)");
        tx = await fn(recipientChecksum, 0n, { nonce: nonceToUse });
      } catch (_err) {
        const tokenSnapshot = await membershipStateService.getState({
          addresses: [recipientLower],
          forceRefresh: true,
          includeAllowances: false,
          includeTokenIds: true,
        });
        const tokenTier = tokenSnapshot.tiers.find(
          (tier) => tier.tier.checksumAddress.toLowerCase() === memberTier.checksumAddress.toLowerCase(),
        );
        const tokenIdRaw = tokenTier?.tokenIds?.[0] ?? null;
        if (!tokenIdRaw) {
          throw new Error("Unable to locate Member tokenId for cancellation. Configure the Unlock subgraph for tokenId resolution.");
        }
        const tokenId = BigInt(tokenIdRaw);
        const fn = lockWriter.getFunction("expireAndRefundFor(uint256,uint256)");
        tx = await fn(tokenId, 0n, { nonce: nonceToUse });
      }

      const txHash = typeof tx?.hash === "string" ? tx.hash : null;
      if (!txHash) {
        throw new Error("Sponsor cancellation did not return a tx hash.");
      }

      await recordNonceLockBroadcast({
        chainId: sponsorConfig.chainId,
        sponsorAddress,
        leaseId: lease.leaseId,
        nonceUsed: nonceToUse,
        txHash,
        nextNonce: nonceToUse + 1,
      });

      await releaseNonceLease({
        chainId: sponsorConfig.chainId,
        sponsorAddress,
        leaseId: lease.leaseId,
      });

      await recordSponsorAction({
        action: "cancel-member",
        status: "submitted",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        txHash,
        lockAddress: memberTier.checksumAddress,
        metadata: { sponsorAddress, chainId: sponsorConfig.chainId, nonce: nonceToUse, cancelAll },
      }).catch(() => {});

      membershipStateService.invalidate([recipientLower], BASE_NETWORK_ID);

      return NextResponse.json(
        { ok: true, status: "submitted", txHash },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (err: any) {
      const message = err?.message || "Sponsored cancellation failed.";
      if (lease) {
        await recordNonceLockError({
          chainId: sponsorConfig.chainId,
          sponsorAddress,
          leaseId: lease.leaseId,
          error: message,
        }).catch(() => {});
        await releaseNonceLease({
          chainId: sponsorConfig.chainId,
          sponsorAddress,
          leaseId: lease.leaseId,
        }).catch(() => {});
      }
      await recordSponsorAction({
        action: "cancel-member",
        status: "failed",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: memberTier.checksumAddress,
        error: message,
        metadata: { sponsorAddress, chainId: sponsorConfig.chainId, cancelAll },
      }).catch(() => {});
      return jsonError(500, { error: message, code: "SPONSOR_TX_FAILED" });
    }
  } catch (err: any) {
    const message = err?.message || "Failed to cancel membership.";
    await recordSponsorAction({
      action: "cancel-member",
      status: "failed",
      userId,
      email: userEmail,
      recipient: recipientLower,
      ip,
      userAgent,
      lockAddress: memberTier?.checksumAddress ?? null,
      error: message,
    }).catch(() => {});
    return jsonError(500, { error: message, code: "UNKNOWN_ERROR" });
  }
}
