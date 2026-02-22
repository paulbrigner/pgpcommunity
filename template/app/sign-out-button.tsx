"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      className="button button-secondary"
      onClick={() => signOut({ callbackUrl: "/signin" })}
      type="button"
    >
      Sign out
    </button>
  );
}
