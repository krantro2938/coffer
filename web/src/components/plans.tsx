import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { CheckIcon, Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getConfig, type Billing, type Plan } from "@/lib/api"
import { formatPrice, startCheckout } from "@/lib/billing"
import { formatBytes } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"

const blurbs: Record<string, string> = {
  starter: "Personal encrypted storage",
  plus: "For everyday cloud storage",
  pro: "For large private archives",
}

/** The paid drive sizes, or null where drives are free (or still loading). */
export function usePlans(): Plan[] | null {
  const { data } = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity })
  return data?.plans?.length ? data.plans : null
}

export function PlanGrid({
  plans,
  current,
  label,
  busy,
  disabled,
  onPick,
}: {
  plans: Plan[]
  /** Plan the account is on, shown as such instead of offered. */
  current?: string | null
  label: (plan: Plan) => string
  busy?: string | null
  disabled?: (plan: Plan) => boolean
  onPick: (plan: Plan) => void
}) {
  const { t } = useI18n()
  const featured = plans.length === 3 ? plans[1].id : null
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {plans.map((p) => {
        const on = p.id === featured
        const mine = p.id === current
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
            <p className="mt-5 text-4xl font-medium tracking-tight tabular-nums">{formatPrice(p)}</p>
            <p className={cn("mt-1 text-sm", on ? "text-forest-foreground/60" : "text-muted-foreground")}>{t("per month")}</p>
            <div className={cn("mt-6 border-t pt-5", on && "border-white/10")}>
              <p className="text-xl font-medium">{formatBytes(p.quota)}</p>
              <p className={cn("mt-1 text-sm", on ? "text-forest-foreground/70" : "text-muted-foreground")}>
                {t(blurbs[p.id] ?? "Encrypted storage")}
              </p>
            </div>
            <Button
              className="mt-8 w-full"
              variant={on ? "secondary" : "outline"}
              disabled={mine || !!busy || disabled?.(p)}
              onClick={() => onPick(p)}
            >
              {busy === p.id && <Loader2Icon className="animate-spin" />}
              {mine ? t("Your plan") : label(p)}
            </Button>
          </div>
        )
      })}
    </div>
  )
}

export function PlanFinePrint({ className }: { className?: string }) {
  const { t } = useI18n()
  return (
    <p className={cn("text-xs text-pretty text-muted-foreground", className)}>
      {t("Every plan: end-to-end encryption, a private drive, secure sharing, unlimited folders. No ads, no tracking.")}{" "}
      {t("Payment is handled by Paddle; we never see your card. Cancel whenever you like.")}
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
  const pick = async (id: string) => {
    setBusy(id)
    try {
      await holdKey()
      await startCheckout(id)
    } catch (e) {
      toast.error((e as Error).message || t("Something went wrong"))
      setBusy(null)
    }
  }
  const offer = me?.billing?.offer
  return (
    <div className="grid gap-3">
      {offer && <OfferCard offer={offer} busy={busy === "offer"} onPick={() => pick("offer")} />}
      <PlanGrid plans={plans} busy={busy} label={() => t("Choose plan")} onPick={(p) => pick(p.id)} />
    </div>
  )
}
