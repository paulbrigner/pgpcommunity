import dynamicImport from "next/dynamic";
import { buildAdminRoster } from "@/lib/admin/roster";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { AdminShellSkeleton } from "@/components/admin/AdminSkeleton";

export const dynamic = "force-dynamic";

const AdminClient = dynamicImport(() => import("./admin-client"), {
  loading: () => <AdminShellSkeleton />,
});

export default async function AdminPage() {
  let roster = null;
  let adminUserId: string | null = null;
  try {
    const session = await getServerSession(authOptions as any);
    adminUserId = (session as any)?.user?.id || null;
  } catch (err) {
    console.error("Admin page session load failed", err);
  }
  try {
    roster = await buildAdminRoster({
      includeAllowances: false,
      includeBalances: false,
      includeTokenIds: false,
    });
  } catch (err) {
    console.error("Admin page failed to load roster", err);
  }
  return <AdminClient initialRoster={roster} currentAdminId={adminUserId} />;
}
