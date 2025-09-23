import { NextRequest, NextResponse } from 'next/server';
import { BASE_NETWORK_ID, BASE_RPC_URL, MEMBERSHIP_TIERS } from '@/lib/config';
import { getMembershipSummary, getStatusAndExpiry } from '@/lib/membership-server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const addrsParam = searchParams.get('addresses');
    const rpcUrl = BASE_RPC_URL;
    const networkId = BASE_NETWORK_ID;

    if (!addrsParam || !addrsParam.trim()) {
      return NextResponse.json({ error: 'addresses query param required' }, { status: 400 });
    }
    const addresses = Array.from(new Set(addrsParam.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)));
    if (addresses.length === 0) {
      return NextResponse.json({ error: 'no valid addresses' }, { status: 400 });
    }

    const lockOverride = searchParams.get('lock');
    if (lockOverride) {
      const { status, expiry } = await getStatusAndExpiry(addresses, rpcUrl, networkId, lockOverride);
      return NextResponse.json({ status, expiry });
    }

    const summary = await getMembershipSummary(addresses, rpcUrl, networkId);
    if (!summary.tiers.length && MEMBERSHIP_TIERS.length === 0) {
      return NextResponse.json({ status: summary.status, expiry: summary.expiry });
    }
    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
