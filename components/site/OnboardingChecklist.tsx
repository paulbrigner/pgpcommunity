"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Circle } from "lucide-react";
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

  const Item = ({ done, icon, title, description, action }: { done: boolean; icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${done ? "text-emerald-600" : "text-muted-foreground"}`}>{icon}</div>
        <div>
          <div className="font-medium text-sm">{title}</div>
          {description ? (
            <div className="text-xs text-muted-foreground">{description}</div>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );

  const requiredRemaining = (walletLinked ? 0 : 1) + (membershipStatus === "active" ? 0 : 1);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Getting started</h2>
      <p className="text-sm text-muted-foreground">
        {requiredRemaining === 0
          ? "All core steps completed."
          : `${requiredRemaining} required step${requiredRemaining > 1 ? "s" : ""} remaining to activate your membership.`}
      </p>
      <div className="grid gap-3">
        <Item
          done={profileComplete}
          icon={profileComplete ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
          title={profileComplete ? "Profile complete" : "Complete your profile"}
          description={
            profileComplete
              ? "Your profile details are saved. You can update them anytime."
              : "Add your name and optional info so members know who you are."
          }
          action={
            <Button asChild variant={profileComplete ? "outline" : "default"} size="sm">
              <Link href="/settings/profile">Complete Profile</Link>
            </Button>
          }
        />
        <Item
          done={walletLinked}
          icon={walletLinked ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
          title={walletLinked ? "Wallet linked" : "Link your wallet"}
          description={
            walletLinked
              ? "Your wallet is ready for automatic renewals and POAPs."
              : "Connect your wallet to unlock membership features."
          }
          action={
            walletLinked ? null : (
              <LinkWalletButton onError={(m) => setError(m)} />
            )
          }
        />
        <Item
          done={membershipStatus === "active"}
          icon={membershipStatus === "active" ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
          title={
            membershipStatus === "active"
              ? "Membership active"
              : membershipStatus === "expired"
              ? "Renew membership (required)"
              : "Get membership (required)"
          }
          description={
            membershipStatus === "active"
              ? "You're ready to access member-only content."
              : "Purchase the community membership to activate your benefits."
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
