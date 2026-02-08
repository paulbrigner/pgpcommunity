import { Wallet } from "ethers";
import { SiweMessage } from "siwe";

type CachedLocksmithToken = {
  walletAddressLower: string;
  accessToken: string;
  obtainedAt: number;
};

let cachedLocksmithToken: CachedLocksmithToken | null = null;
const LOCKSMITH_TOKEN_TTL_MS = 10 * 60 * 1000;

export function clearCachedLocksmithToken(): void {
  cachedLocksmithToken = null;
}

export async function loginToLocksmith(params: {
  sponsor: Wallet;
  chainId: number;
  baseUrl: string;
}): Promise<string> {
  const { sponsor, chainId, baseUrl } = params;
  const walletAddressLower = sponsor.address.toLowerCase();
  const cached = cachedLocksmithToken;
  if (
    cached &&
    cached.walletAddressLower === walletAddressLower &&
    Date.now() - cached.obtainedAt < LOCKSMITH_TOKEN_TTL_MS
  ) {
    return cached.accessToken;
  }

  const nonceRes = await fetch(`${baseUrl}/v2/auth/nonce`, {
    cache: "no-store",
  });
  if (!nonceRes.ok) {
    throw new Error(`Locksmith nonce fetch failed (${nonceRes.status}).`);
  }
  const nonce = (await nonceRes.text()).trim();
  if (!nonce) {
    throw new Error("Locksmith nonce response was empty.");
  }

  const domain = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "locksmith.unlock-protocol.com";
    }
  })();

  const message = new SiweMessage({
    domain,
    address: sponsor.address,
    statement: "Sign in to Unlock",
    uri: baseUrl,
    version: "1",
    chainId,
    nonce,
  });
  const prepared = message.prepareMessage();
  const signature = await sponsor.signMessage(prepared);

  const loginRes = await fetch(`${baseUrl}/v2/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: prepared, signature }),
    cache: "no-store",
  });
  if (!loginRes.ok) {
    const detail = await loginRes.text().catch(() => "");
    throw new Error(
      `Locksmith login failed (${loginRes.status}): ${detail || "Unknown error"}`,
    );
  }
  const payload = (await loginRes.json().catch(() => ({}))) as any;
  const accessToken =
    typeof payload?.accessToken === "string" && payload.accessToken.length
      ? payload.accessToken
      : null;
  if (!accessToken) {
    throw new Error("Locksmith login did not return an accessToken.");
  }

  cachedLocksmithToken = {
    walletAddressLower,
    accessToken,
    obtainedAt: Date.now(),
  };
  return accessToken;
}
