"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

export type MembershipMetadataFormValues = {
  name: string;
  description: string;
  imageUrl: string;
  tierOrder: number;
  status: "draft" | "published";
};

type Props = {
  initialValues?: Partial<MembershipMetadataFormValues>;
  onSubmit: (values: MembershipMetadataFormValues) => Promise<void>;
  onCancel?: () => void;
};

export function MembershipMetadataForm({ initialValues, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<MembershipMetadataFormValues>({
    name: initialValues?.name ?? "",
    description: initialValues?.description ?? "",
    imageUrl: initialValues?.imageUrl ?? "",
    tierOrder: initialValues?.tierOrder ?? 0,
    status: initialValues?.status === "published" ? "published" : "draft",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const missingRequired = useMemo(() => {
    if (!values.name.trim()) return ["name"];
    return [];
  }, [values]);

  const handleChange =
    (field: keyof MembershipMetadataFormValues) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const nextValue = event.target.value;
      setValues((prev) => ({
        ...prev,
        [field]: field === "tierOrder" ? Number(nextValue) || 0 : nextValue,
      }));
    };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (missingRequired.length) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        ...values,
        name: values.name.trim(),
        description: values.description.trim(),
        imageUrl: values.imageUrl.trim(),
      });
      setNotice(values.status === "published" ? "Metadata published." : "Draft saved.");
    } catch (err: any) {
      setError(err?.message || "Failed to save metadata.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-sm">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
            Status
          </span>
          <select
            value={values.status}
            onChange={handleChange("status")}
            className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
          >
            <option value="draft">Draft (admins only)</option>
            <option value="published">Published</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
            Display Name *
          </span>
          <input
            value={values.name}
            onChange={handleChange("name")}
            placeholder="e.g. Holder"
            className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
          />
        </label>
      </div>

      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
          Description
        </span>
        <textarea
          value={values.description}
          onChange={handleChange("description")}
          rows={4}
          className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
            Image URL
          </span>
          <input
            value={values.imageUrl}
            onChange={handleChange("imageUrl")}
            placeholder="https://... or ipfs://..."
            className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
            Tier Order
          </span>
          <input
            type="number"
            value={values.tierOrder}
            onChange={handleChange("tierOrder")}
            className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
          />
        </label>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {notice}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving} isLoading={saving}>
          Save metadata
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
