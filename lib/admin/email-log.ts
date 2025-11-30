import { randomUUID } from "crypto";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";

export type EmailLogStatus = "queued" | "sent" | "failed";

export interface EmailLogParams {
  userId?: string | null;
  email?: string | null;
  wallet?: string | null;
  type: string;
  subject?: string | null;
  status: EmailLogStatus;
  providerMessageId?: string | null;
  error?: string | null;
  markWelcome?: boolean;
  emailBounceReason?: string | null;
  emailSuppressed?: boolean | null;
  metadata?: Record<string, unknown>;
}

export async function recordEmailEvent(params: EmailLogParams) {
  const now = new Date().toISOString();
  const logId = randomUUID();
  const userId = params.userId || null;

  const pk = userId ? `EMAIL_LOG#USER#${userId}` : "EMAIL_LOG#UNKNOWN";
  const sk = `EMAIL_LOG#${now}#${logId}`;

  const item: Record<string, unknown> = {
    pk,
    sk,
    type: "EMAIL_LOG",
    logId,
    createdAt: now,
    status: params.status,
    emailType: params.type,
    subject: params.subject || null,
    userId,
    wallet: params.wallet || null,
    email: params.email || null,
    providerMessageId: params.providerMessageId || null,
    error: params.error || null,
    metadata: params.metadata || null,
  };

  // Sparse GSI entries for optional querying across all email logs by time.
  item["GSI1PK"] = "EMAIL_LOG";
  item["GSI1SK"] = `${now}#${logId}`;

  await documentClient.put({
    TableName: TABLE_NAME,
    Item: item,
  });

  if (userId) {
    const updateParts = ["lastEmailSentAt = :now", "lastEmailType = :type"];
    const values: Record<string, unknown> = {
      ":now": now,
      ":type": params.type,
    };

    if (params.markWelcome) {
      updateParts.push("welcomeEmailSentAt = if_not_exists(welcomeEmailSentAt, :now)");
    }
    if (typeof params.emailBounceReason === "string") {
      updateParts.push("emailBounceReason = :bounce");
      values[":bounce"] = params.emailBounceReason;
    }
    if (typeof params.emailSuppressed === "boolean") {
      updateParts.push("emailSuppressed = :suppressed");
      values[":suppressed"] = params.emailSuppressed;
    }

    await documentClient.update({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
      UpdateExpression: `SET ${updateParts.join(", ")}`,
      ExpressionAttributeValues: values,
    });
  }
}
