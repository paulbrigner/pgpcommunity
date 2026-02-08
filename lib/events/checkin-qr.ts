import { createHmac } from "crypto";
import QRCode from "qrcode";
import { NEXTAUTH_SECRET, NEXTAUTH_URL } from "@/lib/config";

const HMAC_ALGORITHM = "sha256";
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

type QRPayload = {
  lockAddress: string;
  tokenId: string;
  ownerAddress: string;
  issuedAt: number;
  expiresAt: number;
};

function getHmacKey(): string {
  if (!NEXTAUTH_SECRET) {
    throw new Error("NEXTAUTH_SECRET is required for QR code signing.");
  }
  return NEXTAUTH_SECRET;
}

function sign(payload: string): string {
  return createHmac(HMAC_ALGORITHM, getHmacKey())
    .update(payload)
    .digest("base64url");
}

export function createSignedToken(params: {
  lockAddress: string;
  tokenId: string;
  ownerAddress: string;
  expiryMs?: number;
}): string {
  const now = Date.now();
  const expiresAt = now + (params.expiryMs ?? DEFAULT_EXPIRY_MS);
  const payload = [
    params.lockAddress.toLowerCase(),
    params.tokenId,
    params.ownerAddress.toLowerCase(),
    now.toString(),
    expiresAt.toString(),
  ].join("|");
  const signature = sign(payload);
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export function verifySignedToken(token: string): QRPayload | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const dotIndex = decoded.lastIndexOf(".");
    if (dotIndex === -1) return null;
    const payload = decoded.slice(0, dotIndex);
    const signature = decoded.slice(dotIndex + 1);
    const expected = sign(payload);
    if (signature !== expected) return null;
    const parts = payload.split("|");
    if (parts.length !== 5) return null;
    const [lockAddress, tokenId, ownerAddress, issuedAtStr, expiresAtStr] =
      parts;
    const issuedAt = Number(issuedAtStr);
    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
    if (Date.now() > expiresAt) return null;
    return { lockAddress, tokenId, ownerAddress, issuedAt, expiresAt };
  } catch {
    return null;
  }
}

export function buildCheckinUrl(signedToken: string): string {
  const base = (NEXTAUTH_URL || "https://pgpforcrypto.org").replace(
    /\/+$/,
    "",
  );
  return `${base}/checkin?t=${encodeURIComponent(signedToken)}`;
}

export async function generateQRCodeBuffer(
  content: string,
): Promise<Buffer> {
  return QRCode.toBuffer(content, {
    type: "png",
    width: 320,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}

export async function generateCheckinQR(params: {
  lockAddress: string;
  tokenId: string;
  ownerAddress: string;
  expiryMs?: number;
}): Promise<{ buffer: Buffer; token: string; url: string }> {
  const token = createSignedToken(params);
  const url = buildCheckinUrl(token);
  const buffer = await generateQRCodeBuffer(url);
  return { buffer, token, url };
}
