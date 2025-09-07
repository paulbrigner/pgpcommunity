import { NextRequest, NextResponse } from 'next/server';
import { BASE_NETWORK_ID, BASE_RPC_URL, LOCK_ADDRESS } from '@/lib/config';
import { getStatusAndExpiry } from '@/lib/membership-server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const addrsParam = searchParams.get('addresses');
    const lock = (searchParams.get('lock') || LOCK_ADDRESS) as string;
    const rpcUrl = BASE_RPC_URL;
    const networkId = BASE_NETWORK_ID;

    if (!addrsParam || !addrsParam.trim()) {
      return NextResponse.json({ error: 'addresses query param required' }, { status: 400 });
    }
    const addresses = Array.from(new Set(addrsParam.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)));
    if (addresses.length === 0) {
      return NextResponse.json({ error: 'no valid addresses' }, { status: 400 });
    }

    const { status, expiry } = await getStatusAndExpiry(addresses, rpcUrl, networkId, lock);
    return NextResponse.json({ status, expiry });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
