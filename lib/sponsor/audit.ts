import { randomUUID } from "crypto";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";

export type SponsorActionStatus =
  | "attempted"
  | "submitted"
  | "already-member"
  | "already-registered"
  | "already-canceled"
  | "rejected"
  | "failed";

export interface SponsorActionParams {
  action: string;
  status: SponsorActionStatus;
  userId?: string | null;
  email?: string | null;
  recipient?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  txHash?: string | null;
  lockAddress?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordSponsorAction(params: SponsorActionParams) {
  const now = new Date().toISOString();
  const id = randomUUID();

  const pk = `SPONSOR_ACTION#${id}`;
  const sk = `SPONSOR_ACTION#${id}`;

  const item: Record<string, unknown> = {
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
  };

  item["GSI1PK"] = "SPONSOR_ACTION";
  item["GSI1SK"] = `${now}#${id}`;

  await documentClient.put({
    TableName: TABLE_NAME,
    Item: item,
  });

  return id;
}
