import { getAddress, isAddress } from "ethers";
import { EVENT_CHECKIN_TABLE } from "@/lib/config";
import { documentClient } from "@/lib/dynamodb";

export type CheckInMethod = "qr" | "manual";

export type CheckInRecord = {
  pk: string;
  sk: string;
  checkedInAt: string;
  checkedInBy: string;
  method: CheckInMethod;
  notes?: string | null;
  ownerAddress: string;
  createdAt: string;
  updatedAt: string;
};

const getTableName = () => {
  if (!EVENT_CHECKIN_TABLE) {
    throw new Error("EVENT_CHECKIN_TABLE is not configured.");
  }
  return EVENT_CHECKIN_TABLE;
};

export const normalizeLockAddress = (
  value: string | null | undefined,
): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !isAddress(trimmed)) return null;
  return getAddress(trimmed).toLowerCase();
};

const buildPk = (lockAddress: string) =>
  `EVENT_CHECKIN#${lockAddress.toLowerCase()}`;
const buildSk = (tokenId: string) => `TOKEN#${tokenId}`;

export async function getCheckIn(
  lockAddress: string,
  tokenId: string,
): Promise<CheckInRecord | null> {
  const tableName = getTableName();
  const lockLower = normalizeLockAddress(lockAddress);
  if (!lockLower) return null;
  const res = await documentClient.get({
    TableName: tableName,
    Key: { pk: buildPk(lockLower), sk: buildSk(tokenId) },
  });
  return res.Item ? (res.Item as CheckInRecord) : null;
}

export async function getCheckInsByLock(
  lockAddress: string,
): Promise<CheckInRecord[]> {
  const tableName = getTableName();
  const lockLower = normalizeLockAddress(lockAddress);
  if (!lockLower) return [];
  const items: CheckInRecord[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const res = await documentClient.query({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": buildPk(lockLower) },
      ExclusiveStartKey: startKey,
    });
    if (Array.isArray(res.Items)) {
      items.push(...(res.Items as CheckInRecord[]));
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export async function putCheckIn(
  lockAddress: string,
  tokenId: string,
  data: {
    checkedInBy: string;
    method: CheckInMethod;
    notes?: string | null;
    ownerAddress: string;
  },
): Promise<CheckInRecord> {
  const tableName = getTableName();
  const lockLower = normalizeLockAddress(lockAddress);
  if (!lockLower) throw new Error("Invalid lock address.");
  const existing = await getCheckIn(lockLower, tokenId);
  const now = new Date().toISOString();
  const record: CheckInRecord = {
    pk: buildPk(lockLower),
    sk: buildSk(tokenId),
    checkedInAt: existing?.checkedInAt || now,
    checkedInBy: data.checkedInBy,
    method: data.method,
    notes: data.notes ?? null,
    ownerAddress: data.ownerAddress.toLowerCase(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await documentClient.put({ TableName: tableName, Item: record });
  return record;
}

export async function deleteCheckIn(
  lockAddress: string,
  tokenId: string,
): Promise<void> {
  const tableName = getTableName();
  const lockLower = normalizeLockAddress(lockAddress);
  if (!lockLower) return;
  await documentClient.delete({
    TableName: tableName,
    Key: { pk: buildPk(lockLower), sk: buildSk(tokenId) },
  });
}
