import { NextRequest, NextResponse } from "next/server";
import { DynamoDBAdapter } from "@next-auth/dynamodb-adapter";
import { NEXTAUTH_TABLE } from "@/lib/config";
import { documentClient } from "@/lib/dynamodb";

const renderHtml = (title: string, message: string) =>
  new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:Arial,sans-serif;padding:24px;max-width:640px;margin:0 auto;"><h2>${title}</h2><p>${message}</p><p><a href="/signin?reason=email-updated">Return to sign in</a></p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

const isExpired = (expires: any) => {
  if (!expires) return false;
  const date = expires instanceof Date ? expires : new Date(expires);
  return Number.isFinite(date.getTime()) && date.getTime() < Date.now();
};

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const token = search.get("token");
  const identifier = search.get("identifier");
  if (!token || !identifier) {
    return renderHtml("Email change failed", "Missing or invalid token.");
  }

  const adapter: any = DynamoDBAdapter(documentClient as any, {
    tableName: NEXTAUTH_TABLE || "NextAuth",
  });

  try {
    const record = await adapter.useVerificationToken({ identifier, token });
    if (!record) {
      return renderHtml("Email change failed", "This link is invalid or has already been used.");
    }
    if (isExpired((record as any).expires)) {
      return renderHtml("Email change failed", "This link has expired. Please request a new one.");
    }

    const rawNewEmail = (record as any).newEmail;
    const userId = identifier.startsWith("EMAIL_CHANGE#") ? identifier.replace("EMAIL_CHANGE#", "") : null;
    if (!userId || !rawNewEmail || typeof rawNewEmail !== "string") {
      return renderHtml("Email change failed", "Invalid token payload.");
    }
    const newEmail = rawNewEmail.trim().toLowerCase();

    const user = await adapter.getUser(userId);
    if (!user?.id) {
      return renderHtml("Email change failed", "Account not found.");
    }

    const collision = await adapter.getUserByEmail(newEmail);
    if (collision && collision.id !== user.id) {
      return renderHtml("Email change failed", "That email is already in use.");
    }

    await adapter.updateUser({
      id: user.id,
      email: newEmail,
      GSI1PK: `USER#${newEmail}`,
      GSI1SK: `USER#${newEmail}`,
    });

    const host = request.headers.get("host");
    const baseUrl = host ? `https://${host}` : request.url;
    const redirectUrl = new URL("/signin?reason=email-updated", baseUrl);
    const response = NextResponse.redirect(redirectUrl);
    // Expire common NextAuth session cookies so the user signs back in with the new email.
    const expires = new Date(0).toUTCString();
    response.headers.append("Set-Cookie", `next-auth.session-token=; Path=/; Expires=${expires}; HttpOnly; SameSite=Lax`);
    response.headers.append("Set-Cookie", `__Secure-next-auth.session-token=; Path=/; Expires=${expires}; HttpOnly; SameSite=None; Secure`);
    return response;
  } catch (e) {
    console.error("/api/profile/confirm-email-change error:", e);
    return renderHtml("Email change failed", "An unexpected error occurred. Please request a new link and try again.");
  }
}
