import { getAddress } from 'ethers';
import {
  BASE_NETWORK_ID,
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

const eventTargetMap = new Map<string, CheckoutTarget>();

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
