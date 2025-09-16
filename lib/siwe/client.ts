"use client";

import { SiweMessage, generateNonce } from "siwe";
import { getAddress } from "ethers";
import { signIn } from "next-auth/react";

async function getNextAuthCsrfToken(): Promise<string | undefined> {
  try {
    // First, try cookie (fast path)
    const rawCookie = (globalThis as any)?.document?.cookie as string | undefined;
    if (rawCookie) {
      const m = rawCookie.match(/(?:^|; )next-auth\.csrf-token=([^;]+)/);
      if (m && m[1]) {
        const val = decodeURIComponent(m[1]);
        const token = val.split("|")[0];
        if (token) return token;
      }
    }
  } catch {}
  try {
    // Fallback: ask NextAuth to issue a fresh CSRF token
    const res = await fetch("/api/auth/csrf", { method: "GET", credentials: "include" });
    if (res.ok) {
      const data: any = await res.json();
      const token = data?.csrfToken as string | undefined;
      if (token) return token;
      // After this request, the cookie should also be set; try reading again
      try {
        const rawCookie2 = (globalThis as any)?.document?.cookie as string | undefined;
        if (rawCookie2) {
          const m2 = rawCookie2.match(/(?:^|; )next-auth\.csrf-token=([^;]+)/);
          if (m2 && m2[1]) {
            const val2 = decodeURIComponent(m2[1]);
            const token2 = val2.split("|")[0];
            if (token2) return token2;
          }
        }
      } catch {}
    }
  } catch {}
  return undefined;
}

export async function signInWithSiwe(): Promise<{ ok: boolean; error?: string; address?: string }>{
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
    // Use NextAuth's CSRF token value as SIWE nonce to satisfy server verification
    let nonce: string | undefined = await getNextAuthCsrfToken();
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
    return { ok: !rawErr, error: errStr, address };
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

export async function linkWalletWithSiwe(): Promise<{ ok: boolean; error?: string }>{
  try {
    const eth = (globalThis as any).ethereum;
    if (!eth) return { ok: false, error: "No injected wallet found" };

    const [rawAddress] = await eth.request({ method: "eth_requestAccounts" });
    const address = getAddress(rawAddress);
    const chainIdHex = await eth.request({ method: "eth_chainId" });
    const chainId = parseInt(chainIdHex, 16);
    const domain = globalThis.location.host;
    const origin = globalThis.location.origin;

    // Prefer NextAuth CSRF token as SIWE nonce
    let nonce: string | undefined = await getNextAuthCsrfToken();
    if (!nonce) nonce = generateNonce();

    const message = new SiweMessage({
      domain,
      address,
      statement: "Link your wallet to PGP Community.",
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

    const res = await fetch("/api/auth/link-wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    if (!res.ok) {
      let detail: any = undefined;
      try { detail = await res.json(); } catch {}
      const msg = detail?.error || res.statusText || `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
    return { ok: false, error: msg };
  }
}
