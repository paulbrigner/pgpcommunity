import { NextRequest } from "next/server";
import { Contract, JsonRpcProvider } from "ethers";
import { PrivyClient } from "@privy-io/server-auth";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  PRIVY_APP_ID,
  LOCK_ADDRESS,
  PRIVY_APP_KEY_SECRET_ARN,
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  AWS_REGION,
} from "@/lib/config"; // Environment-specific constants

const ABI = [
  "function totalKeys(address) view returns (uint256)",
  "function getHasValidKey(address) view returns (bool)",
];

const secretsClient = new SecretsManagerClient({ region: AWS_REGION });

async function getPrivyPrivateKey(): Promise<string> {
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: PRIVY_APP_KEY_SECRET_ARN })
  );
  if (!res.SecretString) {
    throw new Error("Secret value is empty");
  }
  return res.SecretString;
}

export type VerifiedIdentity = Awaited<ReturnType<PrivyClient["getUser"]>>;

// Verifies the identity token (from cookie or header) and returns the user
export async function verifyIdentity(
  request: NextRequest
): Promise<VerifiedIdentity | null> {
  const idTokenFromCookie = request.cookies.get("privy-id-token")?.value;
  const idTokenFromHeader = request.headers.get("privy-id-token") ?? undefined;
  const idToken = idTokenFromCookie ?? idTokenFromHeader;
  if (!idToken) return null;

  const privySecret = await getPrivyPrivateKey();
  const client = new PrivyClient(PRIVY_APP_ID, privySecret);
  try {
    const user = await client.getUser({ idToken });
    return user;
  } catch (error) {
    console.error("Invalid identity token:", error);
    return null;
  }
}

// Backward-compatible helper: returns the first linked wallet address
export async function authenticateUser(
  request: NextRequest
): Promise<string | null> {
  const user = await verifyIdentity(request);
  if (!user) return null;
  const walletAccount = user.linkedAccounts.find(
    (account) => account.type === "wallet"
  );
  return walletAccount?.address ?? null;
}

export async function checkMembership(address: string): Promise<boolean> {
  const provider = new JsonRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
  const lock = new Contract(LOCK_ADDRESS, ABI, provider);
  const total = await lock.totalKeys(address);
  if (total.toString() === "0") return false;
  const valid = await lock.getHasValidKey(address);
  return valid;
}
