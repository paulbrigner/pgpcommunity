import { getAddress, isAddress } from "ethers";
import { documentClient } from "@/lib/dynamodb";

const ROSTER_CACHE_TABLE =
  (process.env.ADMIN_ROSTER_CACHE_TABLE as string | undefined) || "";

export type MembershipMetadataStatus = "draft" | "published";

export type MembershipMetadataRecord = {
  pk: string;
  sk: string;
  lockAddress: string;
  status: MembershipMetadataStatus;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  tierOrder: number;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string | null;
};

const getTableName = () => {
  if (!ROSTER_CACHE_TABLE) {
    throw new Error(
      "ADMIN_ROSTER_CACHE_TABLE is not configured (used for membership metadata).",
    );
  }
  return ROSTER_CACHE_TABLE;
};

export const normalizeLockAddress = (
  value: string | null | undefined,
): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !isAddress(trimmed)) return null;
  return getAddress(trimmed).toLowerCase();
};

export const checksumLockAddress = (
  value: string | null | undefined,
): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !isAddress(trimmed)) return null;
  return getAddress(trimmed);
};

const buildPk = (lockAddress: string) =>
  `MEMBERSHIP_META#${lockAddress.toLowerCase()}`;
const SK = "META";

export async function getMembershipMetadata(
  lockAddress: string,
): Promise<MembershipMetadataRecord | null> {
  const tableName = getTableName();
  const lockLower = normalizeLockAddress(lockAddress);
  if (!lockLower) return null;
  const res = await documentClient.get({
    TableName: tableName,
    Key: { pk: buildPk(lockLower), sk: SK },
  });
  return res.Item ? (res.Item as MembershipMetadataRecord) : null;
}

export async function listMembershipMetadata(): Promise<
  MembershipMetadataRecord[]
> {
  const tableName = getTableName();
  const items: MembershipMetadataRecord[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const res = await documentClient.scan({
      TableName: tableName,
      FilterExpression: "begins_with(pk, :prefix) AND sk = :sk",
      ExpressionAttributeValues: {
        ":prefix": "MEMBERSHIP_META#",
        ":sk": SK,
      },
      ExclusiveStartKey: startKey,
    });
    if (Array.isArray(res.Items)) {
      items.push(...(res.Items as MembershipMetadataRecord[]));
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export async function putMembershipMetadata(
  record: MembershipMetadataRecord,
): Promise<void> {
  const tableName = getTableName();
  await documentClient.put({ TableName: tableName, Item: record });
}
