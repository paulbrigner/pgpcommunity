import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { NextRequest, NextResponse } from "next/server";
import { getSignedUrl } from "@/lib/cloudFrontSigner";
import { authenticateUser, checkMembership } from "@/lib/auth";
import {
  CLOUDFRONT_DOMAIN,
  KEY_PAIR_ID,
  PRIVATE_KEY_SECRET_ARN,
  AWS_REGION,
} from "@/lib/config"; // Environment-specific constants

export const revalidate = 0;

const secretsClient = new SecretsManagerClient({
  region: AWS_REGION,
});

async function getPrivateKey(): Promise<string> {
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: PRIVATE_KEY_SECRET_ARN })
  );
  if (!res.SecretString) {
    throw new Error("Secret value is empty");
  }
  return res.SecretString;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  if (!file) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  if (!CLOUDFRONT_DOMAIN || !KEY_PAIR_ID || !PRIVATE_KEY_SECRET_ARN) {
    console.error(
      "Missing required env: CLOUDFRONT_DOMAIN/KEY_PAIR_ID/PRIVATE_KEY_SECRET_ARN"
    );
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 }
    );
  }

  // // Authentication
  // const address = await authenticateUser(request);
  // if (!address) {
  //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // }

  // // Authorization
  // const isValidMember = await checkMembership(address);
  // if (!isValidMember) {
  //   return NextResponse.json({ error: 'No valid membership' }, { status: 403 });
  // }

  // Generate signed URL
  const privateKey = await getPrivateKey();
  const expires = Math.floor(Date.now() / 1000) + 60 * 5; // 5 minutes from now
  const url = getSignedUrl({
    url: `https://${CLOUDFRONT_DOMAIN}/${file}`,
    keyPairId: KEY_PAIR_ID,
    privateKey,
    expires,
  });

  return NextResponse.json({ url });
}
