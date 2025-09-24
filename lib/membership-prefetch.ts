import type { MembershipSummary } from "@/lib/membership-server";

type PrefetchStatus = "active" | "expired" | "none";

export type PrefetchedMembership = {
  summary: MembershipSummary | null;
  status: PrefetchStatus;
  expiry: number | null;
  addresses: string[];
  timestamp: number;
};

const STORAGE_KEY = "pgpcommunity:membership-prefetch";
const DEFAULT_MAX_AGE_MS = 3 * 60 * 1000;

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function normalizePrefetched(value: any): PrefetchedMembership | null {
  if (!value || typeof value !== "object") return null;
  const summary = value.summary ?? null;
  const status = value.status;
  const expiry = typeof value.expiry === "number" && Number.isFinite(value.expiry) ? value.expiry : null;
  const addresses = Array.isArray(value.addresses)
    ? value.addresses.map((addr: unknown) => (typeof addr === "string" ? addr.toLowerCase() : null)).filter(Boolean)
    : [];
  const timestamp = typeof value.timestamp === "number" && Number.isFinite(value.timestamp) ? value.timestamp : null;
  if (!timestamp) return null;
  if (status !== "active" && status !== "expired" && status !== "none") return null;
  return {
    summary: summary && typeof summary === "object" ? (summary as MembershipSummary) : null,
    status,
    expiry,
    addresses,
    timestamp,
  };
}

export function savePrefetchedMembership(data: {
  summary: MembershipSummary | null;
  status: PrefetchStatus;
  expiry: number | null;
  addresses: string[];
}): void {
  const storage = getSessionStorage();
  if (!storage) return;
  const payload: PrefetchedMembership = {
    summary: data.summary,
    status: data.status,
    expiry: typeof data.expiry === "number" && Number.isFinite(data.expiry) ? data.expiry : null,
    addresses: Array.from(new Set(data.addresses.map((addr) => addr.toLowerCase()))),
    timestamp: Date.now(),
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore write failures (likely storage quota or disabled cookies)
  }
}

export function loadPrefetchedMembership(maxAgeMs: number = DEFAULT_MAX_AGE_MS): PrefetchedMembership | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = normalizePrefetched(JSON.parse(raw));
    if (!parsed) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    if (Date.now() - parsed.timestamp > maxAgeMs) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function loadPrefetchedMembershipFor(addresses: string[], maxAgeMs: number = DEFAULT_MAX_AGE_MS): PrefetchedMembership | null {
  const prefetched = loadPrefetchedMembership(maxAgeMs);
  if (!prefetched) return null;
  const normalized = Array.from(new Set(addresses.map((addr) => addr.toLowerCase())));
  if (!normalized.length) return prefetched;
  if (normalized.length !== prefetched.addresses.length) return null;
  const mismatched = normalized.some((addr) => !prefetched.addresses.includes(addr));
  if (mismatched) {
    clearPrefetchedMembership();
    return null;
  }
  return prefetched;
}

export function clearPrefetchedMembership(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore removal failures
  }
}

export { DEFAULT_MAX_AGE_MS as MEMBERSHIP_PREFETCH_MAX_AGE_MS };
