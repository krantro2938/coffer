import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  CreditCardIcon,
  HardDriveIcon,
  KeyRoundIcon,
  LanguagesIcon,
  LaptopIcon,
  Loader2Icon,
  LockIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  ShieldCheckIcon,
  SunIcon,
  UserRoundIcon,
} from "lucide-react"
import { OfferCard, PlanFinePrint, PlanGrid, usePlans } from "@/components/plans"
import { api, type Interval, type Plan } from "@/lib/api"
import { changePlan, formatAmount, openPortal, previewPlan, priceFor, startCheckout, type ChangePreview } from "@/lib/billing"
import { PasswordStrength, strength } from "@/components/auth-layout"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { SlidingTabs } from "@/components/sliding-tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useDrive } from "@/lib/drive"
import { SegmentedUsage, percentOf } from "@/components/usage-bar"
import { formatBytes, relativeTime, shortDate } from "@/lib/format"
import { useSession } from "@/lib/session"
import { useTheme, type Theme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { LANGS, useI18n } from "@/lib/i18n"
import type { Lang } from "@/lib/i18n"

export const Route = createFileRoute("/_app/settings")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } => (typeof s.tab === "string" ? { tab: s.tab } : {}),
  component: SettingsPage,
})

function Section({
  id,
  title,
  description,
  icon: Icon,
  footer,
  flat,
  wide,
  children,
}: {
  id?: string
  title: string
  description?: string
  icon: React.ComponentType<{ className?: string }>
  /** A strip under the content for the section's actions. */
  footer?: React.ReactNode
  /** No card: the heading on the left, the content on the right, a rule between sections. */
  flat?: boolean
  /** With `flat`: the heading above the content, which gets the full width. */
  wide?: boolean
  children: React.ReactNode
}) {
  const { t } = useI18n()
  if (flat)
    return (
      <section
        id={id}
        className={cn(
          "grid scroll-mt-20 border-t py-8 first:border-t-0 first:pt-4",
          wide ? "gap-6" : "gap-4 md:grid-cols-[14rem_1fr] md:gap-10"
        )}
      >
        <div>
          <h2 className="font-medium">{t(title)}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{t(description)}</p>}
        </div>
        <div className="min-w-0">{children}</div>
      </section>
    )
  return (
    <section id={id} className="mb-4 scroll-mt-20 overflow-hidden rounded-3xl border bg-card">
      <div className="flex items-center gap-3.5 p-5 pb-5 sm:p-6 sm:pb-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border bg-muted/60 text-muted-foreground">
          <Icon className="size-[1.125rem]" />
        </span>
        <div className="min-w-0">
          <h2 className="font-medium">{t(title)}</h2>
          {description && <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{t(description)}</p>}
        </div>
      </div>
      <div className="min-w-0 px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3.5 sm:px-6">{footer}</div>}
    </section>
  )
}

/** The drive's size as a lit meter: a light card in the light theme, a dark one in the dark theme. */
function StorageCard({ usage }: { usage: { used: number; quota: number } }) {
  const { t } = useI18n()
  const { me } = useSession()
  const navigate = useNavigate()
  const plans = usePlans()
  if (usage.quota <= 0) return null
  const pct = percentOf(usage.used, usage.quota)
  const plan = me?.billing?.free ? t("Free") : plans?.find((p) => p.id === me?.billing?.plan)?.name
  return (
    <section className="relative mb-6 overflow-hidden rounded-[1.75rem] border bg-card shadow-soft">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-foreground/[0.035] to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-8 -left-4 h-24 rounded-full bg-emerald-400/20 blur-3xl dark:bg-lime/15"
        style={{ width: `${Math.max(pct, 6)}%` }}
      />
      <div className="relative p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <span className="grid size-11 place-items-center rounded-xl border bg-muted/70 text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.5)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
              <HardDriveIcon className="size-5" />
            </span>
            <h2 className="text-lg font-medium">{t("Storage")}</h2>
          </div>
          {plan && (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 px-2.5 py-1 text-xs font-medium">
              <span className="size-1.5 rounded-full bg-emerald-500 dark:bg-lime" />
              {plan}
            </span>
          )}
        </div>
        <SegmentedUsage glow charge used={usage.used} quota={usage.quota} segments={52} className="mt-6 h-7" />
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <span className="tabular-nums">
              {t("{used} of {total}", { used: formatBytes(usage.used), total: formatBytes(usage.quota) })}
            </span>
            <span className="rounded-full border bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground tabular-nums">{pct}%</span>
          </p>
          <p className="tabular-nums">{t("{size} free", { size: formatBytes(Math.max(0, usage.quota - usage.used)) })}</p>
        </div>
      </div>
      {me?.billing && (
        <div className="relative flex justify-end gap-2 border-t bg-muted/40 px-5 py-3.5 sm:px-6">
          <Button className="rounded-full" onClick={() => navigate({ to: "/settings", search: { tab: "billing" } })}>
            {me.billing.free ? t("Choose plan") : t("Billing")}
          </Button>
        </div>
      )}
    </section>
  )
}

