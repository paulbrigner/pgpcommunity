import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { Contract, Wallet, ZeroAddress, getAddress, isAddress } from "ethers";
import {
  BASE_NETWORK_ID,
  CHECKOUT_CONFIGS,
  MEMBERSHIP_REFERRER_ADDRESS,
  MEMBERSHIP_TIER_ADDRESSES,
  NEXTAUTH_SECRET,
  PRIMARY_LOCK_ADDRESS,
  UNLOCK_SUBGRAPH_API_KEY,
  UNLOCK_SUBGRAPH_ID,
  UNLOCK_SUBGRAPH_URL,
} from "@/lib/config";
import { getRpcProvider } from "@/lib/rpc/provider";
import { membershipStateService, snapshotToMembershipSummary } from "@/lib/membership-state-service";
import { recordSponsorAction } from "@/lib/sponsor/audit";
import { getEventSponsorConfig } from "@/lib/sponsor/config";
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
  "function burn(uint256 _tokenId)",
  "function setKeyExpiration(uint256 _tokenId, uint256 _newExpiration)",
  "function expirationDuration() view returns (uint256)",
  "function keyPrice() view returns (uint256)",
  "function tokenAddress() view returns (address)",
  "function owner() view returns (address)",
  "function isLockManager(address account) view returns (bool)",
  "function purchase(uint256[] _values, address[] _recipients, address[] _referrers, address[] _keyManagers, bytes[] _data) payable",
  "function purchase(uint256 _value, address _recipient, address _referrer, address _keyManager, bytes _data) payable",
] as const;

const GRAPH_GATEWAY_BASE = "https://gateway.thegraph.com/api/subgraphs/id";
const RESOLVED_SUBGRAPH_URL =
  UNLOCK_SUBGRAPH_URL ||
  (UNLOCK_SUBGRAPH_ID ? `${GRAPH_GATEWAY_BASE}/${UNLOCK_SUBGRAPH_ID}` : BASE_NETWORK_ID ? `https://subgraph.unlock-protocol.com/${BASE_NETWORK_ID}` : null);

const SUBGRAPH_AUTH_HEADERS = UNLOCK_SUBGRAPH_API_KEY
  ? { Authorization: `Bearer ${UNLOCK_SUBGRAPH_API_KEY}` }
  : undefined;

async function fetchSubgraph(body: string) {
  if (!RESOLVED_SUBGRAPH_URL) {
    throw new Error("Unlock subgraph URL not configured");
  }
  return fetch(RESOLVED_SUBGRAPH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SUBGRAPH_AUTH_HEADERS ?? {}),
    },
    body,
    cache: "no-store",
  });
}

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

type LockSubgraphInfo = {
  deployer: string | null;
  lockManagers: string[];
};

let cachedPrimaryDeployer: string | null = null;
let cachedPrimaryOwner: string | null = null;

async function getPrimaryLockDeployer(): Promise<string | null> {
  if (cachedPrimaryDeployer) return cachedPrimaryDeployer;
  if (!RESOLVED_SUBGRAPH_URL || !PRIMARY_LOCK_ADDRESS) return null;
  try {
    const body = JSON.stringify({
      query: `query LockDeployer($address: String!) {
        locks(first: 1, where: { address: $address }) {
          deployer
        }
      }`,
      variables: { address: PRIMARY_LOCK_ADDRESS.toLowerCase() },
    });
    const res = await fetchSubgraph(body);
    if (!res.ok) return null;
    const json = await res.json();
    const deployer = json?.data?.locks?.[0]?.deployer;
    if (typeof deployer === "string" && deployer.length) {
      cachedPrimaryDeployer = deployer.toLowerCase();
    }
  } catch {
    cachedPrimaryDeployer = null;
  }
  return cachedPrimaryDeployer;
}

