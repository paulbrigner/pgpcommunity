import { describe, expect, it } from 'vitest';
import { decideExtend } from '../unlock-checkout';

describe('decideExtend', () => {
  it('forces extend when intent is renewal even without token id', () => {
    const result = decideExtend({
      intentKind: 'renewal',
      tokenIdForExtend: null,
      hasPrefetchedKey: false,
      hasKeyOnChain: false,
    });
    expect(result.shouldExtend).toBe(true);
  });

  it('extends when a token id is available', () => {
    const result = decideExtend({
      intentKind: 'membership',
      tokenIdForExtend: '123',
      hasPrefetchedKey: false,
      hasKeyOnChain: false,
    });
    expect(result.shouldExtend).toBe(true);
  });

  it('extends when any key indicator is present', () => {
    const result = decideExtend({
      intentKind: 'membership',
      tokenIdForExtend: null,
      hasPrefetchedKey: false,
      hasKeyOnChain: true,
    });
    expect(result.shouldExtend).toBe(true);
  });

  it('purchases when no key is present and no token id', () => {
    const result = decideExtend({
      intentKind: 'membership',
      tokenIdForExtend: null,
      hasPrefetchedKey: false,
      hasKeyOnChain: false,
    });
    expect(result.shouldExtend).toBe(false);
  });
});
