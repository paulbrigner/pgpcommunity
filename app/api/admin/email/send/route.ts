import { NextRequest, NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - nodemailer types not installed
import nodemailer from "nodemailer";
import { requireAdminSession } from "@/lib/admin/auth";
import { documentClient, TABLE_NAME } from "@/lib/dynamodb";
import {
  EMAIL_FROM,
  EMAIL_SERVER,
  EMAIL_SERVER_HOST,
  EMAIL_SERVER_PASSWORD,
  EMAIL_SERVER_PORT,
  EMAIL_SERVER_SECURE,
  EMAIL_SERVER_USER,
} from "@/lib/config";
import { recordEmailEvent } from "@/lib/admin/email-log";

export const dynamic = "force-dynamic";

type UserRecord = {
  id: string;
  email: string | null;
  walletAddress: string | null;
  wallets: string[];
  firstName: string | null;
  lastName: string | null;
};

const buildEmailServerConfig = () => {
  if (EMAIL_SERVER_HOST) {
    return {
      host: EMAIL_SERVER_HOST,
      port: EMAIL_SERVER_PORT ? Number(EMAIL_SERVER_PORT) : 587,
      secure: EMAIL_SERVER_SECURE === "true",
      auth:
        EMAIL_SERVER_USER && EMAIL_SERVER_PASSWORD
          ? { user: EMAIL_SERVER_USER, pass: EMAIL_SERVER_PASSWORD }
          : undefined,
    } as any;
  }
  if (EMAIL_SERVER && EMAIL_SERVER.includes("://")) {
    return EMAIL_SERVER as any;
  }
  if (EMAIL_SERVER) {
    return {
      host: EMAIL_SERVER,
      port: EMAIL_SERVER_PORT ? Number(EMAIL_SERVER_PORT) : 587,
      secure: EMAIL_SERVER_SECURE === "true",
      auth:
        EMAIL_SERVER_USER && EMAIL_SERVER_PASSWORD
          ? { user: EMAIL_SERVER_USER, pass: EMAIL_SERVER_PASSWORD }
          : undefined,
    } as any;
  }
  return null;
};

const coerceUser = (data: any): UserRecord | null => {
  if (!data?.id) return null;
  const wallets = Array.isArray(data.wallets)
    ? (data.wallets as any[]).map((w) => (typeof w === "string" ? w.toLowerCase() : "")).filter((w) => w.startsWith("0x"))
    : [];
  return {
    id: String(data.id),
    email: typeof data.email === "string" ? data.email : null,
    walletAddress: typeof data.walletAddress === "string" ? data.walletAddress.toLowerCase() : wallets[0] || null,
    wallets,
    firstName: typeof data.firstName === "string" ? data.firstName : null,
    lastName: typeof data.lastName === "string" ? data.lastName : null,
  };
};

async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const res = await documentClient.query({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "#gsi1pk = :pk AND #gsi1sk = :sk",
    ExpressionAttributeNames: { "#gsi1pk": "GSI1PK", "#gsi1sk": "GSI1SK" },
    ExpressionAttributeValues: { ":pk": `USER#${email}`, ":sk": `USER#${email}` },
    Limit: 1,
  });
  const item = res.Items?.[0];
  return coerceUser(item);
}

async function findUserByWallet(wallet: string): Promise<UserRecord | null> {
  const res = await documentClient.query({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "#gsi1pk = :pk AND #gsi1sk = :sk",
    ExpressionAttributeNames: { "#gsi1pk": "GSI1PK", "#gsi1sk": "GSI1SK" },
    ExpressionAttributeValues: { ":pk": "ACCOUNT#ethereum", ":sk": `ACCOUNT#${wallet}` },
    Limit: 1,
  });
  const account = res.Items?.[0];
  const userId = account?.userId as string | undefined;
  if (!userId) return null;
  const user = await documentClient.get({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
  });
  return coerceUser(user.Item);
}

async function findUserById(id: string): Promise<UserRecord | null> {
  const res = await documentClient.get({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${id}`, sk: `USER#${id}` },
  });
  return coerceUser(res.Item);
}

const stripHtml = (value: string) => value.replace(/<[^>]+>/g, " ");