async function getPrimaryLockOwner(provider: any): Promise<string | null> {
  if (cachedPrimaryOwner) return cachedPrimaryOwner;
  if (!PRIMARY_LOCK_ADDRESS) return null;
  try {
    const lock = new Contract(PRIMARY_LOCK_ADDRESS, ["function owner() view returns (address)"], provider);
    const owner: string = await lock.owner();
    cachedPrimaryOwner = owner ? owner.toLowerCase() : null;
  } catch {
    cachedPrimaryOwner = null;
  }
  return cachedPrimaryOwner;
}

async function fetchLockInfoFromSubgraph(lockAddressLower: string): Promise<LockSubgraphInfo | null> {
  if (!RESOLVED_SUBGRAPH_URL) return null;
  try {
    const body = JSON.stringify({
      query: `query LockInfo($address: String!) {
        locks(first: 1, where: { address: $address }) {
          deployer
          lockManagers
        }
      }`,
      variables: { address: lockAddressLower },
    });
    const res = await fetchSubgraph(body);
    if (!res.ok) return null;
    const json = await res.json();
    const lock = json?.data?.locks?.[0];
    if (!lock) return null;
    const deployer = typeof lock?.deployer === "string" && lock.deployer.length ? lock.deployer.toLowerCase() : null;
    const lockManagers = Array.isArray(lock?.lockManagers)
      ? lock.lockManagers.map((addr: any) => String(addr).toLowerCase()).filter(Boolean)
      : [];
    return { deployer, lockManagers };
  } catch {
    return null;
  }
}

async function isAllowedEventLock(lockAddressLower: string, provider: any): Promise<boolean> {
  if (MEMBERSHIP_TIER_ADDRESSES.has(lockAddressLower)) return false;

  const [primaryDeployer, primaryOwner] = await Promise.all([
    getPrimaryLockDeployer(),
    getPrimaryLockOwner(provider),
  ]);

  const subgraphInfo = await fetchLockInfoFromSubgraph(lockAddressLower);
  if (subgraphInfo) {
    if (primaryDeployer && subgraphInfo.deployer === primaryDeployer) return true;
    if (primaryOwner && subgraphInfo.lockManagers.includes(primaryOwner)) return true;
    return false;
  }

  if (primaryOwner) {
    try {
      const lock = new Contract(lockAddressLower, LOCK_ABI, provider);
      const [owner, manager] = await Promise.all([
        lock.owner().catch(() => null),
        lock.isLockManager(primaryOwner).catch(() => false),
      ]);
      if (typeof owner === "string" && owner.toLowerCase() === primaryOwner) return true;
      if (manager === true) return true;
    } catch {}
  }

  return Boolean(CHECKOUT_CONFIGS[lockAddressLower]);
}

