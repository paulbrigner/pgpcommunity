import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { DynamoDBAdapter } from "@next-auth/dynamodb-adapter";
import { randomBytes } from "crypto";
// Nodemailer types are not installed; import with explicit any for runtime only.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import nodemailer from "nodemailer";
import {
  EMAIL_FROM,
  EMAIL_SERVER,
  EMAIL_SERVER_HOST,
  EMAIL_SERVER_PORT,
  EMAIL_SERVER_SECURE,
  EMAIL_SERVER_USER,
  EMAIL_SERVER_PASSWORD,
  NEXTAUTH_SECRET,
  NEXTAUTH_TABLE,
  NEXTAUTH_URL,
} from "@/lib/config";
import { documentClient } from "@/lib/dynamodb";

const EMAIL_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

const isValidEmail = (value: string) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value);
};

export async function POST(request: NextRequest) {
  try {
    const sessionToken = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
    if (!sessionToken?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { email } = await request.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const adapter: any = DynamoDBAdapter(documentClient as any, {
      tableName: NEXTAUTH_TABLE || "NextAuth",
    });

    // Prevent collisions with existing accounts
    const existing = await adapter.getUserByEmail(normalizedEmail);
    if (existing && existing.id !== sessionToken.sub) {
      return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
    }

    const identifier = `EMAIL_CHANGE#${sessionToken.sub}`;
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + EMAIL_TOKEN_TTL_MS);
    await adapter.createVerificationToken({
      identifier,
      token,
      expires,
      newEmail: normalizedEmail,
      userId: sessionToken.sub,
    });

    const baseUrl = NEXTAUTH_URL || request.nextUrl.origin;
    const confirmUrl = new URL("/api/profile/confirm-email-change", baseUrl);
    confirmUrl.searchParams.set("token", token);
    confirmUrl.searchParams.set("identifier", identifier);

    const transportConfig = buildEmailServerConfig();
    if (!transportConfig || !EMAIL_FROM) {
      return NextResponse.json({ error: "Email provider not configured" }, { status: 500 });
    }
    const transporter = nodemailer.createTransport(transportConfig);
    const html = `
      <p>You requested to change your email on PGP Community.</p>
      <p>Click the button below to confirm your new email. This link expires in 30 minutes.</p>
      <p><a href="${confirmUrl.toString()}" style="display:inline-block;padding:10px 16px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">Confirm email change</a></p>
      <p>If you didn't request this, you can ignore this email.</p>
    `;
    const text = `Confirm your email change: ${confirmUrl.toString()}\nThis link expires in 30 minutes. If you didn't request this, ignore the email.`;
    await transporter.sendMail({
      to: normalizedEmail,
      from: EMAIL_FROM,
      subject: "Confirm your email change",
      text,
      html,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("/api/profile/request-email-change error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
