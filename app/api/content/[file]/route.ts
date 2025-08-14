import { NextRequest, NextResponse } from 'next/server';
import { Contract, JsonRpcProvider } from 'ethers';
import { getSignedUrl } from '@/lib/cloudFrontSigner';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import {PrivyClient} from '@privy-io/server-auth';


const LOCK_ADDRESS = process.env.NEXT_PUBLIC_LOCK_ADDRESS as string;
const NETWORK_ID = Number(process.env.NEXT_PUBLIC_NETWORK_ID);
const BASE_RPC_URL = process.env.NEXT_PUBLIC_BASE_RPC_URL as string;
const CLOUDFRONT_DOMAIN = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN as string;
const KEY_PAIR_ID = process.env.NEXT_PUBLIC_KEY_PAIR_ID as string;
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID as string;

const secretsClient = new SecretsManagerClient({
  region: "us-east-1" // e.g., "us-east-1"
});
const PRIVATE_KEY_SECRET_ARN = process.env.NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN as string;
const PRIVY_APP_KEY_SECRET_ARN = process.env.NEXT_PUBLIC_PRIVY_APP_KEY_SECRET_ARN as string;

const ABI = [
  'function totalKeys(address) view returns (uint256)',
  'function getHasValidKey(address) view returns (bool)',
];

async function getPrivateKey(): Promise<string> {
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: PRIVATE_KEY_SECRET_ARN })
  );
  if (!res.SecretString) {
    throw new Error('Secret value is empty');
  }
   return res.SecretString;
}

async function getPrivyPrivateKey(): Promise<string> {
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: PRIVY_APP_KEY_SECRET_ARN })
  );
  if (!res.SecretString) {
    throw new Error('Secret value is empty');
  }
  return res.SecretString;
}

export const revalidate = 0;

export async function GET(request: NextRequest, { params }: { params: Promise<{ file: string }> }) {

  const { file } = await params;
  if (!file) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  // Ensure user is logged-in with Privy (authentication)  
  // Extract the access token from the Authorization header
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const accessToken = authHeader.replace('Bearer ','');
  const privyPrivateKey = await getPrivyPrivateKey(); // Securely fetch from Secrets Manager
  const privy = new PrivyClient(PRIVY_APP_ID, privyPrivateKey);
  // Validate the token using Privy's verification method
  const verifiedClaims = await privy.verifyAuthToken(accessToken);
  const userId = verifiedClaims.userId;
  const user = await privy.getUserById(userId);  
  // improve: make more robust for various auth options
  const firstAccount = user.linkedAccounts[0] as {
    address: string;
    // Add other known properties if needed
  };
  const address = firstAccount.address;

  
  // Use the wallet address to ensure user is a PGP member
  // after which we know user is authenticated and a member
  try {
    const provider = new JsonRpcProvider(BASE_RPC_URL, NETWORK_ID);
    const lock = new Contract(LOCK_ADDRESS, ABI, provider);

    const total = await lock.totalKeys(address);
    if (total.toString() === '0') {
      return NextResponse.json({ error: 'No membership' }, { status: 403 });
    }

    const valid = await lock.getHasValidKey(address);
    if (!valid) {
      return NextResponse.json({ error: 'Membership expired' }, { status: 403 });
    }

    const privateKey = await getPrivateKey(); // Securely fetch from Secrets Manager
    const expires = Math.floor(Date.now() / 1000) + 60 * 5;
    const url = getSignedUrl({
      url: `https://${CLOUDFRONT_DOMAIN}/${file}`,
      keyPairId: KEY_PAIR_ID,
      privateKey,
      expires,
    });

    return NextResponse.json({ url });
  } catch (err) {
    console.error('Failed to generate URL', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
