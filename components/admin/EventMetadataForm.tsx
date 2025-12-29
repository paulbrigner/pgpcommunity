"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EventMetadataFormValues = {
  titleOverride: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  location: string;
  imageUrl: string;
  status: "draft" | "published";
};

type Props = {
  initialValues?: Partial<EventMetadataFormValues>;
  onSubmit: (values: EventMetadataFormValues) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  compact?: boolean;
};

const requiredFields: Array<keyof EventMetadataFormValues> = [
  "description",
  "date",
  "startTime",
  "endTime",
  "timezone",
  "location",
  "imageUrl",
];

const normalizeField = (value: string) => value.trim();
const DEFAULT_TIMEZONE = "America/New_York";
const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "America/New_York (ET)" },
  { value: "America/Chicago", label: "America/Chicago (CT)" },
  { value: "America/Denver", label: "America/Denver (MT)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
  { value: "America/Phoenix", label: "America/Phoenix (MST)" },
  { value: "America/Anchorage", label: "America/Anchorage (AKT)" },
  { value: "Pacific/Honolulu", label: "Pacific/Honolulu (HST)" },
  { value: "UTC", label: "UTC" },
];

export function EventMetadataForm({
  initialValues,
  onSubmit,
  onCancel,
  submitLabel = "Save metadata",
  compact = false,
}: Props) {
  const [values, setValues] = useState<EventMetadataFormValues>({
    titleOverride: initialValues?.titleOverride ?? "",
    description: initialValues?.description ?? "",
    date: initialValues?.date ?? "",
    startTime: initialValues?.startTime ?? "",
    endTime: initialValues?.endTime ?? "",
    timezone: initialValues?.timezone?.trim() || DEFAULT_TIMEZONE,
    location: initialValues?.location ?? "",
    imageUrl: initialValues?.imageUrl ?? "",
    status: initialValues?.status === "published" ? "published" : "draft",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const missingRequired = useMemo(() => {
    if (values.status !== "published") return [];
    return requiredFields.filter((field) => !normalizeField(values[field]));
  }, [values]);

  const handleChange = (field: keyof EventMetadataFormValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const nextValue = event.target.value;
    setValues((prev) => ({ ...prev, [field]: nextValue }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (missingRequired.length) {
      setError(`Missing required fields: ${missingRequired.join(", ")}`);
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        ...values,
        titleOverride: normalizeField(values.titleOverride),
        description: normalizeField(values.description),
        date: normalizeField(values.date),
        startTime: normalizeField(values.startTime),
        endTime: normalizeField(values.endTime),
        timezone: normalizeField(values.timezone),
        location: normalizeField(values.location),
        imageUrl: normalizeField(values.imageUrl),
      });
      setNotice(values.status === "published" ? "Event published." : "Draft saved.");
    } catch (err: any) {
      setError(err?.message || "Failed to save event details.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", compact ? "text-sm" : "text-sm")}>
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
            Title override (optional)
          </span>
          <input
            value={values.titleOverride}
            onChange={handleChange("titleOverride")}
            placeholder="Override the on-chain name"
            className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
          />
        </label>
      </div>

      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">
          Description (Markdown)
        </span>
        <textarea
          value={values.description}
          onChange={handleChange("description")}
          rows={compact ? 6 : 10}
          className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">Date</span>
          <input
            value={values.date}
            onChange={handleChange("date")}
            placeholder="YYYY-MM-DD"
            className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">Timezone</span>
          <select
            value={values.timezone}
            onChange={handleChange("timezone")}
            className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
          >
            {values.timezone && !TIMEZONE_OPTIONS.some((option) => option.value === values.timezone) ? (
              <option value={values.timezone}>{values.timezone} (custom)</option>
            ) : null}
            {TIMEZONE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">Start time</span>
          <input
            value={values.startTime}
            onChange={handleChange("startTime")}
            placeholder="09:00"
            className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">End time</span>
          <input
            value={values.endTime}
            onChange={handleChange("endTime")}
            placeholder="11:00"
            className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
          />
        </label>
      </div>

      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">Location</span>
        <input
          value={values.location}
          onChange={handleChange("location")}
          placeholder="Event location"
          className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
        />
      </label>

      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-ink)]">Image URL</span>
        <input
          value={values.imageUrl}
          onChange={handleChange("imageUrl")}
          placeholder="https://..."
          className="w-full rounded-md border border-[rgba(11,11,67,0.18)] bg-white px-3 py-2 text-sm text-[#0b0b43] shadow-inner outline-none transition focus:border-[rgba(67,119,243,0.5)] focus:ring-2 focus:ring-[rgba(67,119,243,0.12)]"
        />
      </label>

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
          {submitLabel}
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
