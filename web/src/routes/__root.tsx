import { useEffect, useState } from "react"
import { HeadContent, Link, Outlet, Scripts, createRootRoute, useRouterState } from "@tanstack/react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { getConfig } from "@/lib/api"
import { configureAnalytics, routePattern, setPage } from "@/lib/analytics"
import { SessionProvider } from "@/lib/session"
import { ThemeProvider, themeInitScript } from "@/lib/theme"
import { I18nProvider, useI18n } from "@/lib/i18n"

import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      // Also the home page's; the server sends each public page its own (server/internal/app/seo.go).
      { title: "Coffer — collect documents from clients, end-to-end encrypted" },
      {
        name: "description",
        content:
          "Send a link and your clients upload documents from any browser, no account needed. Files are encrypted before they leave, so only you can open them. Free to start.",
      },
      { name: "referrer", content: "no-referrer" },
      { name: "theme-color", content: "#fbfbf9" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "manifest", href: "/manifest.json" },
    ],
    scripts: [{ children: themeInitScript }],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
  component: App,
})

function App() {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }))
  // The prerendered SPA shell has an empty outlet; rendering only after mount
  // keeps hydration trivially consistent however fast route chunks load.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  usePageViews()
  if (!mounted) return null
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <TooltipProvider delayDuration={300}>
              <Outlet />
              <Toaster position="bottom-center" />
            </TooltipProvider>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

/** Tells the counter which page is showing, by route pattern, when the operator has turned counting on. See lib/analytics.ts. */
function usePageViews() {
  // The matched route's own path ("/s/$id"), never the address: ids and #keys stay out of reach.
  const route = useRouterState({ select: (s) => s.matches[s.matches.length - 1]?.fullPath })
  const pattern = routePattern(route)
  useEffect(() => {
    if (!pattern) return setPage(null)
    let live = true
    getConfig()
      .then((c) => {
        if (!live) return
        configureAnalytics(c.analytics)
        setPage(pattern)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [pattern])
}

function NotFound() {
  const { t } = useI18n()
  return (
    <main className="grid min-h-svh place-items-center p-6 text-center">
      <div className="grid gap-4">
        <p className="eyebrow">{t("Error 404")}</p>
        <h1 className="text-4xl font-medium">{t("Nothing to see here.")}</h1>
        <p className="text-muted-foreground">{t("Which, for an encrypted drive, is kind of the point.")}</p>
        <Button asChild className="mx-auto mt-2">
          <Link to="/">{t("Back home")}</Link>
        </Button>
      </div>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
