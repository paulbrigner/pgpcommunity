import { NextRequest, NextResponse } from "next/server";
import { getSignedUrl } from "@/lib/cloudFrontSigner";
import { getToken } from "next-auth/jwt";
import {
  CLOUDFRONT_DOMAIN,
  KEY_PAIR_ID,
  PRIVATE_KEY_SECRET,
  NEXTAUTH_SECRET
} from "@/lib/config"; // Environment-specific constants

export const revalidate = 0;
export const runtime = "nodejs";


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  if (!file) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  if (!CLOUDFRONT_DOMAIN || !KEY_PAIR_ID ) {
    console.error(
      "Missing required env: CLOUDFRONT_DOMAIN/KEY_PAIR_ID"
    );
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 }
    );
  }

  // Authentication via NextAuth JWT (session token)
  const token = await getToken({ req: request as any, secret: NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Generate signed URL
  const privateKey = PRIVATE_KEY_SECRET;
  const expires = Math.floor(Date.now() / 1000) + 60 * 5; // 5 minutes from now
  const url = getSignedUrl({
    url: `https://${CLOUDFRONT_DOMAIN}/${file}`,
    keyPairId: KEY_PAIR_ID,
    privateKey,
    expires,
  });

  return NextResponse.json({ url });
}
