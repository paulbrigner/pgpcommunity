'use client'

import * as React from "react"

import { cn } from "@/lib/utils"

interface DrawerProps {
  isOpen: boolean
  onOpenChange?: (open: boolean) => void
  title?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function Drawer({
  isOpen,
  onOpenChange,
  title,
  className,
  children,
}: DrawerProps) {
  React.useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange?.(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onOpenChange])

  React.useEffect(() => {
    if (!isOpen) return
    const original = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = original
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
        onClick={() => onOpenChange?.(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 w-full max-w-md rounded-t-2xl bg-white shadow-xl transition-transform sm:max-w-lg sm:rounded-2xl",
          className,
        )}
      >
        {(title || onOpenChange) && (
          <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
            {title && (
              <div className="text-base font-semibold text-[var(--brand-navy)]">
                {typeof title === "string" ? title : title}
              </div>
            )}
            {onOpenChange && (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-full p-2 text-[var(--muted-ink)] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                aria-label="Close drawer"
              >
                <span aria-hidden="true">x</span>
              </button>
            )}
          </div>
        )}
        <div className="max-h-[min(80vh,600px)] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
