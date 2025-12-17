import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { Contract, Wallet, getAddress, isAddress } from "ethers";
import { BASE_NETWORK_ID, MEMBERSHIP_REFERRER_ADDRESS, MEMBERSHIP_TIERS, NEXTAUTH_SECRET } from "@/lib/config";
import { getRpcProvider } from "@/lib/rpc/provider";
import { membershipStateService } from "@/lib/membership-state-service";
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

export const runtime = "nodejs";

const LOCK_ABI = [
  "function getHasValidKey(address _owner) view returns (bool)",
  "function totalKeys(address _keyOwner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address _keyOwner, uint256 _index) view returns (uint256)",
  "function setKeyExpiration(uint256 _tokenId, uint256 _newExpiration)",
  "function isLockManager(address account) view returns (bool)",
  "function purchase(uint256[] _values, address[] _recipients, address[] _referrers, address[] _keyManagers, bytes[] _data) payable",
  "function purchase(uint256 _value, address _recipient, address _referrer, address _keyManager, bytes _data) payable",
] as const;

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const MAX_UINT256 = 2n ** 256n - 1n;

function isMaxKeysReachedError(err: any): boolean {
  const data =
    (typeof err?.data === "string" && err.data) ||
    (typeof err?.info?.error?.data === "string" && err.info.error.data) ||
    null;
  if (!data) return false;
  return data.toLowerCase().startsWith("0x17ed8646");
}

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
        action: "claim-member",
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
        error: "Verify your email before claiming the free membership.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const wallets: string[] = Array.isArray(user.wallets) ? user.wallets.map((w: any) => String(w).toLowerCase()) : [];
    const walletAddress: string | null = user.walletAddress ? String(user.walletAddress).toLowerCase() : null;
    const addresses = Array.from(new Set([walletAddress, ...wallets].filter(isNonEmptyString)));

    const body = await request.json().catch(() => ({} as any));
    const requestedRecipient = typeof body?.recipient === "string" ? body.recipient.trim() : "";
    const recipient = requestedRecipient.length ? requestedRecipient : addresses[0] || "";
    if (!recipient || !isAddress(recipient)) {
      return jsonError(400, { error: "Invalid recipient wallet address.", code: "INVALID_RECIPIENT" });
    }
    const recipientChecksum = getAddress(recipient);
    recipientLower = recipientChecksum.toLowerCase();

    if (addresses.length === 0) {
      return jsonError(400, { error: "No wallet linked.", code: "NO_WALLET" });
    }
    if (!addresses.includes(recipientLower)) {
      return jsonError(403, { error: "Recipient must be one of your linked wallets.", code: "RECIPIENT_NOT_LINKED" });
    }

    if (!sponsorConfig.enabled) {
      await recordSponsorAction({
        action: "claim-member",
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
      return jsonError(503, { error: "Sponsored claims are temporarily disabled.", code: "SPONSOR_DISABLED" });
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
          action: "claim-member",
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
        return jsonError(503, { error: "Sponsored claims are unavailable right now.", code: "SPONSOR_LOW_BALANCE" });
      }
    }

    const lockReader = new Contract(memberTier.checksumAddress, LOCK_ABI, provider);
    const alreadyMember: boolean = await lockReader.getHasValidKey(recipientChecksum);
    if (alreadyMember) {
      await recordSponsorAction({
        action: "claim-member",
        status: "already-member",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: memberTier.checksumAddress,
        txHash: null,
        metadata: { sponsorAddress, chainId: sponsorConfig.chainId },
      }).catch(() => {});
      membershipStateService.invalidate([recipientLower], BASE_NETWORK_ID);
      return NextResponse.json(
        { ok: true, status: "already-member" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    let existingTokenId: bigint | null = null;
    try {
      const totalKeys: bigint = await lockReader.totalKeys(recipientChecksum).catch(() => 0n);
      if (totalKeys > 0n) {
        const tokenId = await lockReader.tokenOfOwnerByIndex(recipientChecksum, 0n);
        existingTokenId = typeof tokenId === "bigint" ? tokenId : BigInt(tokenId);
      }
    } catch {
      existingTokenId = null;
    }

    if (existingTokenId != null) {
      const sponsorIsManager = await lockReader.isLockManager(sponsorAddress).catch(() => false);
      if (!sponsorIsManager) {
        await recordSponsorAction({
          action: "claim-member",
          status: "failed",
          userId,
          email: userEmail,
          recipient: recipientLower,
          ip,
          userAgent,
          lockAddress: memberTier.checksumAddress,
          error: "Sponsor wallet is not a lock manager for Member lock (required to reactivate an existing key)",
          metadata: { code: "SPONSOR_NOT_MANAGER", sponsorAddress, chainId: sponsorConfig.chainId, tokenId: existingTokenId.toString() },
        }).catch(() => {});
        return jsonError(500, {
          error: "Sponsor wallet must be a lock manager for the Member lock to reactivate an existing key.",
          code: "SPONSOR_NOT_MANAGER",
          sponsorAddress,
          lockAddress: memberTier.checksumAddress,
          hint: "Add this sponsorAddress as a Lock Manager for the Member lock in the Unlock dashboard (or via addLockManager).",
        });
      }
    }

    let lease: Awaited<ReturnType<typeof acquireNonceLease>> | null = null;
    try {
      lease = await acquireNonceLease({ chainId: sponsorConfig.chainId, sponsorAddress });
    } catch (err: any) {
      if (err instanceof NonceLeaseBusyError) {
        await recordSponsorAction({
          action: "claim-member",
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
            action: "claim-member",
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
          return jsonError(429, { error: "Too many sponsored claims today. Please try again later.", code: "SPONSOR_RATE_LIMIT" });
        }
        throw err;
      }

      const pendingNonce = await provider.getTransactionCount(sponsorAddress, "pending");
      const nonceToUse = Math.max(pendingNonce, lease.nextNonce ?? 0);
      const lockWriter = new Contract(memberTier.checksumAddress, LOCK_ABI, sponsor);

      let tx: any;
      let operation: "reactivate" | "purchase" = existingTokenId != null ? "reactivate" : "purchase";
      let tokenIdForAudit: string | null = existingTokenId != null ? existingTokenId.toString() : null;
      if (existingTokenId != null) {
        const fn = lockWriter.getFunction("setKeyExpiration");
        tx = await fn(existingTokenId, MAX_UINT256, { nonce: nonceToUse });
      } else {
        try {
          const fn = lockWriter.getFunction("purchase(uint256[],address[],address[],address[],bytes[])");
          tx = await fn([0n], [recipientChecksum], [MEMBERSHIP_REFERRER_ADDRESS], [recipientChecksum], ["0x"], {
            nonce: nonceToUse,
          });
        } catch (_err: any) {
          if (isMaxKeysReachedError(_err)) {
            const totalKeys: bigint = await lockReader.totalKeys(recipientChecksum).catch(() => 0n);
            if (totalKeys > 0n) {
              const tokenId = await lockReader.tokenOfOwnerByIndex(recipientChecksum, 0n);
              const tokenIdValue = typeof tokenId === "bigint" ? tokenId : BigInt(tokenId);
              operation = "reactivate";
              tokenIdForAudit = tokenIdValue.toString();
              const fn = lockWriter.getFunction("setKeyExpiration");
              tx = await fn(tokenIdValue, MAX_UINT256, { nonce: nonceToUse });
            } else {
              throw _err;
            }
          } else if (
            typeof _err?.data === "string" &&
            _err.data.length > 2
          ) {
            throw _err;
          } else {
            const fn = lockWriter.getFunction("purchase(uint256,address,address,address,bytes)");
            tx = await fn(0n, recipientChecksum, MEMBERSHIP_REFERRER_ADDRESS, recipientChecksum, "0x", {
              nonce: nonceToUse,
            });
          }
        }
      }

      const txHash = typeof tx?.hash === "string" ? tx.hash : null;
      if (!txHash) {
        throw new Error("Sponsor transaction did not return a tx hash.");
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
        action: "claim-member",
        status: "submitted",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        txHash,
        lockAddress: memberTier.checksumAddress,
        metadata: { sponsorAddress, chainId: sponsorConfig.chainId, nonce: nonceToUse, operation, tokenId: tokenIdForAudit },
      }).catch(() => {});

      membershipStateService.invalidate([recipientLower], BASE_NETWORK_ID);

      return NextResponse.json(
        { ok: true, status: "submitted", txHash },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (err: any) {
      const message = err?.message || "Sponsor transaction failed.";
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
        action: "claim-member",
        status: "failed",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: memberTier.checksumAddress,
        error: message,
        metadata: { sponsorAddress, chainId: sponsorConfig.chainId },
      }).catch(() => {});
      return jsonError(500, { error: message, code: "SPONSOR_TX_FAILED" });
    }
  } catch (err: any) {
    const message = err?.message || "Failed to claim membership.";
    await recordSponsorAction({
      action: "claim-member",
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
