'use server';

import { NextResponse } from "next/server";
import { membershipStateService } from "@/lib/membership-state-service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const addresses = Array.isArray(body?.addresses)
      ? body.addresses.map((addr: any) => (typeof addr === "string" ? addr.trim().toLowerCase() : "")).filter(Boolean)
      : [];
    const chainId = typeof body?.chainId === "number" ? body.chainId : undefined;
    membershipStateService.invalidate(addresses, chainId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Invalid request" }, { status: 400 });
  }
}
