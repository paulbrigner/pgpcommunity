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
} from "@/lib/config"; // Environment-specific constants

const ABI = [
  "function totalKeys(address) view returns (uint256)",
  "function getHasValidKey(address) view returns (bool)",
];

const secretsClient = new SecretsManagerClient({ region: "us-east-1" });

async function getPrivyPrivateKey(): Promise<string> {
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: PRIVY_APP_KEY_SECRET_ARN })
  );
  if (!res.SecretString) {
    throw new Error("Secret value is empty");
  }
  return res.SecretString;
}

export async function authenticateUser(
  request: NextRequest
): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const accessToken = authHeader.replace("Bearer ", "");
  const privyPrivateKey = await getPrivyPrivateKey();
  const privy = new PrivyClient(PRIVY_APP_ID, privyPrivateKey);
  const verifiedClaims = await privy.verifyAuthToken(accessToken);
  const userId = verifiedClaims.userId;
  const user = await privy.getUserById(userId);
  const walletAccount = user.linkedAccounts.find(
    (account) => account.type === "wallet"
  );
  if (!walletAccount) {
    return null;
  }
  const address = walletAccount.address;
  return address;
}

export async function checkMembership(address: string): Promise<boolean> {
  const provider = new JsonRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
  const lock = new Contract(LOCK_ADDRESS, ABI, provider);
  const total = await lock.totalKeys(address);
  if (total.toString() === "0") return false;
  const valid = await lock.getHasValidKey(address);
  return valid;
}
