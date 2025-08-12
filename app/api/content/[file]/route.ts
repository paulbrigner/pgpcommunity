import { NextRequest, NextResponse } from 'next/server';
import { Contract, JsonRpcProvider } from 'ethers';
import { getSignedUrl } from '@/lambda/cloudFrontSigner';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';


const LOCK_ADDRESS = process.env.LOCK_ADDRESS as string;
const NETWORK_ID = Number(process.env.NETWORK_ID);
const BASE_RPC_URL = process.env.BASE_RPC_URL as string;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN as string;
const KEY_PAIR_ID = process.env.KEY_PAIR_ID as string;
const secretsClient = new SecretsManagerClient({});
const PRIVATE_KEY_SECRET_ARN = process.env.NEXT_PRIVATE_KEY_SECRET_ARN as string;


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

export const revalidate = 0;

export async function GET(request: NextRequest, { params }: { params: Promise<{ file: string }> }) {

  const address = request.nextUrl.searchParams.get('address');
  const { file } = await params;

  if (!address || !file) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }


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
