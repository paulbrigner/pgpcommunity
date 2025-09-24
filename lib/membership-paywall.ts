import { BASE_NETWORK_ID, MEMBERSHIP_TIERS, MembershipTierConfig } from '@/lib/config';

type PaywallLockConfig = {
  network: number;
  name?: string;
  recurringPayments?: number | null;
  order?: number;
  maxRecipients?: number | null;
  recipient?: string;
  dataBuilder?: string;
  emailRequired?: boolean;
};

type PaywallBaseConfig = {
  icon?: string;
  referrer?: string;
  title?: string;
  endingCallToAction?: string;
  persistentCheckout?: boolean;
  hideSoldOut?: boolean;
  skipRecipient?: boolean;
  skipSelect?: boolean;
  pessimistic?: boolean;
};

type PaywallConfig = PaywallBaseConfig & {
  locks: Record<string, PaywallLockConfig>;
};

const BASE_TEMPLATE: PaywallBaseConfig = {
  icon: '',
  referrer: '0x76ff49cc68710a0dF27724D46698835D7c7AF2f2',
  title: 'Join PGP* for Crypto!',
  endingCallToAction: '',
  persistentCheckout: false,
  hideSoldOut: false,
  skipRecipient: true,
  skipSelect: false,
  pessimistic: false,
};

const buildLockConfig = (tier: MembershipTierConfig, index: number): PaywallLockConfig => ({
  network: BASE_NETWORK_ID,
  name: tier.label,
  recurringPayments: 12,
  order: typeof tier.order === 'number' ? tier.order : index,
  maxRecipients: null,
  recipient: '',
  dataBuilder: '',
  emailRequired: false,
});

const buildLocksMap = (): Record<string, PaywallLockConfig> => {
  const locks: Record<string, PaywallLockConfig> = {};
  MEMBERSHIP_TIERS.forEach((tier, index) => {
    locks[tier.checksumAddress] = buildLockConfig(tier, index);
  });
  return locks;
};

export const MEMBERSHIP_PAYWALL_CONFIG: PaywallConfig = {
  ...BASE_TEMPLATE,
  locks: buildLocksMap(),
};

export const cloneMembershipPaywallConfig = (): PaywallConfig => ({
  ...BASE_TEMPLATE,
  locks: buildLocksMap(),
});

const findTierByAddress = (address: string): MembershipTierConfig | null => {
  if (!address) return null;
  const normalized = address.toLowerCase();
  return (
    MEMBERSHIP_TIERS.find(
      (tier) =>
        tier.address.toLowerCase() === normalized || tier.checksumAddress.toLowerCase() === normalized
    ) || null
  );
};

export const buildSingleLockCheckoutConfig = (address: string): PaywallConfig => {
  const tier = findTierByAddress(address);
  if (!tier) {
    return cloneMembershipPaywallConfig();
  }
  return {
    ...BASE_TEMPLATE,
    skipSelect: true,
    locks: {
      [tier.checksumAddress]: {
        ...buildLockConfig(tier, 0),
        order: 0,
      },
    },
  };
};
