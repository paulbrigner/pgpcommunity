import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('membership-state-service token id resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_UNLOCK_SUBGRAPH_URL = 'https://example.test/subgraph';
    delete process.env.UNLOCK_SUBGRAPH_API_KEY;
    delete process.env.UNLOCK_SUBGRAPH_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (process as any).env.NEXT_PUBLIC_UNLOCK_SUBGRAPH_URL;
  });

  it('returns token ids and owners from the subgraph', async () => {
    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          keys: [
            { tokenId: '123', owner: '0xabc' },
            { tokenId: '0x2', owner: '0xABC' },
          ],
        },
      }),
    } as any);

    const mod = await import('../membership-state-service');
    const svc: any = mod.membershipStateService as any;
    const result = await svc.fetchTokenIdsFromSubgraph('0xLock', ['0xabc', '0xdef']);

    expect(result.tokenIds).toEqual(['123', '2']);
    expect(Array.from(result.ownersWithKeys)).toEqual(['0xabc']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.test/subgraph');
  });

  it('returns empty when no endpoint is configured', async () => {
    delete (process as any).env.NEXT_PUBLIC_UNLOCK_SUBGRAPH_URL;
    vi.resetModules();
    const fetchMock = vi.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('should not be called'));
    const mod = await import('../membership-state-service');
    const svc: any = mod.membershipStateService as any;
    const result = await svc.fetchTokenIdsFromSubgraph('0xLock', ['0xabc']);

    expect(result.tokenIds).toEqual([]);
    expect(result.ownersWithKeys.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
