import { currentLang, t } from "@/lib/i18n"

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} ${t("B")}`
  const units = [t("KB"), t("MB"), t("GB"), t("TB")]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const digits = v >= 100 ? 0 : 1
  const num = v.toLocaleString(currentLang(), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })
  return `${num} ${units[i]}`
}

export function relativeTime(unixSeconds: number): string {
  const rtf = new Intl.RelativeTimeFormat(currentLang(), { numeric: "auto" })
  const diff = unixSeconds - Date.now() / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), "second")
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute")
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour")
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day")
  return new Date(unixSeconds * 1000).toLocaleDateString(currentLang(), { dateStyle: "medium" })
}

export function shortDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(currentLang(), { month: "short", day: "numeric", year: "numeric" })
}

export const EXPIRY_OPTIONS = [
  { label: "1 hour", hint: "For a quick hand-off", value: 3600 },
  { label: "1 day", hint: "A sensible default", value: 86400 },
  { label: "7 days", hint: "Enough time for a busy week", value: 7 * 86400 },
  { label: "30 days", hint: "Longer-lived sharing", value: 30 * 86400 },
  { label: "Never", hint: "Until you revoke it", value: 0 },
] as const

export const VIEW_OPTIONS = [
  { label: "Burn after reading", hint: "Destroyed after the first open", value: 1 },
  { label: "5 views", hint: "A small group", value: 5 },
  { label: "25 views", hint: "A team or a class", value: 25 },
  { label: "Unlimited", hint: "Only time limits it", value: 0 },
] as const
