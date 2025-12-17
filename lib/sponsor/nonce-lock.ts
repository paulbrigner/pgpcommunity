import { randomUUID } from "crypto";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";

export class NonceLeaseBusyError extends Error {
  constructor(message = "Sponsor wallet is busy. Please retry.") {
    super(message);
    this.name = "NonceLeaseBusyError";
  }
}

type DocumentClientLike = Pick<typeof documentClient, "update">;

export type NonceLease = {
  key: { pk: string; sk: string };
  leaseId: string;
  leaseUntil: number;
  nextNonce: number | null;
};

export function buildNonceLockKey(chainId: number, sponsorAddressLower: string) {
  const id = `NONCE_LOCK#${chainId}#${sponsorAddressLower}`;
  return { pk: id, sk: id };
}

export async function acquireNonceLease({
  chainId,
  sponsorAddress,
  leaseMs = 30_000,
  nowMs = Date.now(),
  client = documentClient,
  tableName = TABLE_NAME,
}: {
  chainId: number;
  sponsorAddress: string;
  leaseMs?: number;
  nowMs?: number;
  client?: DocumentClientLike;
  tableName?: string;
}): Promise<NonceLease> {
  const sponsorAddressLower = sponsorAddress.toLowerCase();
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
      ExpressionAttributeNames: {
        "#type": "type",
      },
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

    const item: any = (result as any)?.Attributes || {};
    const nextNonce = typeof item?.nextNonce === "number" && Number.isFinite(item.nextNonce) ? item.nextNonce : null;
    return { key, leaseId, leaseUntil, nextNonce };
  } catch (err: any) {
    const name = err?.name || err?.code;
    if (name === "ConditionalCheckFailedException") {
      throw new NonceLeaseBusyError();
    }
    throw err;
  }
}

export async function recordNonceLockBroadcast({
  chainId,
  sponsorAddress,
  leaseId,
  nonceUsed,
  txHash,
  nextNonce,
  nowMs = Date.now(),
  client = documentClient,
  tableName = TABLE_NAME,
}: {
  chainId: number;
  sponsorAddress: string;
  leaseId: string;
  nonceUsed: number;
  txHash: string;
  nextNonce: number;
  nowMs?: number;
  client?: DocumentClientLike;
  tableName?: string;
}) {
  const sponsorAddressLower = sponsorAddress.toLowerCase();
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

export async function recordNonceLockError({
  chainId,
  sponsorAddress,
  leaseId,
  error,
  nowMs = Date.now(),
  client = documentClient,
  tableName = TABLE_NAME,
}: {
  chainId: number;
  sponsorAddress: string;
  leaseId: string;
  error: string;
  nowMs?: number;
  client?: DocumentClientLike;
  tableName?: string;
}) {
  const sponsorAddressLower = sponsorAddress.toLowerCase();
  const key = buildNonceLockKey(chainId, sponsorAddressLower);
  const updatedAt = new Date(nowMs).toISOString();
  const trimmed = error.trim().slice(0, 1000);

  await client.update({
    TableName: tableName,
    Key: key,
    ConditionExpression: "leaseId = :leaseId",
    UpdateExpression: "SET lastError = :lastError, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":leaseId": leaseId,
      ":lastError": trimmed || "Unknown error",
      ":updatedAt": updatedAt,
    },
  });
}

export async function releaseNonceLease({
  chainId,
  sponsorAddress,
  leaseId,
  nowMs = Date.now(),
  client = documentClient,
  tableName = TABLE_NAME,
}: {
  chainId: number;
  sponsorAddress: string;
  leaseId: string;
  nowMs?: number;
  client?: DocumentClientLike;
  tableName?: string;
}) {
  const sponsorAddressLower = sponsorAddress.toLowerCase();
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
