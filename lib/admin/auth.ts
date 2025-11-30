import 'server-only';

import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export class AdminAccessError extends Error {
  constructor(message = "Admin access required") {
    super(message);
    this.name = "AdminAccessError";
  }
}

export async function getAdminSession(): Promise<Session | null> {
  const session = (await getServerSession(authOptions as any)) as Session | null;
  if (!session?.user?.isAdmin) return null;
  return session as Session;
}

export async function requireAdminSession(): Promise<Session> {
  const session = await getAdminSession();
  if (!session) {
    throw new AdminAccessError();
  }
  return session;
}

export function isAdminSession(session: Session | null | undefined): boolean {
  return !!session?.user?.isAdmin;
}
