import { Link } from "@tanstack/react-router"
import { ArrowRightIcon, InboxIcon, ShieldCheckIcon } from "lucide-react"
import { Brand } from "@/components/brand"
import { LangToggle } from "@/components/lang-toggle"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"

export function SiteHeader() {
  const { status } = useSession()
  const { t } = useI18n()
  const signedIn = status === "locked" || status === "unlocked"
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/80 backdrop-blur-xl supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Brand />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link to="/" hash="how" className="transition-colors hover:text-foreground">
              {t("How it works")}
            </Link>
            <Link to="/security" className="transition-colors hover:text-foreground">
              {t("Security")}
            </Link>
            <Link to="/receive" className="transition-colors hover:text-foreground">
              {t("Receive")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" asChild className="md:hidden" aria-label={t("Receive")}>
            <Link to="/receive">
              <InboxIcon />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" asChild className="md:hidden" aria-label={t("Security")}>
            <Link to="/security">
              <ShieldCheckIcon />
            </Link>
          </Button>
          <LangToggle />
          <ThemeToggle />
          {signedIn ? (
            <Button asChild className="ml-1">
              <Link to="/drive">
                {t("Open drive")} <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild className="hidden sm:inline-flex">
                <Link to="/login">{t("Sign in")}</Link>
              </Button>
              <Button asChild className="ml-1">
                <Link to="/register">{t("Get a drive")}</Link>
              </Button>
            </>
          )}
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
        <Brand className="text-foreground" />
        <p className="eyebrow">{t("End-to-end encrypted · AES-256-GCM · Argon2id")}</p>
        <nav className="flex gap-5">
          <Link to="/security" className="hover:text-foreground">
            {t("Security")}
          </Link>
          <Link to="/receive" className="hover:text-foreground">
            {t("Receive")}
          </Link>
          <Link to="/login" className="hover:text-foreground">
            {t("Sign in")}
          </Link>
        </nav>
      </div>
    </footer>
  )
}
