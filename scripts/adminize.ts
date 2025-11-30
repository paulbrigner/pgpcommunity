/**
 * Set or unset isAdmin for a user by email or wallet.
 * Usage:
 *   REGION_AWS=us-east-1 NEXTAUTH_TABLE=NextAuth ts-node scripts/adminize.ts user@example.com
 *   REGION_AWS=us-east-1 NEXTAUTH_TABLE=NextAuth ts-node scripts/adminize.ts 0xabc... --unset
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.REGION_AWS || process.env.AWS_REGION;
const TABLE = process.env.NEXTAUTH_TABLE || "NextAuth";

if (!REGION) {
  console.error("Set REGION_AWS (or AWS_REGION).");
  process.exit(1);
}

const client = DynamoDBDocument.from(new DynamoDBClient({ region: REGION }));

type UserRecord = { id: string; email?: string | null };

async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const res = await client.query({
    TableName: TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "#gsi1pk = :pk AND #gsi1sk = :sk",
    ExpressionAttributeNames: { "#gsi1pk": "GSI1PK", "#gsi1sk": "GSI1SK" },
    ExpressionAttributeValues: { ":pk": `USER#${email}`, ":sk": `USER#${email}` },
    Limit: 1,
  });
  const item = res.Items?.[0];
  if (!item?.id) return null;
  return { id: String(item.id), email: (item.email as string | undefined) || null };
}

async function findUserByWallet(wallet: string): Promise<UserRecord | null> {
  const res = await client.query({
    TableName: TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "#gsi1pk = :pk AND #gsi1sk = :sk",
    ExpressionAttributeNames: { "#gsi1pk": "GSI1PK", "#gsi1sk": "GSI1SK" },
    ExpressionAttributeValues: { ":pk": "ACCOUNT#ethereum", ":sk": `ACCOUNT#${wallet}` },
    Limit: 1,
  });
  const account = res.Items?.[0];
  const userId = account?.userId as string | undefined;
  if (!userId) return null;
  const user = await client.get({
    TableName: TABLE,
    Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
  });
  if (!user.Item?.id) return null;
  return { id: String(user.Item.id), email: (user.Item.email as string | undefined) || null };
}

async function setAdmin(userId: string, flag: boolean) {
  await client.update({
    TableName: TABLE,
    Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
    UpdateExpression: "SET isAdmin = :flag",
    ExpressionAttributeValues: { ":flag": flag },
  });
}

async function main() {
  const args = process.argv.slice(2);
  let email = "";
  let wallet = "";
  let flag = true;
  for (const arg of args) {
    if (arg === "--unset") flag = false;
    else if (arg.includes("@")) email = arg.trim().toLowerCase();
    else if (arg.startsWith("0x")) wallet = arg.trim().toLowerCase();
  }

  if (!email && !wallet) {
    console.error("Usage: ts-node scripts/adminize.ts <email|wallet> [--unset]");
    process.exit(1);
  }

  let user: UserRecord | null = null;
  if (email) {
    user = await findUserByEmail(email);
  }
  if (!user && wallet) {
    user = await findUserByWallet(wallet);
  }
  if (!user) {
    console.error("User not found.");
    process.exit(1);
  }

  await setAdmin(user.id, flag);
  console.log(`Updated isAdmin=${flag} for user ${user.id}${user.email ? ` (${user.email})` : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
