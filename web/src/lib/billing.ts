import { api, type Me, type Plan } from "./api"
import { currentLang } from "./i18n"

export function formatPrice(p: Pick<Plan, "amount" | "currency">): string {
  return new Intl.NumberFormat(currentLang(), { style: "currency", currency: p.currency }).format(p.amount / 100)
}

/** Sends the browser to the checkout for a plan. Resolves only if that fails. */
export async function startCheckout(plan: string) {
  const { url } = await api<{ url: string }>("/api/billing/checkout", { body: { plan } })
  location.assign(url)
}

/** Paddle's customer portal: payment method, invoices, cancelling. */
export async function openPortal() {
  const { url } = await api<{ url: string }>("/api/billing/portal", { method: "POST" })
  location.assign(url)
}

export const changePlan = (plan: string) => api<Me>("/api/billing/plan", { body: { plan } })
export const syncBilling = () => api<Me>("/api/billing/sync", { method: "POST" })
