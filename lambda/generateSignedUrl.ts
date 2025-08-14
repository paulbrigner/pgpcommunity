import { getSignedUrl } from '../lib/cloudFrontSigner';
import { Contract, JsonRpcProvider } from 'ethers';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const LOCK_ADDRESS = process.env.LOCK_ADDRESS as string;
const NETWORK_ID = Number(process.env.NETWORK_ID);
const BASE_RPC_URL = process.env.BASE_RPC_URL as string;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN as string;
const KEY_PAIR_ID = process.env.KEY_PAIR_ID as string;
const PRIVATE_KEY_SECRET_ARN = process.env.PRIVATE_KEY_SECRET_ARN as string;

const secretsClient = new SecretsManagerClient({});

async function getPrivateKey(): Promise<string> {
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: PRIVATE_KEY_SECRET_ARN })
  );
  if (!res.SecretString) {
    throw new Error('Secret value is empty');
  }
  return res.SecretString;
}

const ABI = [
  'function totalKeys(address) view returns (uint256)',
  'function getHasValidKey(address) view returns (bool)',
];

export const handler = async (event: any) => {
  const addr = event.queryStringParameters?.address as string;
  const file = event.queryStringParameters?.file as string;

  if (!addr || !file) {
    return { statusCode: 400, body: 'Missing parameters' };
  }

  try {
    const provider = new JsonRpcProvider(BASE_RPC_URL, NETWORK_ID);
    const lock = new Contract(LOCK_ADDRESS, ABI, provider);

    const total = await lock.totalKeys(addr);
    if (total.toString() === '0') {
      return { statusCode: 403, body: 'No membership' };
    }

    const valid = await lock.getHasValidKey(addr);
    if (!valid) {
      return { statusCode: 403, body: 'Membership expired' };
    }

    const privateKey = await getPrivateKey();
    const expires = Math.floor(Date.now() / 1000) + 60 * 5; // 5 minutes
    const url = getSignedUrl({
      url: `https://${CLOUDFRONT_DOMAIN}/${file}`,
      keyPairId: KEY_PAIR_ID,
      expires,
      privateKey,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url }),
    };
  } catch (err) {
    console.error('Failed to generate URL', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
