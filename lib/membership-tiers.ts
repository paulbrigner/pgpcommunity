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

const compareActiveTiers = (a: TierMembershipSummary, b: TierMembershipSummary): number => {
  const expiryA = typeof a.expiry === 'number' && Number.isFinite(a.expiry) ? a.expiry : Number.MAX_SAFE_INTEGER;
  const expiryB = typeof b.expiry === 'number' && Number.isFinite(b.expiry) ? b.expiry : Number.MAX_SAFE_INTEGER;
  if (expiryA !== expiryB) {
    return expiryB - expiryA;
  }
  const orderA = typeof a.tier.order === 'number' ? a.tier.order : Number.MAX_SAFE_INTEGER;
  const orderB = typeof b.tier.order === 'number' ? b.tier.order : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  return a.tier.checksumAddress.localeCompare(b.tier.checksumAddress);
};

export const pickHighestActiveTier = (summary: MembershipSummary | null | undefined): TierMembershipSummary | null => {
  if (!summary?.tiers?.length) return null;
  const active = summary.tiers.filter((tier) => tier.status === 'active');
  if (!active.length) {
    return summary.highestActiveTier ?? null;
  }
  const sorted = [...active].sort(compareActiveTiers);
  return sorted[0] ?? null;
};

export const resolveTierLabel = (
  tier: TierMembershipSummary | null | undefined,
  fallbackId?: string | null | undefined
): string | null => {
  if (tier) {
    return tier.tier.label || tier.metadata?.name || tier.tier.checksumAddress || null;
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

