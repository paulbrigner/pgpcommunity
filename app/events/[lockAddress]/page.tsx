import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { EventDetailsClient } from "./event-details-client";

type PageProps = {
  params: Promise<{ lockAddress: string }>;
};

export default async function EventDetailsPage({ params }: PageProps) {
  const { lockAddress } = await params;
  const session = await getServerSession(authOptions as any);
  const user = (session as any)?.user || null;
  if (!user) {
    redirect(`/signin?callbackUrl=/events/${encodeURIComponent(lockAddress)}`);
  }
  const isAdmin = Boolean(user?.isAdmin);
  const status = user?.membershipStatus;
  if (!isAdmin && status !== "active") {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="glass-surface p-6 text-center text-sm text-[var(--muted-ink)] md:p-8">
          Membership is required to view event details.
        </div>
      </div>
    );
  }
  return <EventDetailsClient lockAddress={lockAddress} />;
}
