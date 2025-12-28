import { getAddress, isAddress } from "ethers";
import { EVENT_METADATA_TABLE } from "@/lib/config";
import { documentClient } from "@/lib/dynamodb";

export type EventMetadataStatus = "draft" | "published";

export type EventMetadataRecord = {
  lockAddress: string;
  status: EventMetadataStatus;
  titleOverride?: string | null;
  description?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string | null;
  location?: string | null;
  imageUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  publishedAt?: string | null;
};

const getTableName = () => {
  if (!EVENT_METADATA_TABLE) {
    throw new Error("EVENT_METADATA_TABLE is not configured.");
  }
  return EVENT_METADATA_TABLE;
};

export const normalizeLockAddress = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !isAddress(trimmed)) return null;
  return getAddress(trimmed).toLowerCase();
};

export const checksumLockAddress = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !isAddress(trimmed)) return null;
  return getAddress(trimmed);
};

export async function getEventMetadata(lockAddress: string): Promise<EventMetadataRecord | null> {
  const tableName = getTableName();
  const lockLower = normalizeLockAddress(lockAddress);
  if (!lockLower) return null;
  const res = await documentClient.get({
    TableName: tableName,
    Key: { lockAddress: lockLower },
  });
  return res.Item ? (res.Item as EventMetadataRecord) : null;
}

export async function listEventMetadata(): Promise<EventMetadataRecord[]> {
  const tableName = getTableName();
  const items: EventMetadataRecord[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const res = await documentClient.scan({
      TableName: tableName,
      ExclusiveStartKey: startKey,
    });
    if (Array.isArray(res.Items)) {
      items.push(...(res.Items as EventMetadataRecord[]));
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export async function putEventMetadata(record: EventMetadataRecord): Promise<void> {
  const tableName = getTableName();
  await documentClient.put({
    TableName: tableName,
    Item: record,
  });
}
