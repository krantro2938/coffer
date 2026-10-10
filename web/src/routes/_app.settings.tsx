import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangleIcon, CreditCardIcon, Loader2Icon, LockIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { OfferCard, PlanFinePrint, PlanGrid, usePlans } from "@/components/plans"
import { api, type Plan } from "@/lib/api"
import { changePlan, formatPrice, openPortal, startCheckout } from "@/lib/billing"
import { PasswordStrength, strength } from "@/components/auth-layout"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { SlidingTabs } from "@/components/sliding-tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useDrive } from "@/lib/drive"
import { UsageBar } from "@/components/usage-bar"
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
  wide,
  children,
}: {
  id?: string
  title: string
  description?: string
  /** Put the heading above the content, which then gets the full width. */
  wide?: boolean
  children: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <section id={id} className={cn("grid scroll-mt-20 gap-4 border-t py-8", !wide && "md:grid-cols-[14rem_1fr] md:gap-10")}>
      <div>
        <h2 className="font-medium">{t(title)}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{t(description)}</p>}
      </div>
      <div className="min-w-0">{children}</div>
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
            <Section title="Profile">
              <div className="grid gap-4 rounded-2xl border bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-full bg-secondary text-lg font-medium text-secondary-foreground uppercase">
                    {me?.email[0]}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{me?.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("Member since {date}", { date: me ? shortDate(me.createdAt) : "—" })}
                    </p>
                  </div>
                </div>
                <div hidden={usage.quota <= 0}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{t("Storage")}</span>
                    <span className="text-muted-foreground">
                      {t("{used} of {total}", { used: formatBytes(usage.used), total: formatBytes(usage.quota) })}
                    </span>
                  </div>
                  <div className="mt-2">
                    <UsageBar used={usage.used} quota={usage.quota} />
                  </div>
                </div>
              </div>
            </Section>

            <Section
              title="Signed-in browsers"
              description="Everywhere this account is signed in. Signing one out does not affect the others."
            >
              <Sessions />
            </Section>

            <Section title="This device" description="Locking forgets the key on this device; signing out also ends the session.">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => lock()}>
                  <LockIcon /> {t("Lock now")}
                </Button>
                <Button variant="outline" onClick={() => logout()}>
                  <LogOutIcon /> {t("Sign out")}
                </Button>
              </div>
            </Section>

            <Section title="Danger zone">
              <DeleteAccount />
            </Section>
          </>
        )}
        {tab === "security" && (
          <>
            <Section title="Password" description="Your files aren't re-encrypted — only the key that unlocks them is re-sealed.">
              <ChangePassword />
            </Section>

            <Section title="Encryption" description="What protects your data.">
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
            <Section id="plan" wide title="Plan" description="Change the size of your drive, update your card or cancel.">
              <PlanSettings />
            </Section>
          </>
        )}
        {tab === "appearance" && (
          <>
            <Section title="Appearance" description="Light by default. Dark and system are one click away.">
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

            <Section title="Language" description="Detected from your browser; your choice is remembered on this device.">
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
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
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
  const [target, setTarget] = useState<Plan | null>(null)
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
    run(target.id, async () => {
      updateMe(await changePlan(target.id))
      void qc.invalidateQueries({ queryKey: ["drive"] })
      toast.success(t("You're now on {plan}", { plan: target.name }))
      setTarget(null)
    })

  return (
    <div className="grid gap-4">
      {billing.comp && (
        <div className="rounded-2xl border bg-card p-5">
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
      {billing.offer && !billing.entitled && (
        <OfferCard
          offer={billing.offer}
          busy={busy === "offer"}
          onPick={() => run("offer", async () => (await holdKey(), startCheckout("offer")))}
        />
      )}
      {billing.plan && (
        <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium">
              {current
                ? `${current.name} · ${formatBytes(current.quota)}`
                : billing.plan === "custom"
                  ? `${t("Personal plan")} · ${formatBytes(me.quota)}`
                  : billing.plan}
              {current && billing.entitled && (
                <span className="font-normal text-muted-foreground"> · {t("{price} a month", { price: formatPrice(current) })}</span>
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
                      ? t("Renews on {date}", { date: shortDate(billing.periodEnd) })
                      : t("Active")}
            </p>
          </div>
          <Button variant="outline" onClick={() => run("portal", async () => (await holdKey(), openPortal()))} disabled={!!busy}>
            {busy === "portal" ? <Loader2Icon className="animate-spin" /> : <CreditCardIcon />} {t("Manage billing")}
          </Button>
        </div>
      )}
      {billing.status === "past_due" && (
        <p className="flex items-start gap-2 rounded-2xl bg-coral-soft p-4 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          {t("Your last payment didn't go through. Update your card under Manage billing to keep your drive open.")}
        </p>
      )}
      {plans && (billing.status !== "past_due" || !billing.entitled) && (
        <>
          <PlanGrid
            plans={plans}
            current={billing.entitled ? billing.plan : null}
            busy={busy}
            disabled={(p) => running && used > p.quota}
            label={(p) => (!running ? t("Choose plan") : used > p.quota ? t("Too small for your files") : t("Switch"))}
            onPick={(p) => (running ? setTarget(p) : run(p.id, async () => (await holdKey(), startCheckout(p.id))))}
          />
          <PlanFinePrint />
        </>
      )}
      <ResponsiveDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={target ? t("Switch to {plan}?", { plan: target.name }) : ""}
        description={t("Your card is charged or credited now for the rest of this billing period, then {price} a month.", {
          price: target ? formatPrice(target) : "",
        })}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={() => setTarget(null)} disabled={!!busy}>
            {t("Cancel")}
          </Button>
          <Button onClick={confirmSwitch} disabled={!!busy}>
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
