import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('checkout-config', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_LOCK_TIERS = JSON.stringify([
      {
        id: 'founders',
        address: '0x1111111111111111111111111111111111111111',
        label: 'Founders',
      },
      {
        id: 'builders',
        address: '0x2222222222222222222222222222222222222222',
        label: 'Builders',
      },
    ]);
    process.env.NEXT_PUBLIC_UNLOCK_ADDRESS = '0x0000000000000000000000000000000000000000';
    process.env.NEXT_PUBLIC_BASE_NETWORK_ID = '8453';
    process.env.CHECKOUT_CONFIGS = '0x3333333333333333333333333333333333333333:{"locks":{"0x3333333333333333333333333333333333333333":{"network":8453}}}';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_LOCK_TIERS;
    delete process.env.NEXT_PUBLIC_UNLOCK_ADDRESS;
    delete process.env.NEXT_PUBLIC_BASE_NETWORK_ID;
    delete process.env.CHECKOUT_CONFIGS;
    vi.resetModules();
  });

  it('resolves membership checkout targets by id', async () => {
    const mod = await import('../checkout-config');
    const { getMembershipCheckoutTarget, MEMBERSHIP_CHECKOUT_TARGETS } = mod;
    expect(MEMBERSHIP_CHECKOUT_TARGETS).toHaveLength(2);
    const founders = getMembershipCheckoutTarget('founders');
    expect(founders?.checksumAddress.toLowerCase()).toBe('0x1111111111111111111111111111111111111111');
    const builders = getMembershipCheckoutTarget('0x2222222222222222222222222222222222222222');
    expect(builders?.id).toBe('builders');
  });

  it('returns event checkout target when configured', async () => {
    const mod = await import('../checkout-config');
    const { getEventCheckoutTarget } = mod;
    const eventTarget = getEventCheckoutTarget('0x3333333333333333333333333333333333333333');
    expect(eventTarget).not.toBeNull();
    expect(eventTarget?.type).toBe('event');
    expect(eventTarget?.network).toBe(8453);
  });
});