const jsonError = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const sponsorConfig = getEventSponsorConfig();

  let userId: string | null = null;
  let userEmail: string | null = null;
  let recipientLower: string | null = null;
  let lockLower: string | null = null;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = request.headers.get("user-agent") || null;

  try {
    const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    userId = token?.sub ?? null;
    if (!userId) {
      return jsonError(401, { error: "Unauthorized", code: "UNAUTHORIZED" });
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
        action: "rsvp-event",
        status: "rejected",
        userId,
        email: userEmail,
        recipient: null,
        ip,
        userAgent,
        lockAddress: null,
        error: "Email not verified",
        metadata: { code: "EMAIL_NOT_VERIFIED" },
      }).catch(() => {});
      return jsonError(403, {
        error: "Verify your email before RSVP'ing for events.",
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
    const requestedLock = typeof body?.lockAddress === "string" ? body.lockAddress.trim() : "";
    if (!requestedLock || !isAddress(requestedLock)) {
      return jsonError(400, { error: "Invalid event lock address.", code: "INVALID_LOCK_ADDRESS" });
    }
    const lockChecksum = getAddress(requestedLock);
    lockLower = lockChecksum.toLowerCase();
    if (MEMBERSHIP_TIER_ADDRESSES.has(lockLower)) {
      return jsonError(400, { error: "Lock address is a membership tier.", code: "INVALID_EVENT_LOCK" });
    }

    const recipient = requestedRecipient.length ? requestedRecipient : addresses[0] || "";
    if (!recipient || !isAddress(recipient)) {
      return jsonError(400, { error: "Invalid recipient wallet address.", code: "INVALID_RECIPIENT" });
    }
    const recipientChecksum = getAddress(recipient);
    recipientLower = recipientChecksum.toLowerCase();
    if (!addresses.includes(recipientLower)) {
      return jsonError(403, { error: "Recipient must be one of your linked wallets.", code: "RECIPIENT_NOT_LINKED" });
    }

    const snapshot = await membershipStateService.getState({
      addresses,
      forceRefresh: true,
      includeAllowances: false,
      includeTokenIds: false,
    });
    const { summary } = snapshotToMembershipSummary(snapshot);
    if (summary.status !== "active") {
      await recordSponsorAction({
        action: "rsvp-event",
        status: "rejected",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: lockChecksum,
        error: "Active membership required",
        metadata: { code: "MEMBERSHIP_REQUIRED" },
      }).catch(() => {});
      return jsonError(403, { error: "Active membership required to RSVP for events.", code: "MEMBERSHIP_REQUIRED" });
    }

    if (!sponsorConfig.enabled) {
      await recordSponsorAction({
        action: "rsvp-event",
        status: "rejected",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: lockChecksum,
        error: "Sponsorship disabled",
        metadata: { code: "SPONSOR_DISABLED" },
      }).catch(() => {});
      return jsonError(503, { error: "Sponsored RSVPs are temporarily disabled.", code: "SPONSOR_DISABLED" });
    }

    if (!sponsorConfig.privateKey) {
      return jsonError(500, { error: "Sponsor wallet not configured.", code: "SPONSOR_NOT_CONFIGURED" });
    }

    const provider = getRpcProvider(sponsorConfig.rpcUrl, sponsorConfig.chainId);
    const sponsor = new Wallet(sponsorConfig.privateKey, provider);
    const sponsorAddress = sponsor.address.toLowerCase();

    if (!(await isAllowedEventLock(lockLower, provider))) {
      await recordSponsorAction({
        action: "rsvp-event",
        status: "rejected",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: lockChecksum,
        error: "Event lock is not eligible for sponsored RSVPs",
        metadata: { code: "EVENT_LOCK_NOT_ALLOWED" },
      }).catch(() => {});
      return jsonError(403, {
        error: "This event lock is not eligible for sponsored RSVPs.",
        code: "EVENT_LOCK_NOT_ALLOWED",
      });
    }

    if (sponsorConfig.minBalanceWei) {
      const balance = await provider.getBalance(sponsorAddress);
      if (balance < sponsorConfig.minBalanceWei) {
        await recordSponsorAction({
          action: "rsvp-event",
          status: "rejected",
          userId,
          email: userEmail,
          recipient: recipientLower,
          ip,
          userAgent,
          lockAddress: lockChecksum,
          error: "Sponsor wallet low balance",
          metadata: { code: "SPONSOR_LOW_BALANCE" },
        }).catch(() => {});
        return jsonError(503, { error: "Sponsored RSVPs are unavailable right now.", code: "SPONSOR_LOW_BALANCE" });
      }
    }

    const lockReader = new Contract(lockChecksum, LOCK_ABI, provider);
    const [hasValidKey, tokenAddress, keyPrice] = await Promise.all([
      lockReader.getHasValidKey(recipientChecksum).catch(() => false),
      lockReader.tokenAddress().catch(() => ZeroAddress),
      lockReader.keyPrice().catch(() => 0n),
    ]);
    if (hasValidKey) {
      await recordSponsorAction({
        action: "rsvp-event",
        status: "already-registered",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: lockChecksum,
        txHash: null,
        metadata: { sponsorAddress, chainId: sponsorConfig.chainId, code: "HAS_VALID_KEY" },
      }).catch(() => {});
      return NextResponse.json(
        { ok: true, status: "already-registered" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (tokenAddress && tokenAddress !== ZeroAddress) {
      await recordSponsorAction({
        action: "rsvp-event",
        status: "rejected",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: lockChecksum,
        error: "Event requires token payment",
        metadata: { code: "EVENT_NOT_FREE", tokenAddress, keyPrice: keyPrice?.toString?.() },
      }).catch(() => {});
      return jsonError(409, {
        error: "This event requires a token payment and cannot be sponsored.",
        code: "EVENT_NOT_FREE",
      });
    }

    if (typeof keyPrice === "bigint" && keyPrice > 0n) {
      await recordSponsorAction({
        action: "rsvp-event",
        status: "rejected",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: lockChecksum,
        error: "Event key price is non-zero",
        metadata: { code: "EVENT_NOT_FREE", keyPrice: keyPrice.toString() },
      }).catch(() => {});
      return jsonError(409, {
        error: "This event requires a paid checkout. Please RSVP with your wallet.",
        code: "EVENT_NOT_FREE",
      });
    }

    let lease: Awaited<ReturnType<typeof acquireNonceLease>> | null = null;
    try {
      lease = await acquireNonceLease({ chainId: sponsorConfig.chainId, sponsorAddress });
    } catch (err: any) {
      if (err instanceof NonceLeaseBusyError) {
        await recordSponsorAction({
          action: "rsvp-event",
          status: "rejected",
          userId,
          email: userEmail,
          recipient: recipientLower,
          ip,
          userAgent,
          lockAddress: lockChecksum,
          error: err.message,
          metadata: { code: "SPONSOR_BUSY", sponsorAddress, chainId: sponsorConfig.chainId },
        }).catch(() => {});
        return jsonError(429, { error: err.message, code: "SPONSOR_BUSY" });
      }
      throw err;
    }

    try {
      try {
        await reserveDailySponsorTxSlot({ chainId: sponsorConfig.chainId, sponsorAddress, maxTxPerDay: sponsorConfig.maxTxPerDay, scope: "event-rsvp" });
      } catch (err: any) {
        if (err instanceof SponsorRateLimitError) {
          await recordSponsorAction({
            action: "rsvp-event",
            status: "rejected",
            userId,
            email: userEmail,
            recipient: recipientLower,
            ip,
            userAgent,
            lockAddress: lockChecksum,
            error: err.message,
            metadata: { code: "SPONSOR_RATE_LIMIT", sponsorAddress, chainId: sponsorConfig.chainId },
          }).catch(() => {});
          await releaseNonceLease({
            chainId: sponsorConfig.chainId,
            sponsorAddress,
            leaseId: lease.leaseId,
          }).catch(() => {});
          return jsonError(429, {
            error: "Too many sponsored RSVPs today. Please try again later.",
            code: "SPONSOR_RATE_LIMIT",
          });
        }
        throw err;
      }

      const pendingNonce = await provider.getTransactionCount(sponsorAddress, "pending");
      const nonceToUse = Math.max(pendingNonce, lease.nextNonce ?? 0);
      const lockWriter = new Contract(lockChecksum, LOCK_ABI, sponsor);

      let tx: any;
      let operation: "purchase" | "reactivate" = "purchase";
      let tokenIdForAudit: string | null = null;

      try {
        const fn = lockWriter.getFunction("purchase(uint256[],address[],address[],address[],bytes[])");
        tx = await fn([0n], [recipientChecksum], [MEMBERSHIP_REFERRER_ADDRESS], [recipientChecksum], ["0x"], {
          nonce: nonceToUse,
        });
      } catch (_err: any) {
        let handled = false;

        if (isMaxKeysReachedError(_err)) {
          const totalKeys: bigint = await lockReader.totalKeys(recipientChecksum).catch(() => 0n);
          if (totalKeys > 0n) {
            const sponsorIsManager = await lockReader.isLockManager(sponsorAddress).catch(() => false);
            if (!sponsorIsManager) {
              await releaseNonceLease({
                chainId: sponsorConfig.chainId,
                sponsorAddress,
                leaseId: lease.leaseId,
              }).catch(() => {});
              await recordSponsorAction({
                action: "rsvp-event",
                status: "failed",
                userId,
                email: userEmail,
                recipient: recipientLower,
                ip,
                userAgent,
                lockAddress: lockChecksum,
                error: "Sponsor wallet is not a lock manager for event lock (required to reactivate a canceled key).",
                metadata: { code: "SPONSOR_NOT_MANAGER", sponsorAddress, chainId: sponsorConfig.chainId, nonce: nonceToUse },
              }).catch(() => {});
              return jsonError(500, {
                error: "Sponsor wallet must be a lock manager for this event lock to reactivate a canceled RSVP.",
                code: "SPONSOR_NOT_MANAGER",
                sponsorAddress,
                lockAddress: lockChecksum,
              });
            }

            const tokenId = await lockReader.tokenOfOwnerByIndex(recipientChecksum, 0n);
            const tokenIdValue = typeof tokenId === "bigint" ? tokenId : BigInt(tokenId);
            tokenIdForAudit = tokenIdValue.toString();

            const expirationDuration = await lockReader.expirationDuration().catch(() => null);
            let newExpiration: bigint = MAX_UINT256;
            if (typeof expirationDuration === "bigint" && expirationDuration > 0n && expirationDuration < MAX_UINT256) {
              const block = await provider.getBlock("latest").catch(() => null);
              const nowSec = block && typeof block.timestamp === "number"
                ? BigInt(block.timestamp)
                : BigInt(Math.floor(Date.now() / 1000));
              const maxDelta = MAX_UINT256 - nowSec;
              newExpiration = expirationDuration >= maxDelta ? MAX_UINT256 : nowSec + expirationDuration;
            }

            operation = "reactivate";
            const fn = lockWriter.getFunction("setKeyExpiration");
            tx = await fn(tokenIdValue, newExpiration, { nonce: nonceToUse });
            handled = true;
          } else {
            throw _err;
          }
        }

        if (!handled) {
          if (typeof _err?.data === "string" && _err.data.length > 2) {
            throw _err;
          }
          const fn = lockWriter.getFunction("purchase(uint256,address,address,address,bytes)");
          tx = await fn(0n, recipientChecksum, MEMBERSHIP_REFERRER_ADDRESS, recipientChecksum, "0x", {
            nonce: nonceToUse,
          });
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
        action: "rsvp-event",
        status: "submitted",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        txHash,
        lockAddress: lockChecksum,
        metadata: { sponsorAddress, chainId: sponsorConfig.chainId, nonce: nonceToUse, operation, tokenId: tokenIdForAudit },
      }).catch(() => {});

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
        action: "rsvp-event",
        status: "failed",
        userId,
        email: userEmail,
        recipient: recipientLower,
        ip,
        userAgent,
        lockAddress: lockChecksum,
        error: message,
        metadata: { sponsorAddress, chainId: sponsorConfig.chainId },
      }).catch(() => {});
      return jsonError(500, { error: message, code: "SPONSOR_TX_FAILED" });
    }
  } catch (err: any) {
    const message = err?.message || "Failed to RSVP for event.";
    await recordSponsorAction({
      action: "rsvp-event",
      status: "failed",
      userId,
      email: userEmail,
      recipient: recipientLower,
      ip,
      userAgent,
      lockAddress: lockLower,
      error: message,
    }).catch(() => {});
    return jsonError(500, { error: message, code: "UNKNOWN_ERROR" });
  }
}
