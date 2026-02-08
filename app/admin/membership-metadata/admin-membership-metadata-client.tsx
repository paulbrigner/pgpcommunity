"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  MembershipMetadataForm,
  type MembershipMetadataFormValues,
} from "@/components/admin/MembershipMetadataForm";

type MembershipMetadata = {
  pk: string;
  sk: string;
  lockAddress: string;
  status: "draft" | "published";
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  tierOrder: number;
  updatedAt?: string | null;
};

type TierEntry = {
  lockAddress: string;
  checksumAddress: string;
  tierId: string;
  configLabel: string | null;
  onChainName: string | null;
  order: number;
  hasMetadata: boolean;
  metadata: MembershipMetadata | null;
};

export default function AdminMembershipMetadataClient() {
  const [tiers, setTiers] = useState<TierEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLock, setExpandedLock] = useState<string | null>(null);

  const fetchTiers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/membership-metadata", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Failed to load tiers.");
      setTiers(Array.isArray(payload?.tiers) ? payload.tiers : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load tiers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTiers();
  }, [fetchTiers]);

  const handleSave = async (lockAddress: string, values: MembershipMetadataFormValues) => {
    const res = await fetch("/api/admin/membership-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lockAddress,
        name: values.name,
        description: values.description,
        imageUrl: values.imageUrl,
        tierOrder: values.tierOrder,
        status: values.status,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || "Failed to save metadata.");
    await fetchTiers();
  };

  return (
    <div className="space-y-5">
      <div className="glass-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-eyebrow text-[var(--brand-denim)]">Membership</p>
            <h2 className="text-2xl font-semibold text-[#0b0b43]">Tier metadata</h2>
            <p className="text-sm text-muted-foreground">
              Self-hosted metadata for membership tier NFTs. Published metadata is served via the tokenURI endpoint.
            </p>
          </div>
          <Button variant="ghost" onClick={fetchTiers} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="glass-item p-6 text-sm text-[var(--muted-ink)]">Loading tiers...</div>
      ) : error ? (
        <div className="glass-item border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
          {error}
        </div>
      ) : tiers.length === 0 ? (
        <div className="glass-item p-6 text-sm text-[var(--muted-ink)]">No membership tiers configured.</div>
      ) : (
        <div className="space-y-4">
          {tiers.map((tier) => {
            const isExpanded = expandedLock === tier.lockAddress;
            const meta = tier.metadata;
            const displayName = meta?.name || tier.configLabel || tier.onChainName || "Unnamed tier";
            const status = meta?.status || "missing";
            return (
              <div key={tier.lockAddress} className="glass-item p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted-ink)]">
                      {status}
                    </div>
                    <h3 className="text-lg font-semibold text-[var(--brand-navy)]">
                      {displayName}
                    </h3>
                    {tier.onChainName && tier.onChainName !== displayName ? (
                      <div className="text-xs text-[var(--muted-ink)]">
                        On-chain: {tier.onChainName}
                      </div>
                    ) : null}
                    {tier.configLabel ? (
                      <div className="text-xs text-[var(--muted-ink)]">
                        Config label: {tier.configLabel} (order {tier.order})
                      </div>
                    ) : null}
                    <div className="mt-2 text-xs text-[var(--muted-ink)]">
                      Lock: {tier.checksumAddress}
                    </div>
                  </div>
                  <Button onClick={() => setExpandedLock(isExpanded ? null : tier.lockAddress)}>
                    {isExpanded ? "Close editor" : "Edit metadata"}
                  </Button>
                </div>

                {isExpanded ? (
                  <div className="mt-5">
                    <MembershipMetadataForm
                      initialValues={{
                        name: meta?.name ?? tier.configLabel ?? "",
                        description: meta?.description ?? "",
                        imageUrl: meta?.imageUrl ?? "",
                        tierOrder: meta?.tierOrder ?? tier.order,
                        status: meta?.status === "published" ? "published" : "draft",
                      }}
                      onSubmit={(values) => handleSave(tier.lockAddress, values)}
                      onCancel={() => setExpandedLock(null)}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
