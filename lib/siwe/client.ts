"use client";

import { SiweMessage, generateNonce } from "siwe";
import { getAddress } from "ethers";
import { signIn } from "next-auth/react";

export async function signInWithSiwe(): Promise<{ ok: boolean; error?: string }>{
  try {
    const eth = (globalThis as any).ethereum;
    if (!eth) return { ok: false, error: "No injected wallet found" };

    const [rawAddress] = await eth.request({ method: "eth_requestAccounts" });
    // Ensure EIP-55 checksum to satisfy strict validators during SIWE verify
    const address = getAddress(rawAddress);
    const chainIdHex = await eth.request({ method: "eth_chainId" });
    const chainId = parseInt(chainIdHex, 16);
    const domain = globalThis.location.host;
    const origin = globalThis.location.origin;
    // Use NextAuth's CSRF token cookie value as SIWE nonce to satisfy server verification
    let nonce: string | undefined;
    try {
      const rawCookie = (globalThis as any)?.document?.cookie as string | undefined;
      if (rawCookie) {
        const m = rawCookie.match(/(?:^|; )next-auth\.csrf-token=([^;]+)/);
        if (m && m[1]) {
          const val = decodeURIComponent(m[1]);
          // Cookie format: `${token}|${hash}` — we only need the token
          nonce = val.split("|")[0];
        }
      }
    } catch {}
    if (!nonce) nonce = generateNonce();

    const message = new SiweMessage({
      domain,
      address,
      statement: "Sign in with Ethereum to PGP Community.",
      uri: origin,
      version: "1",
      chainId,
      nonce,
    });
    const prepared = message.prepareMessage();
    const signature = await eth.request({
      method: "personal_sign",
      params: [prepared, address],
    });

    const res = await signIn("credentials", {
      message: JSON.stringify(message),
      signature,
      redirect: false,
    });

    // Normalize any NextAuth error into a readable string
    const rawErr: any = (res as any)?.error;

    const toErrorString = (val: any): string | undefined => {
      if (!val) return undefined;
      if (typeof val === "string") return val;
      if (val instanceof Error) return val.message;
      if (typeof val === "object") {
        const candidates = [val.message, val.error, val.code, val.reason, val.statusText, val.detail];
        for (const c of candidates) {
          if (typeof c === "string" && c) return c;
        }
        try {
          return JSON.stringify(val);
        } catch {
          return String(val);
        }
      }
      return String(val);
    };

    let errStr = toErrorString(rawErr);
    if (errStr && errStr.trim() === "[object Object]") {
      errStr = "Unknown error";
    }
    return { ok: !rawErr, error: errStr };
  } catch (e: any) {
    const msg =
      typeof e?.message === "string"
        ? e.message
        : (() => {
            try {
              return JSON.stringify(e);
            } catch {
              return String(e);
            }
          })();
    return { ok: false, error: msg };
  }
}
