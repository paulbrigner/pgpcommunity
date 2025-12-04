import { useCallback } from "react";
import { MEMBERSHIP_TIERS } from "@/lib/config";
import { normalizeTierId } from "@/lib/membership-tiers";
import { getEventCheckoutTarget } from "@/lib/checkout-config";

export type EventDetails = {
  title?: string | null;
  date?: string | null;
  time?: string | null;
  location?: string | null;
  description?: string | null;
} | null;

type SetSelectedTier = (value: string | null) => void;

export function useEventRegistration(
  setSelectedTierId: SetSelectedTier,
  openMembershipCheckout: (checksumAddress?: string) => void,
  openEventCheckout: (lockAddress: string, eventDetails?: EventDetails) => void,
) {
  return useCallback(
    (lockAddress: string | null | undefined, fallbackUrl?: string | null, eventDetails?: EventDetails) => {
      if (!lockAddress) {
        if (fallbackUrl) {
          window.open(fallbackUrl, "_blank", "noreferrer");
        }
        return;
      }
      const normalized = lockAddress.trim().toLowerCase();
      const tierMatch =
        MEMBERSHIP_TIERS.find((tier) => {
          const keys = [tier.id, tier.address, tier.checksumAddress]
            .map((value) => (value ? String(value).toLowerCase() : ""))
            .filter(Boolean);
          return keys.includes(normalized);
        }) ?? null;
      if (tierMatch) {
        setSelectedTierId(normalizeTierId(tierMatch.id) ?? tierMatch.checksumAddress ?? tierMatch.address);
        openMembershipCheckout(tierMatch.checksumAddress);
        return;
      }
      const eventTarget = getEventCheckoutTarget(normalized);
      if (eventTarget) {
        openEventCheckout(eventTarget.checksumAddress, eventDetails ?? null);
        return;
      }
      if (fallbackUrl) {
        window.open(fallbackUrl, "_blank", "noreferrer");
      }
    },
    [openEventCheckout, openMembershipCheckout, setSelectedTierId],
  );
}
