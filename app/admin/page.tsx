import dynamicImport from "next/dynamic";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { AdminShellSkeleton } from "@/components/admin/AdminSkeleton";

export const dynamic = "force-dynamic";

const AdminClient = dynamicImport(() => import("./admin-client"), {
  loading: () => <AdminShellSkeleton />,
});

export default async function AdminPage() {
  let adminUserId: string | null = null;
  try {
    const session = await getServerSession(authOptions as any);
    adminUserId = (session as any)?.user?.id || null;
  } catch (err) {
    console.error("Admin page session load failed", err);
  }
  return <AdminClient initialRoster={null} currentAdminId={adminUserId} />;
}
