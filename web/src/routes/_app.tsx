import { useEffect, useState } from "react"
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ChevronsUpDownIcon,
  LockKeyholeOpenIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  HardDriveIcon,
  HomeIcon,
  InboxIcon,
  Link2Icon,
  Loader2Icon,
  LogOutIcon,
  LockKeyholeIcon,
  LanguagesIcon,
  SettingsIcon,
} from "lucide-react"
import { Brand, LogoMark } from "@/components/brand"
import { LangToggle } from "@/components/lang-toggle"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { UsageBar } from "@/components/usage-bar"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PlanCheckout, PlanFinePrint, usePlans } from "@/components/plans"
import { Unbox } from "@/components/unbox"
import { VerifyEmail } from "@/components/verify-email"
import { readWelcome, saveWelcome } from "@/lib/welcome"
import { shortDate } from "@/lib/format"
import { canWrite } from "@/lib/api"
import { syncBilling } from "@/lib/billing"
import { useDrive } from "@/lib/drive"
import { useDriveSync } from "@/lib/sync"
import { formatBytes } from "@/lib/format"
import { LANGS, useI18n } from "@/lib/i18n"
import type { Lang } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { useTheme, type Theme } from "@/lib/theme"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app")({ component: AppLayout })

const nav = [
  { to: "/drive", label: "My drive", icon: HardDriveIcon },
  { to: "/links", label: "Shared links", icon: Link2Icon },
  { to: "/requests", label: "File requests", icon: InboxIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const

/**
 * Coming back from the checkout: Paddle confirms a payment a moment after it
 * redirects, so ask the server until the plan shows up.
 */
function useCheckoutReturn() {
  const { status, updateMe } = useSession()
  const { t } = useI18n()
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const signedIn = status === "locked" || status === "unlocked"

  useEffect(() => {
    if (!signedIn) return
    const url = new URL(location.href)
    const outcome = url.searchParams.get("billing")
    if (!outcome) return
    url.searchParams.delete("billing")
    history.replaceState(history.state, "", url)
    if (outcome !== "success") return
    let live = true
    setConfirming(true)
    ;(async () => {
      // oxlint-disable-next-line no-unmodified-loop-condition -- the effect's cleanup clears it
      for (let i = 0; i < 15 && live; i++) {
        try {
          const me = await syncBilling()
          if (!live) return
          updateMe(me)
          if (me.billing?.entitled) {
            void qc.invalidateQueries({ queryKey: ["drive"] })
            toast.success(t("Your drive is ready"))
            break
          }
        } catch {
          /* try again */
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
      if (live) setConfirming(false)
    })()
    return () => {
      live = false
    }
  }, [signedIn, updateMe, t, qc])

  return confirming
}

function AppLayout() {
  const { status, me } = useSession()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const confirming = useCheckoutReturn()
  useDriveSync()
  // A new account that has not seen its drive open yet.
  const [welcome, setWelcome] = useState(() => readWelcome(me?.email))
  useEffect(() => setWelcome(readWelcome(me?.email)), [me?.email])
  // They left the welcome early; pick it up where it was.
  const resumeWelcome = welcome?.stage === "ask" && !!me?.verified
  useEffect(() => {
    if (resumeWelcome) navigate({ to: "/welcome" })
  }, [resumeWelcome, navigate])

  useEffect(() => {
    if (status === "anonymous") navigate({ to: "/login" })
  }, [status, navigate])

  if (status === "loading" || status === "anonymous") {
    return (
      <div className="grid min-h-svh place-items-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (me && !me.verified) {
    return (
      <div className="grid min-h-svh place-items-center px-4">
        <div className="w-full max-w-sm rounded-[1.75rem] border bg-card p-6 shadow-soft sm:p-8">
          <VerifyEmail />
        </div>
      </div>
    )
  }
  if (resumeWelcome) return null
  if (confirming) return <PlanScreen confirming />
  // No plan yet: there is no drive to show. Settings stay reachable.
  if (me?.billing && !me.billing.plan && !me.billing.entitled && !me.billing.deleteAt && pathname !== "/settings") return <PlanScreen />
  if (status === "locked") return <UnlockScreen />
  if (welcome?.stage === "unbox" && canWrite(me)) {
    return (
      <Unbox
        welcome={welcome}
        onDone={() => {
          saveWelcome(null)
          setWelcome(null)
          navigate({ to: "/drive" })
        }}
      />
    )
  }

  return (
    <div className="min-h-svh md:grid md:grid-cols-[16rem_1fr]">
      <Sidebar />
      <div className="flex min-h-svh min-w-0 flex-col">
        <MobileTopBar />
        <main className="flex-1 pb-24 md:pb-0">
          {!canWrite(me) && (me?.billing?.plan || me?.billing?.deleteAt) && pathname !== "/settings" && <ReadOnlyBanner />}
          <Outlet />
        </main>
      </div>
      <MobileTabBar />
    </div>
  )
}

function Sidebar() {
  const { me, logout } = useSession()
  const { theme, setTheme } = useTheme()
  const { t, lang, setLang } = useI18n()
  const { data } = useDrive()
  const usage = data?.usage ?? (me ? { used: me.used, quota: me.quota } : null)
  return (
    <aside className="sticky top-0 hidden h-svh min-w-0 flex-col overflow-hidden border-r bg-sidebar p-4 md:flex">
      <Brand to="/drive" className="px-2 py-1.5" />
      <nav className="mt-8 grid gap-1">
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            activeProps={{ className: "bg-sidebar-accent !text-foreground font-medium" }}
          >
            <Icon className="size-4" /> {t(label)}
          </Link>
        ))}
        <Link
          to="/"
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <HomeIcon className="size-4" /> {t("Quick share")}
        </Link>
      </nav>

      <div className="mt-auto grid min-w-0 gap-3">
        {usage && usage.quota > 0 && (
          <div className="grid gap-2 rounded-xl border bg-card px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">{t("Storage")}</span>
              <span className="truncate text-muted-foreground tabular-nums">
                {t("{used} of {total}", { used: formatBytes(usage.used), total: formatBytes(usage.quota) })}
              </span>
            </div>
            <UsageBar used={usage.used} quota={usage.quota} />
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-w-0 items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-sidebar-accent">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground uppercase">
                {me?.email[0]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{me?.email}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <LockKeyholeOpenIcon className="size-3" /> {t("Unlocked")}
                </span>
              </span>
              <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-(--radix-dropdown-menu-trigger-width) min-w-52">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("Theme")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              <DropdownMenuRadioItem value="light">
                <SunIcon /> {t("Light")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <MoonIcon /> {t("Dark")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <MonitorIcon /> {t("System")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <LanguagesIcon /> {t("Language")}
                <span className="ml-auto text-xs text-muted-foreground">{LANGS.find((l) => l.value === lang)?.label}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)}>
                  {LANGS.map((l) => (
                    <DropdownMenuRadioItem key={l.value} value={l.value}>
                      {l.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logout()} variant="destructive">
              <LogOutIcon /> {t("Sign out")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}

function MobileTopBar() {
  const { me, logout } = useSession()
  const { t } = useI18n()
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-xl md:hidden">
      <Brand to="/drive" />
      <div className="flex items-center gap-1">
        <LangToggle />
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("Account")}>
              <span className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground uppercase">
                {me?.email[0]}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{me?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/">
                <HomeIcon /> {t("Quick share")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => logout()} variant="destructive">
              <LogOutIcon /> {t("Sign out")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

function MobileTabBar() {
  const { t } = useI18n()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="grid grid-cols-4">
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex flex-col items-center gap-1 py-2.5 text-[0.6875rem] text-muted-foreground"
            activeProps={{ className: "!text-foreground" }}
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    "grid h-7 w-12 place-items-center rounded-full transition-colors",
                    isActive && "bg-secondary text-secondary-foreground"
                  )}
                >
                  <Icon className="size-4.5" />
                </span>
                {t(label)}
              </>
            )}
          </Link>
        ))}
      </div>
    </nav>
  )
}

function ReadOnlyBanner() {
  const { t } = useI18n()
  const { me } = useSession()
  const deleteAt = me?.billing?.deleteAt
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b bg-coral-soft px-4 py-3 text-sm sm:px-8">
      <p>
        <span className="font-medium">{t("Your plan has ended.")}</span>{" "}
        {t("Your drive is read-only and its links are paused: you can still download and delete, but not add.")}
        {deleteAt ? ` ${t("Unless you renew, your files are deleted on {date}.", { date: shortDate(deleteAt) })}` : ""}
      </p>
      <Button size="sm" asChild>
        <Link to="/settings" search={{ tab: "billing" }}>
          {t("Renew")}
        </Link>
      </Button>
    </div>
  )
}

function PlanScreen({ confirming }: { confirming?: boolean }) {
  const { me, logout } = useSession()
  const { t } = useI18n()
  const plans = usePlans()
  return (
    <div className="relative grid min-h-svh place-items-center px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 size-[64rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/[0.05]" />
        <div className="absolute top-1/2 left-1/2 size-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--mint),transparent)] opacity-40" />
      </div>
      {confirming ? (
        <div className="grid justify-items-center gap-4 text-center">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-medium">{t("Confirming your payment…")}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("This takes a few seconds.")}</p>
          </div>
        </div>
      ) : (
        <div className="grid w-full max-w-4xl gap-8">
          <div className="grid justify-items-center gap-4 text-center">
            <LogoMark className="size-12" />
            <div>
              <h1 className="text-3xl font-medium sm:text-4xl">{t("Choose the size of your drive")}</h1>
              <p className="mx-auto mt-2 max-w-md text-sm text-pretty text-muted-foreground">
                {t("Your account is ready. Pick a plan to open your drive; you can change or cancel it at any time.")}
              </p>
            </div>
          </div>
          {plans ? (
            <PlanCheckout />
          ) : (
            <p className="text-center text-sm text-muted-foreground">{t("Plans are unavailable right now. Please try again shortly.")}</p>
          )}
          <PlanFinePrint className="mx-auto max-w-xl text-center" />
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span className="truncate">{me?.email}</span>
            <Link to="/" className="hover:text-foreground">
              {t("Quick share")}
            </Link>
            <Link to="/settings" className="hover:text-foreground">
              {t("Settings")}
            </Link>
            <button type="button" onClick={() => logout()} className="cursor-pointer hover:text-foreground">
              {t("Sign out")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function UnlockScreen() {
  const { me, unlock, logout } = useSession()
  const { t } = useI18n()
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await unlock(password, remember)
    } catch (err) {
      toast.error((err as Error).message)
      setPassword("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative grid min-h-svh place-items-center px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 size-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/[0.05]" />
        <div className="absolute top-1/2 left-1/2 size-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--mint),transparent)] opacity-50" />
      </div>
      <form onSubmit={submit} className="grid w-full max-w-sm gap-6 rounded-[1.75rem] border bg-card p-6 shadow-soft sm:p-8">
        <div className="grid justify-items-center gap-4 text-center">
          <LogoMark className="size-12" />
          <div>
            <h1 className="text-2xl font-medium">{t("Your drive is locked")}</h1>
            <p className="mt-1.5 truncate text-sm text-muted-foreground">{me?.email}</p>
          </div>
        </div>
        <Input
          type="password"
          placeholder={t("Password")}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
        />
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          {t("Stay unlocked on this device")}
          <Switch checked={remember} onCheckedChange={setRemember} />
        </label>
        <Button size="lg" type="submit" disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <LockKeyholeIcon />}
          {busy ? t("Unlocking…") : t("Unlock")}
        </Button>
        <button type="button" onClick={() => logout()} className="text-sm text-muted-foreground hover:text-foreground">
          {t("Sign in as someone else")}
        </button>
      </form>
    </div>
  )
}
