#!/usr/bin/env node
/**
 * Backfill free "Member" keys to existing paid key owners.
 *
 * This script enumerates active key owners for the paid membership locks via the Unlock subgraph,
 * then uses the sponsor wallet to mint/reactivate the free Member key for each owner (idempotent).
 *
 * Usage (local):
 *   node scripts/backfill-member.mjs --dry-run
 *   node scripts/backfill-member.mjs --limit 25
 *
 * Options:
 *   --env-file <path>   Load env vars from a file (default: .env.local if present)
 *   --dry-run           Do not send transactions (still queries subgraph + checks Member lock)
 *   --limit <n>         Process at most N unique owners
 *   --page-size <n>     Subgraph page size (default: 1000)
 *   --delay-ms <n>      Delay between on-chain operations (default: 250)
 *   --no-audit          Skip DynamoDB audit records (console-only)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { Contract, JsonRpcProvider, Wallet, getAddress, isAddress } from "ethers";

const DEFAULT_MEMBERSHIP_REFERRER = "0x76ff49cc68710a0df27724d46698835d7c7af2f2";
const DEFAULT_TABLE = "NextAuth";
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_DELAY_MS = 250;
const MAX_UINT256 = 2n ** 256n - 1n;

const MEMBER_LOCK_ABI = [
  "function getHasValidKey(address _owner) view returns (bool)",
  "function totalKeys(address _keyOwner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address _keyOwner, uint256 _index) view returns (uint256)",
  "function setKeyExpiration(uint256 _tokenId, uint256 _newExpiration)",
  "function isLockManager(address account) view returns (bool)",
  "function purchase(uint256[] _values, address[] _recipients, address[] _referrers, address[] _keyManagers, bytes[] _data) payable",
  "function purchase(uint256 _value, address _recipient, address _referrer, address _keyManager, bytes _data) payable",
] ;

const parseBool = (value) => {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const parseIntSafe = (value) => {
  if (!value) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBigIntSafe = (value) => {
  if (!value) return null;
  try {
    const normalized = String(value).trim();
    if (!normalized) return null;
    return BigInt(normalized);
  } catch {
    return null;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadEnvFile(filepath) {
  const abs = path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(abs)) return false;
  const content = fs.readFileSync(abs, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    if (process.env[key] != null) continue;
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2) ||
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, "\n");
    process.env[key] = value;
  }
  return true;
}

function parseArgs(argv) {
  const args = {
    envFile: null,
    dryRun: false,
    limit: null,
    pageSize: DEFAULT_PAGE_SIZE,
    delayMs: DEFAULT_DELAY_MS,
    audit: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env-file") {
      args.envFile = argv[i + 1] || null;
      i++;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--limit") {
      args.limit = parseIntSafe(argv[i + 1]);
      i++;
    } else if (arg === "--page-size") {
      const value = parseIntSafe(argv[i + 1]);
      if (value) args.pageSize = value;
      i++;
    } else if (arg === "--delay-ms") {
      const value = parseIntSafe(argv[i + 1]);
      if (value != null) args.delayMs = value;
      i++;
    } else if (arg === "--no-audit") {
      args.audit = false;
    }
  }
  return args;
}

function parseLockTiers(raw) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry, index) => {
      const address = typeof entry?.address === "string" ? entry.address.trim() : "";
      if (!address) return null;
      const id =
        (typeof entry?.id === "string" && entry.id.trim().length ? entry.id.trim() : address).toLowerCase();
      const orderRaw = Number(entry?.order);
      const order = Number.isFinite(orderRaw) ? orderRaw : index;
      return {
        id,
        addressLower: address.toLowerCase(),
        checksumAddress: address,
        order,
        label: typeof entry?.label === "string" ? entry.label.trim() : null,
        renewable: typeof entry?.renewable === "boolean" ? entry.renewable : true,
        neverExpires: typeof entry?.neverExpires === "boolean" ? entry.neverExpires : false,
        gasSponsored: typeof entry?.gasSponsored === "boolean" ? entry.gasSponsored : false,
      };
    })
    .filter(Boolean);
}

function resolveMemberTier(tiers) {
  return (
    tiers.find((tier) => tier.id === "member") ||
    tiers.find((tier) => tier.gasSponsored && tier.renewable === false) ||
    tiers.find((tier) => tier.neverExpires && tier.renewable === false) ||
    null
  );
}

function resolvePaidTiers(tiers) {
  return tiers.filter((tier) => tier.renewable !== false && tier.neverExpires !== true);
}

function buildSubgraphEndpoint() {
  const direct = (process.env.NEXT_PUBLIC_UNLOCK_SUBGRAPH_URL || "").trim();
  if (direct) return direct;
  const apiKey = (process.env.UNLOCK_SUBGRAPH_API_KEY || "").trim();
  const id = (process.env.UNLOCK_SUBGRAPH_ID || "").trim();
  if (apiKey && id) {
    return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${id}`;
  }
  return null;
}

async function graphqlRequest(endpoint, query, variables) {
  const headers = { "content-type": "application/json" };
  const apiKey = (process.env.UNLOCK_SUBGRAPH_API_KEY || "").trim();
  if (apiKey) {
    headers["x-api-key"] = apiKey;
    headers["authorization"] = `Bearer ${apiKey}`;
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Subgraph request failed (${res.status})`);
  }
  if (body?.errors?.length) {
    const msg = body.errors.map((e) => e?.message).filter(Boolean).join("; ");
    throw new Error(msg || "Subgraph query failed");
  }
  return body?.data;
}

async function detectKeyExpirationField(endpoint) {
  try {
    const data = await graphqlRequest(
      endpoint,
      `query IntrospectKey { __type(name: "Key") { fields { name } } }`,
      {},
    );
    const fields = (data?.__type?.fields || []).map((f) => f?.name).filter(Boolean);
    const candidates = ["expiration", "expirationTimestamp", "expirationTs", "expirationDate"];
    for (const candidate of candidates) {
      if (fields.includes(candidate)) return candidate;
    }
  } catch {}
  return "expiration";
}

async function fetchActiveKeyOwnersPage({ endpoint, lockAddressLower, expirationField, nowSec, cursor, pageSize }) {
  const whereExpiration = `${expirationField}_gt`;
  const query = `
    query ActiveKeys($lock: String!, $now: BigInt!, $cursor: String!) {
      keys(
        first: ${pageSize},
        orderBy: id,
        orderDirection: asc,
        where: { lock: $lock, ${whereExpiration}: $now, id_gt: $cursor }
      ) {
        id
        owner
      }
    }
  `;
  const data = await graphqlRequest(endpoint, query, {
    lock: lockAddressLower,
    now: String(nowSec),
    cursor: cursor || "",
  });
  const rows = Array.isArray(data?.keys) ? data.keys : [];
  const owners = rows
    .map((row) => (typeof row?.owner === "string" ? row.owner.trim().toLowerCase() : ""))
    .filter(Boolean);
  const lastId = rows.length ? rows[rows.length - 1]?.id : null;
  const nextCursor = typeof lastId === "string" && lastId.length ? lastId : null;
  return { owners, nextCursor, fetched: rows.length };
}

const formatUtcDay = (nowMs) => {
  const now = new Date(nowMs);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

async function reserveDailySponsorTxSlot({
  client,
  tableName,
  chainId,
  sponsorAddressLower,
  maxTxPerDay,
  nowMs = Date.now(),
}) {
  const limit = typeof maxTxPerDay === "number" && Number.isFinite(maxTxPerDay) ? maxTxPerDay : null;
  if (!limit || limit <= 0) return null;

  const day = formatUtcDay(nowMs);
  const id = `SPONSOR_TX_DAY#${chainId}#${sponsorAddressLower}#${day}`;
  const updatedAt = new Date(nowMs).toISOString();
  try {
    const result = await client.update({
      TableName: tableName,
      Key: { pk: id, sk: id },
      ConditionExpression: "attribute_not_exists(txCount) OR txCount < :max",
      UpdateExpression:
        "SET #type = if_not_exists(#type, :type), chainId = :chainId, sponsorAddress = :sponsorAddress, day = :day, updatedAt = :updatedAt ADD txCount :one",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: {
        ":type": "SPONSOR_TX_DAY",
        ":chainId": chainId,
        ":sponsorAddress": sponsorAddressLower,
        ":day": day,
        ":updatedAt": updatedAt,
        ":one": 1,
        ":max": limit,
      },
      ReturnValues: "UPDATED_NEW",
    });

    const usedRaw = result?.Attributes?.txCount;
    const used = typeof usedRaw === "number" && Number.isFinite(usedRaw) ? usedRaw : Number(usedRaw);
    return { day, used: Number.isFinite(used) ? used : limit, max: limit };
  } catch (err) {
    const name = err?.name || err?.code;
    if (name === "ConditionalCheckFailedException") {
      const e = new Error("Sponsor rate limit reached for today.");
      e.name = "SponsorRateLimitError";
      throw e;
    }
    throw err;
  }
}

class NonceLeaseBusyError extends Error {
  constructor(message = "Sponsor wallet is busy. Please retry.") {
    super(message);
    this.name = "NonceLeaseBusyError";
  }
}

function buildNonceLockKey(chainId, sponsorAddressLower) {
  const id = `NONCE_LOCK#${chainId}#${sponsorAddressLower}`;
  return { pk: id, sk: id };
}

async function acquireNonceLease({
  client,
  tableName,
  chainId,
  sponsorAddressLower,
  leaseMs = 30_000,
  nowMs = Date.now(),
}) {
  const key = buildNonceLockKey(chainId, sponsorAddressLower);
  const leaseId = randomUUID();
  const leaseUntil = nowMs + leaseMs;
  const updatedAt = new Date(nowMs).toISOString();

  try {
    const result = await client.update({
      TableName: tableName,
      Key: key,
      ConditionExpression: "attribute_not_exists(leaseUntil) OR leaseUntil < :now",
      UpdateExpression:
        "SET #type = if_not_exists(#type, :type), chainId = :chainId, sponsorAddress = :sponsorAddress, leaseId = :leaseId, leaseUntil = :leaseUntil, updatedAt = :updatedAt",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: {
        ":type": "NONCE_LOCK",
        ":chainId": chainId,
        ":sponsorAddress": sponsorAddressLower,
        ":leaseId": leaseId,
        ":leaseUntil": leaseUntil,
        ":updatedAt": updatedAt,
        ":now": nowMs,
      },
      ReturnValues: "ALL_NEW",
    });

    const item = result?.Attributes || {};
    const nextNonce = typeof item?.nextNonce === "number" && Number.isFinite(item.nextNonce) ? item.nextNonce : null;
    return { leaseId, nextNonce };
  } catch (err) {
    const name = err?.name || err?.code;
    if (name === "ConditionalCheckFailedException") {
      throw new NonceLeaseBusyError();
    }
    throw err;
  }
}

async function recordNonceLockBroadcast({
  client,
  tableName,
  chainId,
  sponsorAddressLower,
  leaseId,
  nonceUsed,
  txHash,
  nextNonce,
  nowMs = Date.now(),
}) {
  const key = buildNonceLockKey(chainId, sponsorAddressLower);
  const updatedAt = new Date(nowMs).toISOString();
  await client.update({
    TableName: tableName,
    Key: key,
    ConditionExpression: "leaseId = :leaseId",
    UpdateExpression:
      "SET nextNonce = :nextNonce, lastNonce = :lastNonce, lastTxHash = :lastTxHash, lastError = :lastError, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":leaseId": leaseId,
      ":nextNonce": nextNonce,
      ":lastNonce": nonceUsed,
      ":lastTxHash": txHash,
      ":lastError": null,
      ":updatedAt": updatedAt,
    },
  });
}

async function recordNonceLockError({
  client,
  tableName,
  chainId,
  sponsorAddressLower,
  leaseId,
  error,
  nowMs = Date.now(),
}) {
  const key = buildNonceLockKey(chainId, sponsorAddressLower);
  const updatedAt = new Date(nowMs).toISOString();
  const trimmed = String(error || "").trim().slice(0, 1000) || "Unknown error";
  await client.update({
    TableName: tableName,
    Key: key,
    ConditionExpression: "leaseId = :leaseId",
    UpdateExpression: "SET lastError = :lastError, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":leaseId": leaseId,
      ":lastError": trimmed,
      ":updatedAt": updatedAt,
    },
  });
}

async function releaseNonceLease({
  client,
  tableName,
  chainId,
  sponsorAddressLower,
  leaseId,
  nowMs = Date.now(),
}) {
  const key = buildNonceLockKey(chainId, sponsorAddressLower);
  const updatedAt = new Date(nowMs).toISOString();
  await client.update({
    TableName: tableName,
    Key: key,
    ConditionExpression: "leaseId = :leaseId",
    UpdateExpression: "SET leaseUntil = :leaseUntil, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":leaseId": leaseId,
      ":leaseUntil": 0,
      ":updatedAt": updatedAt,
    },
  });
}

function buildSponsorActionItem(params) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const pk = `SPONSOR_ACTION#${id}`;
  const sk = `SPONSOR_ACTION#${id}`;
  const item = {
    pk,
    sk,
    type: "SPONSOR_ACTION",
    action: params.action,
    status: params.status,
    sponsorActionId: id,
    createdAt: now,
    updatedAt: now,
    userId: params.userId || null,
    email: params.email || null,
    recipient: params.recipient ? String(params.recipient).toLowerCase() : null,
    ip: params.ip || null,
    userAgent: params.userAgent || null,
    txHash: params.txHash || null,
    lockAddress: params.lockAddress || null,
    error: params.error || null,
    metadata: params.metadata || null,
    GSI1PK: "SPONSOR_ACTION",
    GSI1SK: `${now}#${id}`,
  };
  return { id, item };
}

function isMaxKeysReachedError(err) {
  const data =
    (typeof err?.data === "string" && err.data) ||
    (typeof err?.info?.error?.data === "string" && err.info.error.data) ||
    null;
  if (!data) return false;
  return data.toLowerCase().startsWith("0x17ed8646");
}

async function ensureMemberKeyForOwner({
  owner,
  memberLockReader,
  memberLockWriter,
  sponsorAddressLower,
  sponsorChainId,
  sponsorNonce,
  nonceLeaseClient,
  nonceLeaseTable,
  provider,
  dryRun,
  audit,
  auditClient,
  auditTable,
  referrer,
  sourceLockAddress,
  sourceTierId,
  beforeSendTx,
}) {
  const ownerChecksum = getAddress(owner);
  const ownerLower = ownerChecksum.toLowerCase();

  const alreadyMember = await memberLockReader.getHasValidKey(ownerChecksum).catch(() => false);
  if (alreadyMember) {
    if (audit) {
      const { item } = buildSponsorActionItem({
        action: "backfill-claim",
        status: "already-member",
        recipient: ownerLower,
        lockAddress: memberLockReader.target,
        metadata: { sponsorAddress: sponsorAddressLower, chainId: sponsorChainId, sourceLockAddress, sourceTierId },
      });
      await auditClient.put({ TableName: auditTable, Item: item }).catch(() => {});
    }
    return { status: "already-member", txHash: null, nonceUsed: null };
  }

  if (dryRun) {
    if (audit) {
      const { item } = buildSponsorActionItem({
        action: "backfill-claim",
        status: "attempted",
        recipient: ownerLower,
        lockAddress: memberLockReader.target,
        metadata: { sponsorAddress: sponsorAddressLower, chainId: sponsorChainId, dryRun: true, sourceLockAddress, sourceTierId },
      });
      await auditClient.put({ TableName: auditTable, Item: item }).catch(() => {});
    }
    return { status: "dry-run", txHash: null, nonceUsed: null };
  }

  if (typeof beforeSendTx === "function") {
    await beforeSendTx();
  }

  let existingTokenId = null;
  try {
    const totalKeys = await memberLockReader.totalKeys(ownerChecksum).catch(() => 0n);
    if (totalKeys > 0n) {
      const tokenId = await memberLockReader.tokenOfOwnerByIndex(ownerChecksum, 0n);
      existingTokenId = typeof tokenId === "bigint" ? tokenId : BigInt(tokenId);
    }
  } catch {
    existingTokenId = null;
  }

  const leaseClient = nonceLeaseClient || null;
  const leaseTable = nonceLeaseTable || null;
  const canUseLease = !!leaseClient && !!leaseTable && !!sponsorAddressLower;
  let leaseId = null;
  let nonceToUse = sponsorNonce;

  if (canUseLease) {
    let lease = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        lease = await acquireNonceLease({
          client: leaseClient,
          tableName: leaseTable,
          chainId: sponsorChainId,
          sponsorAddressLower,
        });
        break;
      } catch (err) {
        if (err instanceof NonceLeaseBusyError && attempt < 7) {
          await sleep(400 + attempt * 250);
          continue;
        }
        throw err;
      }
    }
    if (!lease) {
      throw new NonceLeaseBusyError();
    }
    leaseId = lease.leaseId;
    const pendingNonce = await provider.getTransactionCount(sponsorAddressLower, "pending");
    nonceToUse = Math.max(pendingNonce, lease.nextNonce ?? 0);
  } else if (typeof nonceToUse !== "number") {
    nonceToUse = await provider.getTransactionCount(sponsorAddressLower, "pending");
  }

  let tx;
  let operation = existingTokenId != null ? "reactivate" : "purchase";
  let tokenIdForAudit = existingTokenId != null ? existingTokenId.toString() : null;

  let txHash = null;
  try {
    if (existingTokenId != null) {
      const fn = memberLockWriter.getFunction("setKeyExpiration");
      tx = await fn(existingTokenId, MAX_UINT256, { nonce: nonceToUse });
    } else {
      try {
        const fn = memberLockWriter.getFunction("purchase(uint256[],address[],address[],address[],bytes[])");
        tx = await fn([0n], [ownerChecksum], [referrer], [ownerChecksum], ["0x"], { nonce: nonceToUse });
      } catch (err) {
        if (isMaxKeysReachedError(err)) {
          const totalKeys = await memberLockReader.totalKeys(ownerChecksum).catch(() => 0n);
          if (totalKeys > 0n) {
            const tokenId = await memberLockReader.tokenOfOwnerByIndex(ownerChecksum, 0n);
            const tokenIdValue = typeof tokenId === "bigint" ? tokenId : BigInt(tokenId);
            operation = "reactivate";
            tokenIdForAudit = tokenIdValue.toString();
            const fn = memberLockWriter.getFunction("setKeyExpiration");
            tx = await fn(tokenIdValue, MAX_UINT256, { nonce: nonceToUse });
          } else {
            throw err;
          }
        } else {
          const fn = memberLockWriter.getFunction("purchase(uint256,address,address,address,bytes)");
          tx = await fn(0n, ownerChecksum, referrer, ownerChecksum, "0x", { nonce: nonceToUse });
        }
      }
    }
    txHash = typeof tx?.hash === "string" ? tx.hash : null;
    if (!txHash) {
      throw new Error("Sponsor transaction did not return a tx hash.");
    }
  } catch (err) {
    if (leaseId && canUseLease) {
      const message = typeof err?.message === "string" ? err.message : String(err);
      await recordNonceLockError({
        client: leaseClient,
        tableName: leaseTable,
        chainId: sponsorChainId,
        sponsorAddressLower,
        leaseId,
        error: message,
      }).catch(() => {});
      await releaseNonceLease({
        client: leaseClient,
        tableName: leaseTable,
        chainId: sponsorChainId,
        sponsorAddressLower,
        leaseId,
      }).catch(() => {});
    }
    throw err;
  }

  if (leaseId && canUseLease) {
    await recordNonceLockBroadcast({
      client: leaseClient,
      tableName: leaseTable,
      chainId: sponsorChainId,
      sponsorAddressLower,
      leaseId,
      nonceUsed: nonceToUse,
      txHash,
      nextNonce: nonceToUse + 1,
    }).catch(() => {});
    await releaseNonceLease({
      client: leaseClient,
      tableName: leaseTable,
      chainId: sponsorChainId,
      sponsorAddressLower,
      leaseId,
    }).catch(() => {});
  }

  if (audit) {
    const { item } = buildSponsorActionItem({
      action: "backfill-claim",
      status: "submitted",
      recipient: ownerLower,
      txHash,
      lockAddress: memberLockReader.target,
      metadata: { sponsorAddress: sponsorAddressLower, chainId: sponsorChainId, nonce: nonceToUse, operation, tokenId: tokenIdForAudit, sourceLockAddress, sourceTierId },
    });
    await auditClient.put({ TableName: auditTable, Item: item }).catch(() => {});
  }

  return { status: "submitted", txHash, nonceUsed: nonceToUse };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const defaultEnvFile = fs.existsSync(path.resolve(process.cwd(), ".env.local")) ? ".env.local" : null;
  const envFile = args.envFile || defaultEnvFile;
  if (envFile) {
    loadEnvFile(envFile);
  }

  const tiers = parseLockTiers(process.env.NEXT_PUBLIC_LOCK_TIERS);
  const memberTier = resolveMemberTier(tiers);
  if (!memberTier) {
    console.error("Member tier not found. Ensure NEXT_PUBLIC_LOCK_TIERS includes the Member lock.");
    process.exit(1);
  }
  const paidTiers = resolvePaidTiers(tiers);
  if (!paidTiers.length) {
    console.error("No paid tiers found. Ensure NEXT_PUBLIC_LOCK_TIERS includes Holder/Staker/Builder tiers.");
    process.exit(1);
  }

  const sponsorEnabled = parseBool(process.env.MEMBER_SPONSORSHIP_ENABLED);
  const sponsorPrivateKey = (process.env.MEMBER_SPONSOR_PRIVATE_KEY || "").trim() || null;
  const sponsorMinBalanceWei = parseBigIntSafe(process.env.MEMBER_SPONSOR_MIN_BALANCE_WEI);
  const sponsorMaxTxPerDay = parseIntSafe(process.env.MEMBER_SPONSOR_MAX_TX_PER_DAY);
  if (!args.dryRun) {
    if (!sponsorEnabled) {
      console.error("Sponsorship is disabled (MEMBER_SPONSORSHIP_ENABLED=false). Enable it to run backfill.");
      process.exit(1);
    }
    if (!sponsorPrivateKey) {
      console.error("Missing MEMBER_SPONSOR_PRIVATE_KEY.");
      process.exit(1);
    }
  }

  const rpcUrl =
    (process.env.MEMBER_SPONSOR_RPC_URL || process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL || "").trim() ||
    "https://mainnet.base.org";
  const provider = new JsonRpcProvider(rpcUrl);

  const sponsorWallet = sponsorPrivateKey ? new Wallet(sponsorPrivateKey, provider) : null;
  const sponsorAddressLower = sponsorWallet ? sponsorWallet.address.toLowerCase() : null;
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  const referrer = (process.env.NEXT_PUBLIC_MEMBERSHIP_REFERRER || DEFAULT_MEMBERSHIP_REFERRER).trim();
  const subgraphEndpoint = buildSubgraphEndpoint();
  if (!subgraphEndpoint) {
    console.error("Missing Unlock subgraph configuration. Set NEXT_PUBLIC_UNLOCK_SUBGRAPH_URL or UNLOCK_SUBGRAPH_ID + UNLOCK_SUBGRAPH_API_KEY.");
    process.exit(1);
  }

  const expirationField = await detectKeyExpirationField(subgraphEndpoint);
  const nowSec = Math.floor(Date.now() / 1000);

  const region = process.env.REGION_AWS || process.env.AWS_REGION || null;
  const table = process.env.NEXTAUTH_TABLE || DEFAULT_TABLE;
  const dynamo = region ? DynamoDBDocument.from(new DynamoDBClient({ region })) : null;
  const auditEnabled = args.audit && !!dynamo;

  if (!auditEnabled && args.audit) {
    console.warn("Audit is enabled but REGION_AWS/AWS_REGION is not set; proceeding without DynamoDB audit records.");
  }
  if (!dynamo && typeof sponsorMaxTxPerDay === "number" && sponsorMaxTxPerDay > 0) {
    console.warn("MEMBER_SPONSOR_MAX_TX_PER_DAY is set, but DynamoDB is not configured; rate limiting will not be enforced.");
  }
  if (!args.dryRun && !dynamo) {
    console.warn("DynamoDB is not configured; nonce lease locking is disabled. Do not run this backfill concurrently with sponsored claim/cancel traffic.");
  }

  const memberLockReader = new Contract(memberTier.checksumAddress, MEMBER_LOCK_ABI, provider);
  const memberLockWriter = sponsorWallet ? new Contract(memberTier.checksumAddress, MEMBER_LOCK_ABI, sponsorWallet) : null;

  if (!args.dryRun && sponsorWallet) {
    const isManager = await memberLockReader.isLockManager(sponsorWallet.address).catch(() => false);
    if (!isManager) {
      console.error(
        `Sponsor wallet ${sponsorWallet.address} is not a lock manager on the Member lock (${memberTier.checksumAddress}).`,
      );
      console.error("Backfill can fail for addresses with an existing (canceled/expired) Member key. Add the sponsor as a lock manager, then retry.");
    }
  }

  let sponsorNonce = sponsorWallet ? await provider.getTransactionCount(sponsorWallet.address, "pending") : null;

  const seenOwners = new Set();
  const stats = {
    discovered: 0,
    unique: 0,
    processed: 0,
    alreadyMember: 0,
    submitted: 0,
    failed: 0,
    dryRunWouldSubmit: 0,
  };

  console.log(
    [
      "Backfill Member keys",
      `chainId=${chainId}`,
      `memberLock=${memberTier.checksumAddress}`,
      `paidLocks=${paidTiers.map((t) => t.checksumAddress).join(",")}`,
      `dryRun=${args.dryRun}`,
      `limit=${args.limit ?? "none"}`,
      `audit=${auditEnabled}`,
    ].join(" | "),
  );

  for (const paidTier of paidTiers) {
    let cursor = "";
    while (true) {
      const page = await fetchActiveKeyOwnersPage({
        endpoint: subgraphEndpoint,
        lockAddressLower: paidTier.addressLower,
        expirationField,
        nowSec,
        cursor,
        pageSize: args.pageSize,
      });
      if (!page.fetched) break;
      cursor = page.nextCursor || cursor;

      for (const ownerLower of page.owners) {
        stats.discovered += 1;
        if (!ownerLower || !isAddress(ownerLower)) continue;
        if (seenOwners.has(ownerLower)) continue;
        seenOwners.add(ownerLower);
        stats.unique += 1;

        if (typeof args.limit === "number" && args.limit > 0 && stats.processed >= args.limit) {
          console.log("Reached limit; stopping.");
          console.log(stats);
          return;
        }

        stats.processed += 1;
        try {
          const result = await ensureMemberKeyForOwner({
            owner: ownerLower,
            memberLockReader,
            memberLockWriter,
            sponsorAddressLower,
            sponsorChainId: chainId,
            sponsorNonce,
            nonceLeaseClient: dynamo,
            nonceLeaseTable: table,
            provider,
            dryRun: args.dryRun,
            audit: auditEnabled,
            auditClient: dynamo,
            auditTable: table,
            referrer,
            sourceLockAddress: paidTier.checksumAddress,
            sourceTierId: paidTier.id,
            beforeSendTx: async () => {
              if (sponsorWallet && sponsorMinBalanceWei != null) {
                const balance = await provider.getBalance(sponsorWallet.address);
                if (balance < sponsorMinBalanceWei) {
                  throw new Error("Sponsor wallet is below MEMBER_SPONSOR_MIN_BALANCE_WEI; stopping backfill.");
                }
              }
              if (dynamo && sponsorWallet && typeof sponsorMaxTxPerDay === "number" && sponsorMaxTxPerDay > 0) {
                await reserveDailySponsorTxSlot({
                  client: dynamo,
                  tableName: table,
                  chainId,
                  sponsorAddressLower: sponsorWallet.address.toLowerCase(),
                  maxTxPerDay: sponsorMaxTxPerDay,
                });
              }
            },
          });
          if (result.status === "already-member") {
            stats.alreadyMember += 1;
          } else if (result.status === "submitted") {
            stats.submitted += 1;
            sponsorNonce = typeof result.nonceUsed === "number" ? result.nonceUsed + 1 : sponsorNonce != null ? sponsorNonce + 1 : null;
          } else if (result.status === "dry-run") {
            stats.dryRunWouldSubmit += 1;
          }
          if (args.delayMs) {
            await sleep(args.delayMs);
          }
        } catch (err) {
          if (err?.name === "SponsorRateLimitError") {
            console.warn("Sponsor daily tx cap reached; stopping backfill for today.");
            console.log(stats);
            return;
          }
          stats.failed += 1;
          const message = typeof err?.message === "string" ? err.message : String(err);
          if (auditEnabled) {
            const { item } = buildSponsorActionItem({
              action: "backfill-claim",
              status: "failed",
              recipient: ownerLower,
              lockAddress: memberTier.checksumAddress,
              error: message,
              metadata: { sponsorAddress: sponsorAddressLower, chainId, sourceLockAddress: paidTier.checksumAddress, sourceTierId: paidTier.id },
            });
            await dynamo.put({ TableName: table, Item: item }).catch(() => {});
          }
          console.warn(`Backfill failed for ${ownerLower}: ${message}`);
          if (args.delayMs) {
            await sleep(args.delayMs);
          }
        }
      }
    }
  }

  console.log("Backfill complete.");
  console.log(stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
