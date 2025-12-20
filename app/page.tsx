import { getServerSession } from "next-auth";
import dynamic from "next/dynamic";
import { Suspense } from "react";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { HomeShellSkeleton } from "@/components/home/Skeletons";

const HomeClient = dynamic(() => import("./home-client"), {
  loading: () => <HomeShellSkeleton />,
});

export default async function HomePage() {
  const session = await getServerSession(authOptions as any);
  const sessionUser = (session as any)?.user || null;
  const rawStatus = sessionUser?.membershipStatus;
  const initialStatus =
    rawStatus === "active" || rawStatus === "expired" || rawStatus === "none" ? rawStatus : "unknown";
  const initialExpiry =
    typeof sessionUser?.membershipExpiry === "number" ? (sessionUser.membershipExpiry as number) : null;

  return (
    <Suspense fallback={<HomeShellSkeleton />}>
      <HomeClient
        initialMembershipSummary={null}
        initialMembershipStatus={initialStatus}
        initialMembershipExpiry={initialExpiry}
        initialAllowancesLoaded={false}
      />
    </Suspense>
  );
}
