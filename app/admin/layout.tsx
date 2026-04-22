import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import type { ReactNode } from "react";
import type { Session } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { AdminShell } from "@/components/admin/AdminShell";
import { isAdminSession } from "@/lib/admin/auth";

export const metadata = {
  title: "Admin | PGP Community",
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = (await getServerSession(authOptions as any)) as Session | null;
  if (!session) {
    redirect("/signin?callbackUrl=/admin");
  }
  if (!isAdminSession(session)) {
    redirect("/");
  }

  const user = (session as any).user || {};
  const name = user.name || [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || "Admin";
  const email = typeof user.email === "string" ? user.email : null;

  return (
    <AdminShell name={name} email={email}>
      {children}
    </AdminShell>
  );
}
