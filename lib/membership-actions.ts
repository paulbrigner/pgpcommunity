import { membershipStateService, snapshotToMembershipSummary } from '@/lib/membership-state-service';
import type { MembershipStateSnapshot, AllowanceState } from '@/lib/membership-state-service';
import type { MembershipSummary } from '@/lib/membership-server';

export type MembershipActionContext = {
  addresses: string[];
  chainId?: number;
};

export type MembershipActionResult = {
  snapshot: MembershipStateSnapshot;
  summary: MembershipSummary;
  allowances: Record<string, AllowanceState>;
};

// Simple refresh-only orchestrator. Keep minimal until a signer-backed flow is implemented.
export async function refreshMembershipState(ctx: MembershipActionContext): Promise<MembershipActionResult> {
  const snapshot = await membershipStateService.getState({ addresses: ctx.addresses, chainId: ctx.chainId, forceRefresh: true });
  const { summary, allowances } = snapshotToMembershipSummary(snapshot);
  return { snapshot, summary, allowances };
}

export async function invalidateMembershipState(ctx: MembershipActionContext): Promise<void> {
  membershipStateService.invalidate(ctx.addresses, ctx.chainId);
}