const TABS = ["account", "security", "billing", "appearance"] as const
type Tab = (typeof TABS)[number]
const TAB_LABELS: Record<Tab, string> = { account: "Account", security: "Security", billing: "Billing", appearance: "Appearance" }

function SettingsPage() {
  const { me, lock, logout } = useSession()
  const { theme, setTheme } = useTheme()
  const { t, lang, setLang } = useI18n()
  const { data } = useDrive()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const usage = data?.usage ?? (me ? { used: me.used, quota: me.quota } : { used: 0, quota: 1 })
  // Drives are free on a server without billing, and there is nothing to show.
  const tabs = TABS.filter((tab) => tab !== "billing" || !!me?.billing)
  const tab = tabs.includes(search.tab as Tab) ? (search.tab as Tab) : "account"

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <p className="eyebrow">{t("Account")}</p>
      <h1 className="mt-1 mb-6 text-3xl font-medium">{t("Settings")}</h1>

      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <SlidingTabs
          value={tab}
          onChange={(v) => navigate({ to: "/settings", search: { tab: v }, replace: true })}
          tabs={tabs.map((v) => ({ value: v, label: t(TAB_LABELS[v]) }))}
        />
      </div>

      <div key={tab} role="tabpanel" className="mt-4 animate-tab-in">
        {tab === "account" && (
          <>
            <StorageCard usage={usage} />

            <Section flat title="Profile" icon={UserRoundIcon}>
              <div className="flex items-center gap-3.5">
                <span className="grid size-12 place-items-center rounded-full bg-secondary text-lg font-medium text-secondary-foreground uppercase">
                  {me?.email[0]}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{me?.email}</p>
                  <p className="text-sm text-muted-foreground">{t("Member since {date}", { date: me ? shortDate(me.createdAt) : "—" })}</p>
                </div>
              </div>
            </Section>

            <Section
              flat
              title="Signed-in browsers"
              icon={LaptopIcon}
              description="Everywhere this account is signed in. Signing one out does not affect the others."
            >
              <Sessions />
            </Section>

            <Section
              flat
              title="This device"
              icon={LockIcon}
              description="Locking forgets the key on this device; signing out also ends the session."
            >
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => lock()}>
                  <LockIcon /> {t("Lock now")}
                </Button>
                <Button variant="outline" onClick={() => logout()}>
                  <LogOutIcon /> {t("Sign out")}
                </Button>
              </div>
            </Section>

            <Section flat title="Danger zone" icon={AlertTriangleIcon}>
              <DeleteAccount />
            </Section>
          </>
        )}
        {tab === "security" && (
          <>
            <Section
              title="Password"
              icon={KeyRoundIcon}
              description="Your files aren't re-encrypted — only the key that unlocks them is re-sealed."
            >
              <ChangePassword />
            </Section>

            <Section title="Encryption" icon={ShieldCheckIcon} description="What protects your data.">
              <dl className="grid gap-px overflow-hidden rounded-2xl border bg-border text-sm sm:grid-cols-2">
                {[
                  ["Content", "AES-256-GCM, 4 MB chunks"],
                  ["Password", "Argon2id · 64 MiB · 3 passes"],
                  ["Key hierarchy", "Master key → per-file keys"],
                  ["Names & folders", "Encrypted with your master key"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-card p-4">
                    <dt className="text-xs text-muted-foreground">{t(k)}</dt>
                    <dd className="mt-1 font-medium">{t(v)}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          </>
        )}
        {tab === "billing" && (
          <>
            <Section
              flat
              wide
              id="plan"
              icon={CreditCardIcon}
              title="Plan"
              description="Change the size of your drive, update your card or cancel."
            >
              <PlanSettings />
            </Section>
          </>
        )}
        {tab === "appearance" && (
          <>
            <Section title="Appearance" icon={PaletteIcon} description="Light by default. Dark and system are one click away.">
              <ToggleGroup
                type="single"
                value={theme}
                onValueChange={(v) => v && setTheme(v as Theme)}
                variant="outline"
                className="w-full sm:w-auto"
              >
                <ToggleGroupItem value="light" className="flex-1 gap-2 px-4">
                  <SunIcon /> {t("Light")}
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" className="flex-1 gap-2 px-4">
                  <MoonIcon /> {t("Dark")}
                </ToggleGroupItem>
                <ToggleGroupItem value="system" className="flex-1 gap-2 px-4">
                  <MonitorIcon /> {t("System")}
                </ToggleGroupItem>
              </ToggleGroup>
            </Section>

            <Section
              title="Language"
              icon={LanguagesIcon}
              description="Detected from your browser; your choice is remembered on this device."
            >
              <ToggleGroup
                type="single"
                value={lang}
                onValueChange={(v) => v && setLang(v as Lang)}
                variant="outline"
                spacing={2}
                className="w-full flex-wrap sm:w-auto"
              >
                {LANGS.map((l) => (
                  <ToggleGroupItem key={l.value} value={l.value} className="gap-2 px-4">
                    {l.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

/** Turns a browser's user-agent string into something a person recognises. */
function describeAgent(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : ""
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux|X11/.test(ua)
            ? "Linux"
            : ""
  return [browser, os].filter(Boolean).join(" · ")
}

type SessionRow = { id: string; userAgent: string; createdAt: number; lastSeen: number; current: boolean }

function Sessions() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const { data: sessions, isLoading } = useQuery({ queryKey: ["sessions"], queryFn: () => api<SessionRow[]>("/api/auth/sessions") })

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try {
      await fn()
      toast.success(done)
      await qc.invalidateQueries({ queryKey: ["sessions"] })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (isLoading || !sessions) return <Skeleton className="h-20 rounded-2xl" />
  const others = sessions.filter((s) => !s.current)

  return (
    <div className="grid gap-3">
      <ul className="divide-y overflow-hidden rounded-2xl border bg-muted/30">
        {sessions.map((s) => (
          <li key={s.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
              <MonitorIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-sm font-medium">
                <span className="truncate">{describeAgent(s.userAgent) || t("Unknown browser")}</span>
                {s.current && (
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[0.6875rem] font-medium text-secondary-foreground">
                    {t("This browser")}
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {t("Signed in {when}", { when: relativeTime(s.createdAt) })} · {t("last active {when}", { when: relativeTime(s.lastSeen) })}
              </p>
            </div>
            {!s.current && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  run(s.id, () => api(`/api/auth/sessions/${s.id}`, { method: "DELETE" }), t("That browser has been signed out"))
                }
              >
                {busy === s.id ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />} {t("Sign out")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => run("others", () => api("/api/auth/sessions/end-others", { method: "POST" }), t("Signed out everywhere else"))}
          >
            <LogOutIcon /> {t("Sign out everywhere else")}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("We keep the browser's name and when it was used, not its IP address.")}</p>
    </div>
  )
}

function PlanSettings() {
  const { me, updateMe, holdKey } = useSession()
  const { t } = useI18n()
  const qc = useQueryClient()
  const { data } = useDrive()
  const plans = usePlans()
  const [busy, setBusy] = useState<string | null>(null)
  // Back from the checkout or the billing portal: see PlanCheckout.
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => e.persisted && setBusy(null)
    window.addEventListener("pageshow", restored)
    return () => window.removeEventListener("pageshow", restored)
  }, [])
  const [target, setTarget] = useState<{ plan: Plan; interval: Interval } | null>(null)
  // What the switch would charge now, asked of Paddle when the dialog opens.
  const [preview, setPreview] = useState<ChangePreview | "failed" | null>(null)
  useEffect(() => {
    setPreview(null)
    if (!target) return
    let live = true
    previewPlan(target.plan.id, target.interval)
      .then((p) => live && setPreview(p))
      .catch(() => live && setPreview("failed"))
    return () => {
      live = false
    }
  }, [target])
  const billing = me?.billing
  if (!billing) return null
  const used = data?.usage.used ?? me.used
  const current = plans?.find((p) => p.id === billing.plan)
  // A running subscription is switched in place; otherwise a new one is bought.
  const running = billing.status === "active"

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      toast.error((e as Error).message || t("Something went wrong"))
    } finally {
      setBusy(null)
    }
  }
  const confirmSwitch = () =>
    target &&
    run(target.plan.id, async () => {
      updateMe(await changePlan(target.plan.id, target.interval))
      void qc.invalidateQueries({ queryKey: ["drive"] })
      toast.success(t("You're now on {plan}", { plan: target.plan.name }))
      setTarget(null)
    })
  const interval: Interval = billing.interval ?? "month"
  const other: Interval = interval === "month" ? "year" : "month"
  const currentPrice = current ? priceFor(current, interval) : null
  const rate = (p: Plan, i: Interval) =>
    i === "year"
      ? t("{price} a year", { price: formatAmount(priceFor(p, i) ?? 0, p.currency) })
      : t("{price} a month", { price: formatAmount(priceFor(p, i) ?? 0, p.currency) })
  // The sentence the dialog gives: what is charged now and what follows.
  const consequence = () => {
    if (!target) return ""
    if (preview === null) return t("Working out the price…")
    if (preview === "failed") return t("We couldn't work out the price just now. Paddle will show it before charging.")
    const next = { rate: rate(target.plan, target.interval), date: preview.nextBilledAt ? shortDate(preview.nextBilledAt) : "" }
    const amount = formatAmount(preview.amount, preview.currency)
    if (preview.action === "charge")
      return t(
        "You'll pay {amount} now, which already counts the unused part of your current plan. After that, {rate}, with the next payment on {date}.",
        { amount, ...next }
      )
    if (preview.action === "credit")
      return t(
        "Nothing is charged now. The unused part of your current plan, {amount}, is credited to your next payments. After that, {rate}, with the next payment on {date}.",
        { amount, ...next }
      )
    if (preview.fromCredit)
      return t("Nothing is charged now: credit you already have pays for it. After that, {rate}, with the next payment on {date}.", next)
    return t("Nothing is charged now. After that, {rate}, with the next payment on {date}.", next)
  }

  return (
    <div className="grid gap-4">
      {billing.comp && (
        <div className="rounded-2xl border bg-muted/30 p-5">
          <p className="font-medium">
            {t("Complimentary")} · {formatBytes(billing.comp.quota)}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {billing.comp.until
              ? t("At no charge until {date}.", { date: shortDate(billing.comp.until) })
              : t("At no charge, with no end date.")}
          </p>
        </div>
      )}
      {billing.free && (
        <div className="rounded-2xl border bg-muted/30 p-5">
          <p className="font-medium">
            {t("Free account")} · {formatBytes(me.quota)}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("{n} request links open at a time and share links that last up to {days} days. A plan lifts both.", {
              n: billing.free.requestLinks,
              days: billing.free.shareDays,
            })}
          </p>
        </div>
      )}
      {billing.offer && !billing.entitled && (
        <OfferCard
          offer={billing.offer}
          busy={busy === "offer"}
          onPick={() => run("offer", async () => (await holdKey(), startCheckout("offer", billing.offer!.interval)))}
        />
      )}
      {billing.plan && (
        <div className="flex flex-col gap-4 rounded-2xl border bg-muted/30 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium">
              {current
                ? `${current.name} · ${formatBytes(current.quota)}`
                : billing.plan === "custom"
                  ? `${t("Personal plan")} · ${formatBytes(me.quota)}`
                  : billing.plan}
              {current && billing.entitled && currentPrice !== null && (
                <span className="font-normal text-muted-foreground"> · {rate(current, interval)}</span>
              )}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {!billing.entitled
                ? t("Ended. Your drive is read-only until you pick a plan again.")
                : billing.status === "canceled"
                  ? t("Ended.")
                  : billing.cancelAt
                    ? t("Cancelled. Your drive stays open until {date}.", { date: shortDate(billing.cancelAt) })
                    : billing.periodEnd
                      ? currentPrice !== null
                        ? t("Next charge of {price} on {date}", {
                            price: formatAmount(currentPrice, current!.currency),
                            date: shortDate(billing.periodEnd),
                          })
                        : t("Renews on {date}", { date: shortDate(billing.periodEnd) })
                      : t("Active")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {running && current && !billing.cancelAt && priceFor(current, other) !== null && (
              <Button variant="outline" onClick={() => setTarget({ plan: current, interval: other })} disabled={!!busy}>
                {other === "year" ? t("Switch to yearly billing") : t("Switch to monthly billing")}
              </Button>
            )}
            <Button variant="outline" onClick={() => run("portal", async () => (await holdKey(), openPortal()))} disabled={!!busy}>
              {busy === "portal" ? <Loader2Icon className="animate-spin" /> : <CreditCardIcon />} {t("Manage billing")}
            </Button>
          </div>
        </div>
      )}
      {billing.status === "past_due" && (
        <p className="flex items-start gap-2 rounded-2xl bg-coral-soft p-4 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          {t("Your last payment didn't go through. Update your card under Manage billing to keep your drive open.")}
        </p>
      )}
      {plans && (billing.status !== "past_due" || !billing.entitled) && (
        <div className="mt-6 grid gap-4">
          <PlanGrid
            plans={plans}
            current={billing.entitled ? billing.plan : null}
            currentInterval={billing.entitled ? interval : undefined}
            busy={busy}
            disabled={(p) => running && used > p.quota}
            label={(p) => (!running ? t("Choose plan") : used > p.quota ? t("Too small for your files") : t("Switch"))}
            onPick={(p, i) =>
              running ? setTarget({ plan: p, interval: i }) : run(p.id, async () => (await holdKey(), startCheckout(p.id, i)))
            }
          />
          <PlanFinePrint />
        </div>
      )}
      <ResponsiveDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={
          target
            ? target.interval === "year"
              ? t("Switch to {plan}, billed yearly?", { plan: target.plan.name })
              : t("Switch to {plan}, billed monthly?", { plan: target.plan.name })
            : ""
        }
        description={consequence()}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={() => setTarget(null)} disabled={!!busy}>
            {t("Cancel")}
          </Button>
          <Button onClick={confirmSwitch} disabled={!!busy || preview === null}>
            {busy && <Loader2Icon className="animate-spin" />} {t("Switch plan")}
          </Button>
        </div>
      </ResponsiveDialog>
    </div>
  )
}

function ChangePassword() {
  const { changePassword } = useSession()
  const { t } = useI18n()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (strength(next) < 1) return toast.error(t("Use at least 10 characters"))
    if (next !== confirm) return toast.error(t("Passwords don't match"))
    setBusy(true)
    try {
      await changePassword(current, next)
      toast.success(t("Password changed — other devices were signed out"))
      setCurrent("")
      setNext("")
      setConfirm("")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-sm gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="cur">{t("Current password")}</Label>
        <Input
          id="cur"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new">{t("New password")}</Label>
        <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        <PasswordStrength password={next} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirm">{t("Confirm new password")}</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={busy} className="mt-1 w-fit">
        {busy && <Loader2Icon className="animate-spin" />} {t("Update password")}
      </Button>
    </form>
  )
}

function DeleteAccount() {
  const { deleteAccount, me } = useSession()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await deleteAccount(password)
      toast.success(t("Your account and all data have been destroyed"))
      navigate({ to: "/" })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-destructive/30 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">{t("Delete account")}</p>
        <p className="text-sm text-muted-foreground">
          {t("Permanently destroys every file, note, folder and link.")}
          {me?.billing?.entitled ? ` ${t("Your plan is cancelled along with it.")}` : ""}
        </p>
      </div>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        {t("Delete account")}
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title={t("Delete your account?")}
        description={t("This can't be undone. Enter your password to confirm.")}
      >
        <form onSubmit={submit} className="grid gap-4">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("Password")}
            autoFocus
            required
          />
          <Button type="submit" variant="destructive" disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />} {t("Permanently delete everything")}
          </Button>
        </form>
      </ResponsiveDialog>
    </div>
  )
}
