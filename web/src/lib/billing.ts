import { api, type Interval, type Me, type Plan } from "./api"
import { currentLang } from "./i18n"

export function formatPrice(p: Pick<Plan, "amount" | "currency">): string {
  return formatAmount(p.amount, p.currency)
}

/** An amount in minor units, always with two decimals: a price is not rounded to a whole unit. */
export function formatAmount(minor: number, currency: string): string {
  return new Intl.NumberFormat(currentLang(), {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)
}

/** What a plan costs for an interval, or null if it is not sold that way. */
export function priceFor(p: Plan, interval: Interval): number | null {
  return p.prices[interval] ?? null
}

/** Months of a year that the yearly price leaves out, e.g. 2. Zero when there is no yearly price or no saving. */
export function monthsFree(plans: Plan[]): number {
  const p = plans.find((x) => x.prices.year)
  if (!p?.prices.year) return 0
  return Math.max(0, Math.round((12 * p.prices.month - p.prices.year) / p.prices.month))
}

/** Sends the browser to the checkout for a plan. Resolves only if that fails. */
export async function startCheckout(plan: string, interval: Interval) {
  const { url } = await api<{ url: string }>("/api/billing/checkout", { body: { plan, interval } })
  location.assign(url)
}

/** Paddle's customer portal in a new tab: payment method, invoices, cancelling. */
export async function openPortal() {
  // Opened before the request, while the click still counts, so it is not blocked as a pop-up.
  const tab = window.open("", "_blank")
  try {
    const { url } = await api<{ url: string }>("/api/billing/portal", { method: "POST" })
    if (!tab) return location.assign(url)
    tab.opener = null
    tab.location.href = url
  } catch (e) {
    tab?.close()
    throw e
  }
}

/** Takes back a cancellation that has not happened yet: the plan renews as before. */
export const resumePlan = () => api<Me>("/api/billing/resume", { method: "POST" })

export const changePlan = (plan: string, interval: Interval) => api<Me>("/api/billing/plan", { body: { plan, interval } })

/** What switching to another plan or interval would charge now, from Paddle. `credit` is added to later bills. */
export type ChangePreview = {
  action: "charge" | "credit" | "none"
  amount: number
  currency: string
  nextBilledAt?: number
  fromCredit?: boolean
}
export const previewPlan = (plan: string, interval: Interval) =>
  api<ChangePreview>("/api/billing/plan/preview", { body: { plan, interval } })
export const syncBilling = () => api<Me>("/api/billing/sync", { method: "POST" })
