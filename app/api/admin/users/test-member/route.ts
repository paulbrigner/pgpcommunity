import { NextRequest, NextResponse } from "next/server";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import { requireAdminSession } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

type UserRecord = {
  id: string;
  email?: string | null;
  pk: string;
  sk: string;
};

async function findUserById(userId: string): Promise<UserRecord | null> {
  const res = await documentClient.get({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
  });
  const item = res.Item;
  if (!item?.id) return null;
  return {
    id: item.id as string,
    email: (item.email as string | undefined) || null,
    pk: item.pk as string,
    sk: item.sk as string,
  };
}

async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const res = await documentClient.query({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "#gsi1pk = :pk AND #gsi1sk = :sk",
    ExpressionAttributeNames: { "#gsi1pk": "GSI1PK", "#gsi1sk": "GSI1SK" },
    ExpressionAttributeValues: {
      ":pk": `USER#${email}`,
      ":sk": `USER#${email}`,
    },
    Limit: 1,
  });
  const item = res.Items?.[0];
  if (!item?.id) return null;
  return {
    id: item.id as string,
    email: (item.email as string | undefined) || null,
    pk: item.pk as string,
    sk: item.sk as string,
  };
}

async function findUserByWallet(wallet: string): Promise<UserRecord | null> {
  const res = await documentClient.query({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "#gsi1pk = :pk AND #gsi1sk = :sk",
    ExpressionAttributeNames: { "#gsi1pk": "GSI1PK", "#gsi1sk": "GSI1SK" },
    ExpressionAttributeValues: {
      ":pk": "ACCOUNT#ethereum",
      ":sk": `ACCOUNT#${wallet}`,
    },
    Limit: 1,
  });
  const account = res.Items?.[0];
  if (!account?.userId) return null;
  const userId = account.userId as string;
  const user = await documentClient.get({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
  });
  if (!user.Item?.id) return null;
  return {
    id: user.Item.id as string,
    email: (user.Item.email as string | undefined) || null,
    pk: user.Item.pk as string,
    sk: user.Item.sk as string,
  };
}

async function setTestMemberFlag(userId: string, isTestMember: boolean) {
  await documentClient.update({
    TableName: TABLE_NAME,
    Key: {
      pk: `USER#${userId}`,
      sk: `USER#${userId}`,
    },
    UpdateExpression: "SET isTestMember = :flag",
    ExpressionAttributeValues: {
      ":flag": isTestMember,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const emailRaw = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const walletRaw = typeof body?.wallet === "string" ? body.wallet.trim().toLowerCase() : "";
    const userIdRaw = typeof body?.userId === "string" ? body.userId.trim() : "";
    const makeTestMember = typeof body?.isTestMember === "boolean" ? body.isTestMember : true;

    if (!emailRaw && !walletRaw && !userIdRaw) {
      return NextResponse.json({ error: "Provide userId, email, or wallet" }, { status: 400 });
    }

    let user: UserRecord | null = null;
    if (userIdRaw) {
      user = await findUserById(userIdRaw);
    }
    if (!user && emailRaw) {
      user = await findUserByEmail(emailRaw);
    }
    if (!user && walletRaw) {
      user = await findUserByWallet(walletRaw);
    }

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await setTestMemberFlag(user.id, makeTestMember);

    return NextResponse.json({
      ok: true,
      userId: user.id,
      email: user.email || null,
      isTestMember: makeTestMember,
    });
  } catch (err) {
    console.error("Admin test member update error", err);
    return NextResponse.json({ error: "Failed to update test member flag" }, { status: 500 });
  }
}
