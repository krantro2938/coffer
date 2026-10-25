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
  charge,
  className,
}: {
  used: number
  quota: number
  segments?: number
  /** Lit style for the settings card: filled pills glow, empty ones are pressed in. Follows the theme. */
  glow?: boolean
  /**
   * Builds the bar as it appears: the pills arrive one after another, left to
   * right, already in their final colour.
   */
  charge?: boolean
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
      {Array.from({ length: segments }, (_, i) => {
        const lit = glow
          ? "bg-emerald-500 shadow-[0_0_12px_0_rgb(16_185_129/0.45)] dark:bg-lime dark:shadow-[0_0_14px_1px_color-mix(in_oklch,var(--lime)_60%,transparent)]"
          : "bg-primary shadow-[0_0_10px_-2px_var(--primary)]"
        const unlit = glow
          ? "bg-foreground/[0.07] shadow-[inset_0_1px_2px_rgb(0_0_0/0.12)] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]"
          : "bg-foreground/[0.07]"
        const on = i < filled
        // Each pill takes its turn a beat after the one before it.
        const delay = charge ? { animationDelay: `${80 + i * 9}ms` } : undefined
        return (
          <span
            key={i}
            className={cn("min-w-0 flex-1 rounded-full transition-colors", on ? lit : unlit, charge && "animate-pill-in")}
            style={delay}
          />
        )
      })}
    </div>
  )
}

/** The same figure as a ring, for the collapsed sidebar: small enough to sit where the bar can't, with the percentage inside. */
export function UsageRing({ used, quota, className }: { used: number; quota: number; className?: string }) {
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0
  const r = 15.5
  const length = 2 * Math.PI * r
  const shown = used > 0 ? Math.max(pct, 3) : 0
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("relative grid size-10 place-items-center", className)}
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-foreground/[0.07]" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(shown / 100) * length} ${length}`}
          className={cn("stroke-primary transition-[stroke-dasharray] duration-500", shown === 0 && "opacity-0")}
        />
      </svg>
      <span className="text-[0.625rem] font-medium text-muted-foreground tabular-nums">{percentOf(used, quota)}</span>
    </div>
  )
}

export function percentOf(used: number, quota: number) {
  return quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0
}
