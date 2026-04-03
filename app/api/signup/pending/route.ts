import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Pending signup wallet linking is no longer supported. Sign in with email, then link your wallet from your account settings.",
    },
    { status: 410 }
  );
}
