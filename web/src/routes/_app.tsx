import { useEffect, useState } from "react"
import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  ChevronsUpDownIcon,
  LockKeyholeOpenIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  HardDriveIcon,
  HomeIcon,
  Link2Icon,
  Loader2Icon,
  LockIcon,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDrive } from "@/lib/drive"
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
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const

function AppLayout() {
  const { status } = useSession()
  const navigate = useNavigate()

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
  if (status === "locked") return <UnlockScreen />

  return (
    <div className="min-h-svh md:grid md:grid-cols-[16rem_1fr]">
      <Sidebar />
      <div className="flex min-h-svh min-w-0 flex-col">
        <MobileTopBar />
        <main className="flex-1 pb-24 md:pb-0">
          <Outlet />
        </main>
      </div>
      <MobileTabBar />
    </div>
  )
}

function Sidebar() {
  const { me, lock, logout } = useSession()
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
        {usage && (
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
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("Language")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)}>
              {LANGS.map((l) => (
                <DropdownMenuRadioItem key={l.value} value={l.value}>
                  <LanguagesIcon /> {l.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => lock()}>
              <LockIcon /> {t("Lock drive")}
            </DropdownMenuItem>
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
  const { me, lock, logout } = useSession()
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
            <DropdownMenuItem onClick={() => lock()}>
              <LockIcon /> {t("Lock drive")}
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
      <div className="grid grid-cols-3">
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex flex-col items-center gap-1 py-2.5 text-[0.6875rem] text-muted-foreground"
            activeProps={{ className: "!text-foreground" }}
          >
            {({ isActive }) => (
              <>
                <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", isActive && "bg-secondary text-secondary-foreground")}>
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
