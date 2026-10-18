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
  Loader2Icon,
  LogOutIcon,
  LockKeyholeIcon,
  LanguagesIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { Brand, LogoMark } from "@/components/brand"
import { DriveIcon, LinksIcon, QuickShareIcon, RequestsIcon, SettingsIcon } from "@/components/nav-icons"
import { PreferencesMenu } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SegmentedUsage, UsageRing, percentOf } from "@/components/usage-bar"
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
  { to: "/drive", label: "My drive", icon: DriveIcon },
  { to: "/share", label: "Quick share", icon: QuickShareIcon },
  { to: "/links", label: "Shared links", icon: LinksIcon },
  { to: "/requests", label: "File requests", icon: RequestsIcon },
] as const

const settingsNav = { to: "/settings", label: "Settings", icon: SettingsIcon } as const

const COLLAPSED_KEY = "coffer.sidebar.collapsed"

/** Whether the sidebar is folded to its icons. Remembered per browser; the page works without it. */
function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1"
    } catch {
      return false
    }
  })
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1")
      } catch {
        /* not remembered */
      }
      return !c
    })
  return [collapsed, toggle]
}

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
  const [collapsed, toggleCollapsed] = useCollapsed()
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
    <div
      className={cn(
        "min-h-svh md:grid md:transition-[grid-template-columns] md:duration-300 md:ease-[cubic-bezier(0.32,0.72,0,1)]",
        collapsed ? "md:grid-cols-[6rem_1fr]" : "md:grid-cols-[17.5rem_1fr]"
      )}
    >
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
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

/** Text that folds away with the sidebar: it stays in place and is clipped, so nothing jumps. */
function Fold({ collapsed, className, children }: { collapsed: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "min-w-0 whitespace-nowrap transition-opacity duration-200",
        collapsed ? "opacity-0" : "opacity-100 delay-100",
        className
      )}
    >
      {children}
    </span>
  )
}

