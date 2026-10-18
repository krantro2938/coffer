import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { CheckIcon, Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SlidingTabs } from "@/components/sliding-tabs"
import { getConfig, type Billing, type Interval, type Plan } from "@/lib/api"
import { formatAmount, formatPrice, monthsFree, priceFor, startCheckout } from "@/lib/billing"
import { formatBytes } from "@/lib/format"
import { currentLang, useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"

const blurbs: Record<string, string> = {
  starter: "For a few clients",
  plus: "For a growing practice",
  pro: "For a whole archive",
}

/** The free account's size until the server says (FREE_QUOTA_MB). */
const DEFAULT_FREE_QUOTA = 300 * 1024 ** 2

/** The paid drive sizes, or null where drives are free (or still loading). */
export function usePlans(): Plan[] | null {
  const { data } = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity })
  return data?.plans?.length ? data.plans : null
}

/** Whether the listed plans can be bought; false while they are shown ahead of going on sale. */
export function usePlansOpen(): boolean {
  const { data } = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity })
  return data?.plansOpen !== false
}

function useFreeQuota(): number {
  const { data } = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity })
  return data?.freeQuota ?? DEFAULT_FREE_QUOTA
}

export function PlanGrid({
  plans,
  current,
  currentInterval,
  label,
  busy,
  disabled,
  onPick,
  freeLabel,
  onPickFree,
}: {
  plans: Plan[]
  /** Plan the account is on, shown as such instead of offered. */
  current?: string | null
  /** How that plan bills; the same plan the other way round is offered as a switch. */
  currentInterval?: Interval
  label: (plan: Plan, interval: Interval) => string
  busy?: string | null
  disabled?: (plan: Plan) => boolean
  onPick: (plan: Plan, interval: Interval) => void
  /** Set on the landing page to put a Free card before the paid ones. */
  freeLabel?: string
  onPickFree?: () => void
}) {
  const { t } = useI18n()
  const freeQuota = useFreeQuota()
  const open = usePlansOpen()
  const featured = plans.length === 3 ? plans[1].id : null
  // Yearly unless a plan has no yearly price yet (the server was not set up for it).
  const yearly = plans.length > 0 && plans.every((p) => p.prices.year)
  const [interval, setInterval] = useState<Interval>(currentInterval ?? "year")
  const shown: Interval = yearly ? interval : "month"
  const free = monthsFree(plans)
  return (
    <div className="grid gap-5">
      {yearly && (
        <SlidingTabs
          fill
          value={shown}
          onChange={setInterval}
          className="mx-auto h-12 w-full max-w-sm text-base"
          tabs={[
            { value: "month", label: t("Monthly") },
            { value: "year", label: t("Yearly"), badge: free >= 2 ? t("{n} months free", { n: free }) : undefined },
          ]}
        />
      )}
      <div className={cn("grid gap-3", freeLabel ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
        {freeLabel && (
          <div className="flex flex-col rounded-3xl border bg-card p-6 text-left">
            <div className="flex h-5 items-center">
              <p className="eyebrow">{t("Free")}</p>
            </div>
            <p className="mt-5 text-4xl font-medium tracking-tight tabular-nums">
              {new Intl.NumberFormat(currentLang(), {
                style: "currency",
                currency: plans[0]?.currency ?? "EUR",
                maximumFractionDigits: 0,
              }).format(0)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t("per month")}</p>
            <div className="mt-6 flex-1 border-t pt-5">
              <p className="text-xl font-medium">{formatBytes(freeQuota)}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("For occasional requests")}</p>
              <ul className="mt-4 grid gap-2 text-sm">
                {["2 active request links", "Share links last up to 30 days"].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" /> {t(item)}
                  </li>
                ))}
              </ul>
            </div>
            <Button className="mt-8 w-full" variant="outline" onClick={onPickFree}>
              {freeLabel}
            </Button>
          </div>
        )}
        {plans.map((p) => {
          const on = p.id === featured
          const mine = p.id === current && (currentInterval === undefined || currentInterval === shown)
          const price = priceFor(p, shown) ?? p.amount
          return (
            <div
              key={p.id}
              className={cn(
                "flex flex-col rounded-3xl border p-6 text-left transition-shadow hover:shadow-soft",
                on ? "border-transparent bg-forest text-forest-foreground" : "bg-card"
              )}
            >
              <div className="flex h-5 items-center justify-between gap-2">
                <p className={cn("eyebrow", on && "text-forest-foreground/60")}>{p.name}</p>
                {mine && (
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                      on ? "bg-white/15" : "bg-secondary text-secondary-foreground"
                    )}
                  >
                    <CheckIcon className="size-3" /> {t("Your plan")}
                  </span>
                )}
              </div>
              {/* Yearly shows the month's share of the year, to the cent, with what is actually charged under it. */}
              <p className="mt-5 text-4xl font-medium tracking-tight tabular-nums">
                {formatAmount(shown === "year" ? price / 12 : price, p.currency)}
              </p>
              <p className={cn("mt-1 text-sm", on ? "text-forest-foreground/60" : "text-muted-foreground")}>
                {shown === "year"
                  ? `${t("per month")} · ${t("billed yearly, {price}", { price: formatAmount(price, p.currency) })}`
                  : t("per month")}
              </p>
              <div className={cn("mt-6 flex-1 border-t pt-5", on && "border-white/10")}>
                <p className="text-xl font-medium">{formatBytes(p.quota)}</p>
                <p className={cn("mt-1 text-sm", on ? "text-forest-foreground/70" : "text-muted-foreground")}>
                  {t(blurbs[p.id] ?? "For a whole archive")}
                </p>
                {freeLabel && (
                  <p className="mt-4 flex items-start gap-2 text-sm">
                    <CheckIcon className={cn("mt-0.5 size-4 shrink-0", on ? "text-lime" : "text-primary")} /> {t("Unlimited request links")}
                  </p>
                )}
              </div>
              <Button
                className="mt-8 w-full"
                variant={on ? "secondary" : "outline"}
                disabled={mine || !open || !!busy || disabled?.(p)}
                onClick={() => onPick(p, shown)}
              >
                {busy === p.id && <Loader2Icon className="animate-spin" />}
                {mine ? t("Your plan") : open ? label(p, shown) : t("Coming soon")}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PlanFinePrint({ className }: { className?: string }) {
  const { t } = useI18n()
  const open = usePlansOpen()
  return (
    <p className={cn("text-xs text-pretty text-muted-foreground", className)}>
      {t("Every plan: private files and names, secure sharing, unlimited folders. No ads, and no tracking across sites.")}{" "}
      {open
        ? t("Payment is handled by Paddle; we never see your card. Cancel whenever you like.")
        : t("Paid plans are not on sale yet. Until they are, every drive is a free drive.")}
    </p>
  )
}

/** The personal price an admin set for this account, shown above the listed plans. */
export function OfferCard({ offer, busy, onPick }: { offer: NonNullable<Billing["offer"]>; busy?: boolean; onPick: () => void }) {
  const { t } = useI18n()
  const price = formatPrice(offer)
  return (
    <div className="flex flex-col gap-5 rounded-3xl bg-forest p-6 text-left text-forest-foreground sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm text-forest-foreground/65">{t("Arranged for you")}</p>
        <p className="mt-1 text-2xl font-medium tracking-tight">
          {formatBytes(offer.quota)} · {offer.interval === "year" ? t("{price} a year", { price }) : t("{price} a month", { price })}
        </p>
        {offer.trialDays > 0 && (
          <p className="mt-1 text-sm text-forest-foreground/70">
            {t("Free for the first {n} days. Cancel before then and you pay nothing.", { n: offer.trialDays })}
          </p>
        )}
      </div>
      <Button variant="secondary" size="lg" onClick={onPick} disabled={busy}>
        {busy && <Loader2Icon className="animate-spin" />} {offer.trialDays > 0 ? t("Start free trial") : t("Choose plan")}
      </Button>
    </div>
  )
}

/** Plan cards that go straight to the checkout. */
export function PlanCheckout() {
  const { t } = useI18n()
  const plans = usePlans()
  const { holdKey, me } = useSession()
  const [busy, setBusy] = useState<string | null>(null)
  // Coming back from the checkout with the Back button restores this page as
  // it was left, mid-click. Nothing is in progress any more.
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => e.persisted && setBusy(null)
    window.addEventListener("pageshow", restored)
    return () => window.removeEventListener("pageshow", restored)
  }, [])
  if (!plans) return null
  const pick = async (id: string, interval: Interval) => {
    setBusy(id)
    try {
      await holdKey()
      await startCheckout(id, interval)
    } catch (e) {
      toast.error((e as Error).message || t("Something went wrong"))
      setBusy(null)
    }
  }
  const offer = me?.billing?.offer
  return (
    <div className="grid gap-3">
      {offer && <OfferCard offer={offer} busy={busy === "offer"} onPick={() => pick("offer", offer.interval)} />}
      <PlanGrid plans={plans} busy={busy} label={() => t("Choose plan")} onPick={(p, interval) => pick(p.id, interval)} />
    </div>
  )
}
