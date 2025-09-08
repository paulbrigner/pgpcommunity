"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Crown, UserRound, Wallet } from "lucide-react";
import { LinkWalletButton } from "./LinkWalletButton";

type MembershipStatus = "active" | "expired" | "none";

export function OnboardingChecklist({
  walletLinked,
  profileComplete,
  membershipStatus,
  onPurchaseMembership,
  purchasing,
}: {
  walletLinked: boolean;
  profileComplete: boolean;
  membershipStatus: MembershipStatus;
  onPurchaseMembership?: () => Promise<void> | void;
  purchasing?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  const Item = ({ done, icon, title, action }: { done: boolean; icon: React.ReactNode; title: string; action?: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-primary">{icon}</div>
        <div>
          <div className="font-medium text-sm">{title}</div>
          {done ? (
            <div className="text-xs text-muted-foreground">Completed</div>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Getting started</h2>
      <div className="grid gap-3">
        <Item
          done={profileComplete}
          icon={profileComplete ? <CheckCircle2 className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
          title="Complete your profile"
          action={
            profileComplete ? null : (
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/profile">Edit Profile</Link>
              </Button>
            )
          }
        />
        <Item
          done={walletLinked}
          icon={walletLinked ? <CheckCircle2 className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
          title="Link your wallet"
          action={
            walletLinked ? null : (
              <LinkWalletButton onError={(m) => setError(m)} />
            )
          }
        />
        <Item
          done={membershipStatus === "active"}
          icon={membershipStatus === "active" ? <CheckCircle2 className="h-5 w-5" /> : <Crown className="h-5 w-5" />}
          title={
            membershipStatus === "active"
              ? "Membership active"
              : membershipStatus === "expired"
              ? "Membership expired"
              : "Get membership"
          }
          action={
            membershipStatus === "active" ? null : (
              <Button size="sm" onClick={() => onPurchaseMembership?.()} disabled={purchasing}>
                {purchasing ? "Processing…" : membershipStatus === "expired" ? "Renew Membership" : "Get Membership"}
              </Button>
            )
          }
        />
      </div>
      {error && (
        <Alert className="border-destructive/50">
          <AlertDescription className="text-destructive">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