function buildWelcomeEmail(user: UserRecord, to: string) {
  const name = user.firstName || user.lastName ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : to;
  const subject = "Welcome to PGP Community";
  const html = `
    <p>Hi ${name || "there"},</p>
    <p>Welcome to the PGP Community. Your membership is active and you can sign in any time to access community resources.</p>
    <p>If you have questions, reply to this email and we will help.</p>
    <p>Thanks,<br/>PGP Community Team</p>
  `;
  const text = stripHtml(html);
  return { subject, html, text };
}

type EmailType = "welcome" | "custom";

export async function POST(request: NextRequest) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const transportConfig = buildEmailServerConfig();
  if (!transportConfig || !EMAIL_FROM) {
    return NextResponse.json({ error: "Email provider not configured" }, { status: 500 });
  }

  let body: any = null;
  try {
    body = await request.json();
    const type: EmailType = body?.type === "custom" ? "custom" : "welcome";
    const normalizedEmail = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const normalizedWallet = typeof body?.wallet === "string" ? body.wallet.trim().toLowerCase() : "";
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";

    let user: UserRecord | null = null;
    if (userId) {
      user = await findUserById(userId);
    }
    if (!user && normalizedEmail) {
      user = await findUserByEmail(normalizedEmail);
    }
    if (!user && normalizedWallet) {
      user = await findUserByWallet(normalizedWallet);
    }

    const to = normalizedEmail || user?.email || "";
    if (!to) {
      return NextResponse.json({ error: "Target email is required" }, { status: 400 });
    }

    let subject: string | undefined;
    let html: string | undefined;
    let text: string | undefined;
    let markWelcome = false;

    if (type === "welcome") {
      const customSubject = typeof body?.subject === "string" ? body.subject.trim() : "";
      const customHtml = typeof body?.html === "string" ? body.html.trim() : "";
      const customText = typeof body?.text === "string" ? body.text.trim() : "";
      if (customSubject || customHtml || customText) {
        subject = customSubject || "Welcome to PGP Community";
        html = customHtml || undefined;
        text = customText || (html ? stripHtml(html) : undefined);
      } else {
        const built = buildWelcomeEmail(user || { id: "", email: to, walletAddress: null, wallets: [], firstName: null, lastName: null }, to);
        subject = built.subject;
        html = built.html;
        text = built.text;
      }
      markWelcome = true;
    } else {
      subject = typeof body?.subject === "string" ? body.subject.trim() : "";
      html = typeof body?.html === "string" ? body.html.trim() : "";
      text = typeof body?.text === "string" ? body.text.trim() : stripHtml(html || "");
      if (!subject || (!html && !text)) {
        return NextResponse.json({ error: "subject and html or text are required for custom emails" }, { status: 400 });
      }
    }

    const transporter = nodemailer.createTransport(transportConfig);
    const sendResult = await transporter.sendMail({
      to,
      from: EMAIL_FROM,
      subject,
      text: text || stripHtml(html || ""),
      html: html || undefined,
    });

    const sentAt = new Date().toISOString();
    await recordEmailEvent({
      userId: user?.id || null,
      email: to,
      wallet: user?.walletAddress || null,
      type,
      subject,
      status: "sent",
      providerMessageId: sendResult?.messageId ? String(sendResult.messageId) : null,
      markWelcome,
    });

    return NextResponse.json({
      ok: true,
      userId: user?.id || null,
      email: to,
      emailType: type,
      markWelcome,
      sentAt,
    });
  } catch (err: any) {
    const errorMessage = typeof err?.message === "string" ? err.message : "Failed to send email";
    try {
      const userId = typeof body?.userId === "string" ? body.userId : null;
      const email = typeof body?.email === "string" ? body.email : null;
      const wallet = typeof body?.wallet === "string" ? body.wallet : null;
      const type: EmailType = body?.type === "custom" ? "custom" : "welcome";
      const subject = typeof body?.subject === "string" ? body.subject : null;
      await recordEmailEvent({
        userId,
        email,
        wallet,
        type,
        subject,
        status: "failed",
        error: errorMessage,
      });
    } catch {
      // ignore secondary logging errors
    }
    console.error("Admin email send error:", err);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
