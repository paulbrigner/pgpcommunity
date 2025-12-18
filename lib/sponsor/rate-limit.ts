import { documentClient, TABLE_NAME } from "@/lib/dynamodb";

export class SponsorRateLimitError extends Error {
  constructor(message = "Sponsor rate limit reached. Please retry later.") {
    super(message);
    this.name = "SponsorRateLimitError";
  }
}

type DocumentClientLike = Pick<typeof documentClient, "update">;

const formatUtcDay = (nowMs: number): string => {
  const now = new Date(nowMs);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export async function reserveDailySponsorTxSlot({
  chainId,
  sponsorAddress,
  maxTxPerDay,
  scope,
  nowMs = Date.now(),
  client = documentClient,
  tableName = TABLE_NAME,
}: {
  chainId: number;
  sponsorAddress: string;
  maxTxPerDay: number | null | undefined;
  scope?: string | null | undefined;
  nowMs?: number;
  client?: DocumentClientLike;
  tableName?: string;
}): Promise<{ day: string; used: number; max: number } | null> {
  const limit = typeof maxTxPerDay === "number" && Number.isFinite(maxTxPerDay) ? maxTxPerDay : null;
  if (!limit || limit <= 0) return null;

  const sponsorAddressLower = sponsorAddress.toLowerCase();
  const scopeKey =
    typeof scope === "string" && scope.trim().length ? scope.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, "") : null;
  const day = formatUtcDay(nowMs);
  const id = scopeKey
    ? `SPONSOR_TX_DAY#${chainId}#${sponsorAddressLower}#${scopeKey}#${day}`
    : `SPONSOR_TX_DAY#${chainId}#${sponsorAddressLower}#${day}`;
  const updatedAt = new Date(nowMs).toISOString();

  try {
    const result = await client.update({
      TableName: tableName,
      Key: { pk: id, sk: id },
      ConditionExpression: "attribute_not_exists(txCount) OR txCount < :max",
      UpdateExpression:
        "SET #type = if_not_exists(#type, :type), chainId = :chainId, sponsorAddress = :sponsorAddress, day = :day, updatedAt = :updatedAt ADD txCount :one",
      ExpressionAttributeNames: {
        "#type": "type",
      },
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

    const usedRaw = (result as any)?.Attributes?.txCount;
    const used = typeof usedRaw === "number" && Number.isFinite(usedRaw) ? usedRaw : Number(usedRaw);
    return { day, used: Number.isFinite(used) ? used : limit, max: limit };
  } catch (err: any) {
    const name = err?.name || err?.code;
    if (name === "ConditionalCheckFailedException") {
      throw new SponsorRateLimitError();
    }
    throw err;
  }
}
