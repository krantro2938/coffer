import { useEffect, useState } from "react"
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
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
      { title: "Coffer — send and request private files, no account needed" },
      {
        name: "description",
        content:
          "Share private files without making the other person sign up for anything. End-to-end encrypted file sharing and upload links: your keys never leave your browser.",
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
