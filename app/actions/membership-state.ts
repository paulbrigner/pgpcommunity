'use server';

import 'server-only';

import { membershipStateService, type MembershipStateSnapshot } from '@/lib/membership-state-service';

interface FetchParams {
  addresses: string[];
  chainId?: number;
  forceRefresh?: boolean;
}

export async function fetchMembershipStateSnapshot(params: FetchParams): Promise<MembershipStateSnapshot> {
  const normalized = Array.isArray(params.addresses)
    ? Array.from(
        new Set(
          params.addresses
            .map((addr) => (typeof addr === 'string' ? addr.trim().toLowerCase() : ''))
            .filter((addr) => addr.length > 0),
        ),
      )
    : [];

  return membershipStateService.getState({
    addresses: normalized,
    chainId: params.chainId,
    forceRefresh: params.forceRefresh,
  });
}
