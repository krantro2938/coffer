export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

export function relativeTime(unixSeconds: number): string {
  const diff = unixSeconds - Date.now() / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), "second")
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute")
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour")
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day")
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { dateStyle: "medium" })
}

export function shortDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export const EXPIRY_OPTIONS = [
  { label: "1 hour", value: 3600 },
  { label: "1 day", value: 86400 },
  { label: "7 days", value: 7 * 86400 },
  { label: "30 days", value: 30 * 86400 },
  { label: "Never", value: 0 },
] as const

export const VIEW_OPTIONS = [
  { label: "Burn after reading", value: 1 },
  { label: "5 views", value: 5 },
  { label: "25 views", value: 25 },
  { label: "Unlimited", value: 0 },
] as const
