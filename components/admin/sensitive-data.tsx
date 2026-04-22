"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SensitiveDataKind = "email" | "name" | "generic";

type AdminSensitiveDataContextValue = {
  sensitiveDataVisible: boolean;
  toggleSensitiveDataVisibility: () => void;
};

const AdminSensitiveDataContext = createContext<AdminSensitiveDataContextValue | null>(null);

const MASKABLE_CHARACTER = /[A-Za-z0-9]/;

function maskToken(value: string): string {
  const characters = Array.from(value);
  const maskableCount = characters.filter((character) => MASKABLE_CHARACTER.test(character)).length;
  if (!maskableCount) return value;

  let seenMaskable = 0;
  return characters
    .map((character) => {
      if (!MASKABLE_CHARACTER.test(character)) return character;
      seenMaskable += 1;
      if (maskableCount === 1) return "*";
      return seenMaskable === 1 ? character : "*";
    })
    .join("");
}

function maskEmail(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const atIndex = trimmed.indexOf("@");
  if (atIndex === -1) return maskToken(trimmed);

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (!local || !domain) return maskToken(trimmed);

  const domainParts = domain.split(".");
  const root = domainParts[0] || "";
  const suffix = domainParts.length > 1 ? `.${domainParts.slice(1).join(".")}` : "";
  return `${maskToken(local)}@${maskToken(root)}${suffix}`;
}

function maskName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => maskToken(token))
    .join(" ");
}

function maskGeneric(value: string): string {
  return maskToken(value.trim());
}

export function maskSensitiveValue(value: string | null | undefined, kind: SensitiveDataKind = "generic"): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";

  if (kind === "email") return maskEmail(trimmed);
  if (kind === "name") return maskName(trimmed);
  return trimmed.includes("@") ? maskEmail(trimmed) : maskGeneric(trimmed);
}

export function formatSensitiveValue(
  value: string | null | undefined,
  kind: SensitiveDataKind = "generic",
  visible: boolean,
): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  return visible ? trimmed : maskSensitiveValue(trimmed, kind);
}

export function AdminSensitiveDataProvider({
  children,
  defaultVisible = false,
}: {
  children: ReactNode;
  defaultVisible?: boolean;
}) {
  const [sensitiveDataVisible, setSensitiveDataVisible] = useState(defaultVisible);

  return (
    <AdminSensitiveDataContext.Provider
      value={{
        sensitiveDataVisible,
        toggleSensitiveDataVisibility: () => setSensitiveDataVisible((previous) => !previous),
      }}
    >
      {children}
    </AdminSensitiveDataContext.Provider>
  );
}

export function useAdminSensitiveData() {
  const context = useContext(AdminSensitiveDataContext);
  if (!context) {
    throw new Error("useAdminSensitiveData must be used within AdminSensitiveDataProvider");
  }
  return context;
}

export function SensitiveDataToggleButton({ className }: { className?: string }) {
  const { sensitiveDataVisible, toggleSensitiveDataVisibility } = useAdminSensitiveData();
  const Icon = sensitiveDataVisible ? EyeOff : Eye;

  return (
    <Button
      type="button"
      variant="outlined-primary"
      size="sm"
      className={cn("w-full whitespace-nowrap sm:w-auto", className)}
      onClick={toggleSensitiveDataVisibility}
      aria-pressed={sensitiveDataVisible}
      aria-label={sensitiveDataVisible ? "Hide sensitive details" : "Show sensitive details"}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {sensitiveDataVisible ? "Hide names & emails" : "Show names & emails"}
    </Button>
  );
}

export function SensitiveDataText({
  value,
  kind = "generic",
  fallback = null,
  className,
}: {
  value: string | null | undefined;
  kind?: SensitiveDataKind;
  fallback?: ReactNode;
  className?: string;
}) {
  const { sensitiveDataVisible } = useAdminSensitiveData();
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (!trimmed) {
    return fallback ? <>{fallback}</> : null;
  }

  return (
    <span
      className={cn(
        !sensitiveDataVisible && "select-none blur-[0.12rem] tracking-[0.04em]",
        className,
      )}
    >
      {sensitiveDataVisible ? trimmed : maskSensitiveValue(trimmed, kind)}
    </span>
  );
}
