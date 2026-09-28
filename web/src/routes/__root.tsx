import { useEffect, useState } from "react"
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { SessionProvider } from "@/lib/session"
import { ThemeProvider, themeInitScript } from "@/lib/theme"

import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Coffer — private, end-to-end encrypted sharing" },
      {
        name: "description",
        content: "Share files and text with end-to-end encryption. Your keys never leave your browser.",
      },
      { name: "referrer", content: "no-referrer" },
      { name: "theme-color", content: "#f7f6f1", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#0f1612", media: "(prefers-color-scheme: dark)" },
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
        <SessionProvider>
          <TooltipProvider delayDuration={300}>
            <Outlet />
            <Toaster position="bottom-center" />
          </TooltipProvider>
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center p-6 text-center">
      <div className="grid gap-4">
        <p className="eyebrow">Error 404</p>
        <h1 className="text-4xl font-medium">Nothing to see here.</h1>
        <p className="text-muted-foreground">Which, for an encrypted drive, is kind of the point.</p>
        <Button asChild className="mx-auto mt-2">
          <Link to="/">Back home</Link>
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
