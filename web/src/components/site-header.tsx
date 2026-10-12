import { Link } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { ArrowRightIcon, ArrowUpRightIcon, CheckIcon, GlobeIcon, MenuIcon, MonitorIcon, MoonIcon, SunIcon, XIcon } from "lucide-react"
import { Brand } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { LANGS, useI18n } from "@/lib/i18n"
import type { Lang } from "@/lib/i18n"
import { useTheme, type Theme } from "@/lib/theme"
import { usePlans } from "@/components/plans"
import { GitHubMark, XMark, YouTubeMark } from "@/components/brand-icons"
import { GITHUB_URL, SUPPORT_EMAIL, X_URL, YOUTUBE_URL } from "@/lib/contact"
import { track } from "@/lib/analytics"
import { useSession } from "@/lib/session"

const SOCIALS = [
  { url: GITHUB_URL, label: "GitHub", icon: GitHubMark },
  { url: X_URL, label: "X", icon: XMark },
  { url: YOUTUBE_URL, label: "YouTube", icon: YouTubeMark },
]

/** Three equal segments with a thumb under the active one: click a segment, or drag the thumb across. */
function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()
  const bar = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const options: { value: Theme; label: string; icon: typeof SunIcon }[] = [
    { value: "light", label: t("Light"), icon: SunIcon },
    { value: "dark", label: t("Dark"), icon: MoonIcon },
    { value: "system", label: t("System"), icon: MonitorIcon },
  ]
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === theme)
  )
  const pick = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect()
    if (!r) return
    const i = Math.min(options.length - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * options.length)))
    if (options[i].value !== theme) setTheme(options[i].value)
  }
  return (
    <div
      ref={bar}
      role="radiogroup"
      aria-label={t("Theme")}
      className="relative grid h-11 touch-none grid-cols-3 rounded-full bg-muted p-1 select-none"
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        pick(e.clientX)
      }}
      onPointerMove={(e) => dragging.current && pick(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-card shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.3,1.2,0.4,1)] motion-reduce:transition-none"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") setTheme(value)
          }}
          className={`relative z-10 flex items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-colors ${
            theme === value ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          <Icon className="size-4" /> {label}
        </button>
      ))}
    </div>
  )
}

function Preferences({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n()
  return (
    <div className={className}>
      <ThemeSwitch />
      <p className="mt-5 mb-1.5 px-1 text-xs font-medium text-muted-foreground">{t("Language")}</p>
      <div role="radiogroup" aria-label={t("Language")} className="grid grid-cols-2 gap-1">
        {LANGS.map((l) => (
          <button
            key={l.value}
            type="button"
            role="radio"
            aria-checked={lang === l.value}
            onClick={() => setLang(l.value as Lang)}
            className={`flex h-10 items-center justify-between gap-2 rounded-xl px-3 text-left text-sm transition-colors ${
              lang === l.value ? "bg-secondary font-medium text-secondary-foreground" : "hover:bg-muted"
            }`}
          >
            {l.label}
            {lang === l.value && <CheckIcon className="size-4" />}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Language and theme share one control, wherever a bar needs them. */
export function PreferencesMenu() {
  const { t } = useI18n()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("Language and theme")} className="rounded-full">
          <GlobeIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-3xl p-3">
        <Preferences />
      </PopoverContent>
    </Popover>
  )
}

export function SiteHeader() {
  const { status } = useSession()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const signedIn = status === "locked" || status === "unlocked"
  const plans = usePlans()
  const links = [
    { label: t("How it works"), to: "/", hash: "how" },
    { label: t("Use cases"), to: "/", hash: "use-cases" },
    ...(plans ? [{ label: t("Pricing"), to: "/", hash: "pricing" }] : []),
    { label: t("Security"), to: "/security" },
  ]
  const cta = signedIn ? (
    <Button asChild className="h-10 px-5">
      <Link to="/drive">{t("Open drive")}</Link>
    </Button>
  ) : (
    <Button asChild className="h-10 px-5">
      <Link to="/register" onClick={() => track("signup-header")}>
        {t("Get a drive")}
      </Link>
    </Button>
  )
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 pb-3 sm:px-4">
      <div className="mx-auto flex h-14 max-w-[88rem] items-center justify-between gap-3 rounded-full border bg-card/85 pr-2 pl-4 shadow-soft backdrop-blur-xl md:grid md:grid-cols-[1fr_auto_1fr]">
        <Brand />
        <nav className="hidden items-center gap-1 text-sm md:flex">
          {links.map(({ label, ...to }) => (
            <Link
              key={label}
              {...to}
              className="rounded-full px-3.5 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center justify-end gap-1">
          <div className="hidden items-center gap-1 md:flex">
            <Button variant="ghost" size="icon" asChild className="rounded-full" aria-label={t("Source on GitHub")}>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <GitHubMark className="size-4.5" />
              </a>
            </Button>
            <PreferencesMenu />
            {!signedIn && (
              <Button variant="ghost" asChild className="h-10 px-4">
                <Link to="/login">{t("Sign in")}</Link>
              </Button>
            )}
          </div>
          {cta}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full md:hidden" aria-label={t("Menu")}>
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="top" showCloseButton={false} className="rounded-b-[2rem] px-5 pt-4 pb-6">
              <SheetTitle className="sr-only">{t("Menu")}</SheetTitle>
              <div className="flex items-center justify-between">
                <Brand />
                <Button variant="ghost" size="icon" className="rounded-full" aria-label={t("Close")} onClick={() => setOpen(false)}>
                  <XIcon />
                </Button>
              </div>
              <nav className="mt-2 grid">
                {links.map(({ label, ...to }) => (
                  <Link
                    key={label}
                    {...to}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between border-b py-3.5 font-heading text-2xl font-medium tracking-tight"
                  >
                    {label}
                    <ArrowRightIcon className="size-5 text-muted-foreground" />
                  </Link>
                ))}
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between py-3.5 font-heading text-2xl font-medium tracking-tight"
                >
                  <span className="flex items-center gap-2.5">
                    <GitHubMark className="size-5" /> GitHub
                  </span>
                  <ArrowUpRightIcon className="size-5 text-muted-foreground" />
                </a>
              </nav>
              <Preferences className="mt-3" />
              {!signedIn && (
                <Button variant="outline" size="lg" asChild className="mt-6 w-full">
                  <Link to="/login" onClick={() => setOpen(false)}>
                    {t("Sign in")}
                  </Link>
                </Button>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  const { t } = useI18n()
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-4">
          <Brand className="text-foreground" />
          <span className="flex items-center gap-1">
            {SOCIALS.filter((s) => s.url).map(({ url, label, icon: Icon }) => (
              <a
                key={label}
                href={url}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                title={label}
                className="grid size-8 place-items-center rounded-full transition-colors hover:bg-muted hover:text-foreground"
              >
                <Icon className="size-4" />
              </a>
            ))}
          </span>
        </div>
        <p className="eyebrow">{t("Open source. We can't read your files.")}</p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <Link to="/security" className="hover:text-foreground">
            {t("Security")}
          </Link>
          <Link to="/receive" className="hover:text-foreground">
            {t("Receive")}
          </Link>
          <Link to="/terms" className="hover:text-foreground">
            {t("Terms")}
          </Link>
          <Link to="/privacy" className="hover:text-foreground">
            {t("Privacy")}
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-foreground">
            {t("Contact")}
          </a>
          <Link to="/login" className="hover:text-foreground">
            {t("Sign in")}
          </Link>
        </nav>
      </div>
    </footer>
  )
}
