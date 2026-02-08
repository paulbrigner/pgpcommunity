import { MEMBERSHIP_TIERS } from '@/lib/config';
import type { MembershipSummary, TierMembershipSummary } from '@/lib/membership-server';

const normalize = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
};

const collectKeys = (tier: TierMembershipSummary | null | undefined): Set<string> => {
  const result = new Set<string>();
  if (!tier) return result;
  const push = (value: string | null | undefined) => {
    const normalized = normalize(value);
    if (normalized) {
      result.add(normalized);
    }
  };
  push(tier.tier.id);
  push(tier.tier.address);
  push(tier.tier.checksumAddress);
  return result;
};

const resolveConfig = (id: string | null | undefined) => {
  const normalized = normalize(id);
  if (!normalized) return null;
  return (
    MEMBERSHIP_TIERS.find((tier) => {
      const keys = [tier.id, tier.address, tier.checksumAddress]
        .map((value) => normalize(value))
        .filter(Boolean) as string[];
      return keys.includes(normalized);
    }) || null
  );
};

const asExpirySeconds = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
};

const expirySortValue = (expiry: number | null | undefined): number => {
  const normalized = asExpirySeconds(expiry);
  // Treat null/invalid expiry as "never expires" for comparisons.
  return normalized ?? Number.MAX_SAFE_INTEGER;
};

export const normalizeTierId = (value: string | null | undefined): string | null | undefined => {
  if (value === undefined) return undefined;
  return normalize(value);
};

export const findTierInSummary = (
  summary: MembershipSummary | null | undefined,
  identifier: string | null | undefined
): TierMembershipSummary | null => {
  const normalized = normalize(identifier);
  if (!normalized || !summary?.tiers?.length) return null;
  for (const tier of summary.tiers) {
    const keys = collectKeys(tier);
    if (keys.has(normalized)) {
      return tier;
    }
  }
  return null;
};

export const pickHighestActiveTier = (summary: MembershipSummary | null | undefined): TierMembershipSummary | null => {
  if (!summary?.tiers?.length) return null;
  const active = summary.tiers.filter((tier) => tier.status === 'active');
  if (!active.length) {
    return summary.highestActiveTier ?? null;
  }
  // "Highest" is defined by tier order (lower order = higher priority). Expiry is not used for rank.
  return active.reduce<TierMembershipSummary>((best, current) => {
    const bestOrder = typeof best.tier.order === 'number' ? best.tier.order : Number.MAX_SAFE_INTEGER;
    const currentOrder = typeof current.tier.order === 'number' ? current.tier.order : Number.MAX_SAFE_INTEGER;
    if (currentOrder !== bestOrder) {
      return currentOrder < bestOrder ? current : best;
    }
    const bestExpiry = expirySortValue(best.expiry);
    const currentExpiry = expirySortValue(current.expiry);
    if (currentExpiry !== bestExpiry) {
      return currentExpiry > bestExpiry ? current : best;
    }
    return current.tier.checksumAddress.localeCompare(best.tier.checksumAddress) < 0 ? current : best;
  }, active[0]);
};

export const pickNextActiveTier = (summary: MembershipSummary | null | undefined): TierMembershipSummary | null => {
  if (!summary?.tiers?.length) return null;
  const current = pickHighestActiveTier(summary);
  if (!current || current.status !== 'active') return null;
  const currentExpiryValue = expirySortValue(current.expiry);
  if (currentExpiryValue === Number.MAX_SAFE_INTEGER) {
    // Current tier never expires; there is no "next after expiry".
    return null;
  }

  const currentKeys = collectKeys(current);
  const candidates = summary.tiers.filter((tier) => {
    if (tier.status !== 'active') return false;
    const keys = collectKeys(tier);
    for (const key of keys) {
      if (currentKeys.has(key)) return false;
    }
    return true;
  });
  if (!candidates.length) return null;

  const eligible = candidates.filter((tier) => expirySortValue(tier.expiry) > currentExpiryValue);
  if (!eligible.length) return null;

  // Prefer the highest-priority remaining tier (lowest order) among those that outlast the current tier.
  return eligible.reduce<TierMembershipSummary>((best, currentCandidate) => {
    const bestOrder = typeof best.tier.order === 'number' ? best.tier.order : Number.MAX_SAFE_INTEGER;
    const currentOrder = typeof currentCandidate.tier.order === 'number' ? currentCandidate.tier.order : Number.MAX_SAFE_INTEGER;
    if (currentOrder !== bestOrder) {
      return currentOrder < bestOrder ? currentCandidate : best;
    }
    const bestExpiry = expirySortValue(best.expiry);
    const currentExpiry = expirySortValue(currentCandidate.expiry);
    if (currentExpiry !== bestExpiry) {
      return currentExpiry > bestExpiry ? currentCandidate : best;
    }
    return currentCandidate.tier.checksumAddress.localeCompare(best.tier.checksumAddress) < 0 ? currentCandidate : best;
  }, eligible[0]);
};

export const resolveTierLabel = (
  tier: TierMembershipSummary | null | undefined,
  fallbackId?: string | null | undefined
): string | null => {
  if (tier) {
    return tier.metadata?.name || tier.tier.label || tier.tier.checksumAddress || null;
  }
  if (fallbackId) {
    const normalized = normalize(fallbackId);
    if (normalized) {
      const match = resolveConfig(normalized);
      if (match) {
        return match.label || match.checksumAddress;
      }
    }
  }
  return null;
};

export const detectRecentlyActivatedTierId = (
  current: MembershipSummary | null | undefined,
  previous: MembershipSummary | null | undefined,
  thresholdSeconds = 60
): string | null => {
  if (!current?.tiers?.length) return null;
  const prevTiers = previous?.tiers ?? [];

  for (const tier of current.tiers) {
    if (tier.status !== 'active') continue;
    const keys = collectKeys(tier);
    const id = normalize(tier.tier.id) || normalize(tier.tier.address) || null;
    if (!id) continue;
    const prev = prevTiers.find((candidate) => {
      const prevKeys = collectKeys(candidate);
      for (const key of keys) {
        if (prevKeys.has(key)) return true;
      }
      return false;
    });
    if (!prev || prev.status !== 'active') {
      return id;
    }
    const prevExpiry = typeof prev.expiry === 'number' ? prev.expiry : null;
    const currentExpiry = typeof tier.expiry === 'number' ? tier.expiry : null;
    if (
      typeof currentExpiry === 'number' &&
      typeof prevExpiry === 'number' &&
      currentExpiry - prevExpiry > thresholdSeconds
    ) {
      return id;
    }
  }

  return null;
};

export const pickFallbackDesiredTierId = (
  summary: MembershipSummary | null | undefined
): string | null => {
  const highest = pickHighestActiveTier(summary);
  return normalize(highest?.tier.id) || null;
};
