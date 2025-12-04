import { getAddress } from 'ethers';
import {
  BASE_NETWORK_ID,
  CHECKOUT_CONFIGS,
  MEMBERSHIP_RECURRING_PAYMENTS,
  MEMBERSHIP_REFERRER_ADDRESS,
  MEMBERSHIP_TIERS,
  type MembershipTierConfig,
} from '@/lib/config';

type CheckoutTargetType = 'membership' | 'event';

export type CheckoutOverrides = (Record<string, unknown> & {
  referrer?: string;
  protocolReferrer?: string;
  keyManager?: string;
  data?: string;
  additionalPeriods?: number;
  recurringPayments?: number | 'forever';
  totalApproval?: string | number | bigint;
}) | null;

export interface CheckoutTarget {
  id: string;
  type: CheckoutTargetType;
  lockAddress: string;
  checksumAddress: string;
  network: number;
  label?: string;
  overrides: CheckoutOverrides;
}

const normalizeAddress = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed.toLowerCase() : null;
};

const buildMembershipTarget = (tier: MembershipTierConfig): CheckoutTarget => ({
  id: tier.id,
  type: 'membership',
  lockAddress: tier.address,
  checksumAddress: tier.checksumAddress,
  network: BASE_NETWORK_ID,
  label: tier.label,
  overrides: {
    referrer: MEMBERSHIP_REFERRER_ADDRESS,
    recurringPayments: MEMBERSHIP_RECURRING_PAYMENTS,
  },
});

const membershipTargetMap = new Map<string, CheckoutTarget>();
for (const tier of MEMBERSHIP_TIERS) {
  const target = buildMembershipTarget(tier);
  membershipTargetMap.set(target.id, target);
  membershipTargetMap.set(target.lockAddress, target);
  membershipTargetMap.set(target.checksumAddress.toLowerCase(), target);
}

const parseOverrides = (value: string | undefined): CheckoutOverrides => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      const overrides = parsed as Record<string, unknown>;
      const recurringRaw = overrides.recurringPayments;
      if (typeof recurringRaw === 'string') {
        const normalized = recurringRaw.trim().toLowerCase();
        if (normalized === 'forever') {
          overrides.recurringPayments = 'forever';
        } else {
          const numeric = Number(recurringRaw);
          if (Number.isFinite(numeric) && numeric > 0) {
            overrides.recurringPayments = numeric;
          }
        }
      }
      return overrides as CheckoutOverrides;
    }
  } catch (err) {
    console.error('Failed to parse CHECKOUT_CONFIG override:', err);
  }
  return null;
};

const eventTargetMap = new Map<string, CheckoutTarget>();
for (const [lock, raw] of Object.entries(CHECKOUT_CONFIGS)) {
  const normalized = normalizeAddress(lock);
  if (!normalized) continue;
  const overrides = parseOverrides(raw);
  const membershipTarget = membershipTargetMap.get(normalized);
  if (membershipTarget && overrides) {
    membershipTarget.overrides = {
      ...(membershipTarget.overrides ?? {}),
      ...overrides,
    } as CheckoutOverrides;
    continue;
  }
  const target: CheckoutTarget = {
    id: normalized,
    type: 'event',
    lockAddress: normalized,
    checksumAddress: lock,
    network: BASE_NETWORK_ID,
    overrides,
  };
  eventTargetMap.set(normalized, target);
}

export const MEMBERSHIP_CHECKOUT_TARGETS: CheckoutTarget[] = Array.from(new Set(membershipTargetMap.values()));

export const EVENT_CHECKOUT_TARGETS: CheckoutTarget[] = Array.from(eventTargetMap.values());

export function getMembershipCheckoutTarget(tierId?: string | null): CheckoutTarget | null {
  if (tierId) {
    const normalized = normalizeAddress(tierId);
    if (normalized) {
      const existing = membershipTargetMap.get(normalized);
      if (existing) {
        return existing;
      }
    }
  }
  return MEMBERSHIP_CHECKOUT_TARGETS.length ? MEMBERSHIP_CHECKOUT_TARGETS[0] : null;
}

export function getEventCheckoutTarget(lockAddress: string | null | undefined): CheckoutTarget | null {
  const normalized = normalizeAddress(lockAddress);
  if (!normalized) return null;
  const existing = eventTargetMap.get(normalized);
  if (existing) return existing;
  const checksum = (() => {
    try {
      return getAddress(lockAddress as string);
    } catch {
      return lockAddress ?? normalized;
    }
  })();
  return {
    id: normalized,
    type: 'event',
    lockAddress: normalized,
    checksumAddress: checksum,
    network: BASE_NETWORK_ID,
    overrides: null,
  };
}

export function isMembershipTarget(target: CheckoutTarget | null | undefined): target is CheckoutTarget & { type: 'membership' } {
  return !!target && target.type === 'membership';
}

export function isEventTarget(target: CheckoutTarget | null | undefined): target is CheckoutTarget & { type: 'event' } {
  return !!target && target.type === 'event';
}
