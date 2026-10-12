import { cn } from "@/lib/utils"

/** Usage bar that stays visible for tiny amounts, so "some" never looks like "none". */
export function UsageBar({ used, quota }: { used: number; quota: number }) {
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${used > 0 ? Math.max(pct, 2) : 0}%` }} />
    </div>
  )
}

/**
 * The same figure drawn as a row of small pills: easier to read at a glance
 * than a thin line, and the filled ones carry a faint glow.
 */
export function SegmentedUsage({
  used,
  quota,
  segments = 40,
  glow,
  className,
}: {
  used: number
  quota: number
  segments?: number
  /** Lit style for the settings card: filled pills glow, empty ones are pressed in. Follows the theme. */
  glow?: boolean
  className?: string
}) {
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0
  const filled = used > 0 ? Math.max(1, Math.round((pct / 100) * segments)) : 0
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("flex h-5 items-stretch gap-[3px]", className)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cn(
            "min-w-0 flex-1 rounded-full transition-colors",
            glow
              ? i < filled
                ? "bg-emerald-500 shadow-[0_0_12px_0_rgb(16_185_129/0.45)] dark:bg-lime dark:shadow-[0_0_14px_1px_color-mix(in_oklch,var(--lime)_60%,transparent)]"
                : "bg-foreground/[0.07] shadow-[inset_0_1px_2px_rgb(0_0_0/0.12)] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]"
              : i < filled
                ? "bg-primary shadow-[0_0_10px_-2px_var(--primary)]"
                : "bg-foreground/[0.07]"
          )}
        />
      ))}
    </div>
  )
}

export function percentOf(used: number, quota: number) {
  return quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0
}
