/** Usage bar that stays visible for tiny amounts, so "some" never looks like "none". */
export function UsageBar({ used, quota }: { used: number; quota: number }) {
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${used > 0 ? Math.max(pct, 2) : 0}%` }} />
    </div>
  )
}
