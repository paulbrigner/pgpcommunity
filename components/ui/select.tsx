'use client'

import * as React from "react"

import { cn } from "@/lib/utils"

type SelectOption = {
  label: string
  value: string
  disabled?: boolean
}

interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  label?: React.ReactNode
  options: SelectOption[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
}

export function Select({
  label,
  options,
  className,
  onChange,
  id,
  value,
  defaultValue,
  ...props
}: SelectProps) {
  const generatedId = React.useId()
  const selectId = id ?? generatedId

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-medium text-[var(--brand-navy)]"
        >
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={cn(
          "rounded-lg border border-[rgba(67,119,243,0.35)] bg-white px-3 py-2 text-sm text-[var(--brand-navy)] focus-visible:border-[var(--brand-denim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(67,119,243,0.2)]",
          className,
        )}
        onChange={(event) => onChange?.(event.target.value)}
        value={value}
        defaultValue={defaultValue}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