function NavItem({
  to,
  label,
  icon: Icon,
  collapsed,
}: {
  to: string
  label: string
  icon: (props: { className?: string }) => React.ReactNode
  collapsed: boolean
}) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      aria-label={label}
      // The icon sits in the same place whatever the width: only the label and the pill change.
      className="group flex h-11 items-center gap-[1.125rem] overflow-hidden rounded-2xl px-[0.6875rem] text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
      activeProps={{ className: "bg-foreground/[0.07] !text-foreground font-medium hover:bg-foreground/[0.07]" }}
    >
      {/* Quiet until it is the page you are on or the one under the pointer. */}
      <Icon className="size-6 opacity-60 grayscale transition-[opacity,filter] duration-200 group-hover:opacity-100 group-hover:grayscale-0 group-data-[status=active]:opacity-100 group-data-[status=active]:grayscale-0" />
      <Fold collapsed={collapsed}>{label}</Fold>
    </Link>
  )
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { me, logout } = useSession()
  const { theme, setTheme } = useTheme()
  const { t, lang, setLang } = useI18n()
  const { data } = useDrive()
  const usage = data?.usage ?? (me ? { used: me.used, quota: me.quota } : null)
  const toggleLabel = collapsed ? t("Expand sidebar") : t("Collapse sidebar")
  const Toggle = collapsed ? ChevronRightIcon : ChevronLeftIcon
  const handle = me?.email.split("@")[0] ?? ""
  const used = usage ? t("{used} of {total}", { used: formatBytes(usage.used), total: formatBytes(usage.quota) }) : ""
  return (
    <aside className="sticky top-0 hidden h-svh min-w-0 p-3 md:block">
      <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-sidebar p-3">
        <Link
          to="/drive"
          aria-label="Coffer"
          className="flex h-12 items-center gap-3 overflow-hidden px-[0.3125rem] font-medium tracking-tight"
        >
          <LogoMark className="size-9 shrink-0" />
          <Fold collapsed={collapsed} className="text-[1.0625rem]">
            Coffer
          </Fold>
        </Link>

        <nav className="mt-6 grid gap-0.5">
          {nav.map((item) => (
            <NavItem key={item.to} {...item} label={t(item.label)} collapsed={collapsed} />
          ))}
        </nav>

        <div className="mt-auto grid min-w-0 gap-1">
          {usage && usage.quota > 0 && (
            <div
              title={collapsed ? used : undefined}
              className={cn(
                "mb-2 grid h-[4.75rem] content-center overflow-hidden rounded-xl border transition-colors duration-300",
                collapsed ? "border-transparent px-0" : "bg-muted/40 px-3"
              )}
            >
              {collapsed ? (
                <UsageRing used={usage.used} quota={usage.quota} className="justify-self-center" />
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 text-xs whitespace-nowrap">
                    <span className="font-medium">{t("Storage")}</span>
                    <span className="rounded-full bg-card px-1.5 py-px font-medium tabular-nums ring-1 ring-border">
                      {percentOf(usage.used, usage.quota)}%
                    </span>
                  </div>
                  <SegmentedUsage used={usage.used} quota={usage.quota} segments={22} className="mt-2 h-3" />
                  <p className="mt-1.5 truncate text-[0.6875rem] text-muted-foreground tabular-nums">{used}</p>
                </>
              )}
            </div>
          )}
          <div className="grid gap-1 border-t pt-2">
            <NavItem {...settingsNav} label={t(settingsNav.label)} collapsed={collapsed} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={me?.email}
                title={me?.email}
                className="group flex h-12 min-w-0 cursor-pointer items-center gap-3 overflow-hidden rounded-2xl px-[0.3125rem] text-left transition-colors hover:bg-foreground/[0.04] data-[state=open]:bg-foreground/[0.07]"
              >
                <span className="relative size-9 shrink-0">
                  {/* The gap around the status dot is cut out of the avatar, so it shows whatever is behind: hover, open menu, either theme. */}
                  <span className="grid size-full place-items-center rounded-full bg-forest text-sm font-medium text-lime uppercase [mask:radial-gradient(circle_at_calc(100%-5px)_calc(100%-5px),transparent_7px,#000_7.5px)]">
                    {me?.email[0]}
                  </span>
                  <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-emerald-500" />
                </span>
                <Fold collapsed={collapsed} className="flex-1">
                  <span className="block truncate text-sm font-medium">{handle}</span>
                  <span className="block truncate text-xs text-muted-foreground">{t("Unlocked")}</span>
                </Fold>
                <Fold collapsed={collapsed}>
                  <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
                </Fold>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align={collapsed ? "end" : "start"}
              side={collapsed ? "right" : "top"}
              className={cn("min-w-52", !collapsed && "w-(--radix-dropdown-menu-trigger-width)")}
            >
              <div className="flex items-center gap-3 px-2 py-2">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-forest text-sm font-medium text-lime uppercase">
                  {me?.email[0]}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{me?.email}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <LockKeyholeOpenIcon className="size-3" /> {t("Unlocked")}
                  </p>
                </div>
              </div>
              <DropdownMenuSeparator />
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
      </div>
      <button
        type="button"
        onClick={onToggle}
        title={toggleLabel}
        aria-label={toggleLabel}
        className="absolute top-[3.6rem] right-3 z-20 grid size-6 translate-x-1/2 cursor-pointer place-items-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
      >
        <Toggle className="size-3.5" />
      </button>
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
        <PreferencesMenu />
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
      <div className="grid grid-cols-5">
        {[...nav, settingsNav].map(({ to, label, icon: Icon }) => (
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
                  <Icon className="size-6" />
                </span>
                <span className="max-w-full truncate px-0.5">{t(label)}</span>
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
            <Link to="/share" className="hover:text-foreground">
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
  const [opened, setOpened] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await unlock(password, remember, async () => {
        // The lock swings open before the drive takes its place.
        setOpened(true)
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches) await new Promise((r) => setTimeout(r, 750))
      })
    } catch (err) {
      toast.error((err as Error).message)
      setPassword("")
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 py-5 sm:px-8">
        <Brand to="/drive" />
        <PreferencesMenu />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <form onSubmit={submit} className="grid w-full max-w-sm justify-items-center text-center">
          <div className="relative size-40 animate-rise sm:size-44">
            {/* Light pooling behind the lock; it blooms when the lock opens. */}
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute top-1/2 left-1/2 size-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,scale] duration-700 ease-out motion-reduce:transition-none",
                "bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--lime)_30%,transparent),color-mix(in_oklch,var(--mint)_24%,transparent)_55%,transparent)]",
                opened ? "scale-110 opacity-100" : "scale-90 opacity-60"
              )}
            />
            <div className="absolute inset-0 animate-float">
              <img
                src="/3d/lock.webp"
                alt=""
                className={cn(
                  "absolute inset-0 size-full object-contain transition-opacity duration-300 motion-reduce:transition-none",
                  opened && "opacity-0",
                  busy && !opened && "animate-pulse"
                )}
              />
              <img
                src="/3d/lock-open.webp"
                alt=""
                className={cn(
                  "absolute inset-0 size-full object-contain transition-[opacity,scale] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                  opened ? "scale-100 opacity-100 duration-700" : "scale-[1.16] opacity-0 duration-300"
                )}
              />
            </div>
            <div aria-hidden className="absolute -bottom-2 left-1/2 h-4 w-28 -translate-x-1/2 rounded-full bg-foreground/10 blur-xl" />
          </div>

          <div className="mt-8 animate-rise [animation-delay:80ms]">
            <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl">
              {opened ? t("Unlocked") : t("Your drive is locked")}
            </h1>
            <p className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1 text-sm text-muted-foreground">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-forest text-xs font-medium text-lime uppercase">
                {me?.email[0]}
              </span>
              <span className="truncate">{me?.email}</span>
            </p>
          </div>

          <div className="mt-8 grid w-full animate-rise gap-4 text-left [animation-delay:160ms]">
            <Input
              type="password"
              placeholder={t("Password")}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoFocus
              required
              className="h-12 rounded-full bg-card px-5"
            />
            <label className="flex cursor-pointer items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
              {t("Stay unlocked on this device")}
              <Switch checked={remember} onCheckedChange={setRemember} disabled={busy} />
            </label>
            <Button size="lg" type="submit" disabled={busy} className="mt-1 h-12">
              {busy && !opened ? <Loader2Icon className="animate-spin" /> : opened ? <LockKeyholeOpenIcon /> : <LockKeyholeIcon />}
              {opened ? t("Unlocked") : busy ? t("Unlocking…") : t("Unlock")}
            </Button>
          </div>

          <button
            type="button"
            onClick={() => logout()}
            disabled={busy}
            className="mt-6 animate-rise text-sm text-muted-foreground [animation-delay:240ms] hover:text-foreground"
          >
            {t("Sign in as someone else")}
          </button>
        </form>
      </main>
    </div>
  )
}
