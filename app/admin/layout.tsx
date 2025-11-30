import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { ShieldCheck } from "lucide-react";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isAdminSession } from "@/lib/admin/auth";

export const metadata = {
  title: "Admin | PGP Community",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
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
    <div className="mx-auto max-w-6xl space-y-6 px-5 pb-14">
      <div className="glass-surface relative overflow-hidden border border-white/40 bg-white/80 p-6 shadow-[0_26px_46px_-26px_rgba(11,11,67,0.38)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <p className="section-eyebrow text-[var(--brand-denim)]">Admin Console</p>
            <h1 className="text-3xl font-semibold text-[#0b0b43] sm:text-3xl">PGP Community</h1>
            <p className="text-sm text-muted-foreground">
              Signed in as {name}
              {email ? ` - ${email}` : ""}. Admin tools surface membership health, wallets, and messaging.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(67,119,243,0.3)] bg-[rgba(67,119,243,0.08)] px-4 py-2 text-[0.9rem] font-semibold text-[var(--brand-denim)] shadow-[0_10px_30px_-18px_rgba(11,11,67,0.45)]">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            Admin access
          </div>
        </div>
        <div className="pointer-events-none absolute -left-14 -top-20 h-36 w-36 rounded-full bg-[rgba(67,119,243,0.15)] blur-3xl" />
        <div className="pointer-events-none absolute -right-6 bottom-0 h-24 w-24 rounded-full bg-[rgba(11,11,67,0.08)] blur-3xl" />
      </div>
      {children}
    </div>
  );
}
