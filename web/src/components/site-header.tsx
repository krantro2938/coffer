import { Link } from "@tanstack/react-router"
import { ArrowRightIcon, InboxIcon, ShieldCheckIcon } from "lucide-react"
import { Brand } from "@/components/brand"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { useSession } from "@/lib/session"

export function SiteHeader() {
  const { status } = useSession()
  const signedIn = status === "locked" || status === "unlocked"
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/80 backdrop-blur-xl supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Brand />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link to="/" hash="how" className="transition-colors hover:text-foreground">
              How it works
            </Link>
            <Link to="/security" className="transition-colors hover:text-foreground">
              Security
            </Link>
            <Link to="/receive" className="transition-colors hover:text-foreground">
              Receive
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" asChild className="md:hidden" aria-label="Receive">
            <Link to="/receive">
              <InboxIcon />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" asChild className="md:hidden" aria-label="Security">
            <Link to="/security">
              <ShieldCheckIcon />
            </Link>
          </Button>
          <ThemeToggle />
          {signedIn ? (
            <Button asChild className="ml-1">
              <Link to="/drive">
                Open drive <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild className="hidden sm:inline-flex">
                <Link to="/login">Sign in</Link>
              </Button>
              <Button asChild className="ml-1">
                <Link to="/register">Get a drive</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Brand className="text-foreground" />
        <p className="eyebrow">End-to-end encrypted · AES-256-GCM · Argon2id</p>
        <nav className="flex gap-5">
          <Link to="/security" className="hover:text-foreground">
            Security
          </Link>
          <Link to="/receive" className="hover:text-foreground">
            Receive
          </Link>
          <Link to="/login" className="hover:text-foreground">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  )
}
