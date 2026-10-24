// Optional, cookieless counting of visits and a short list of actions, sent to
// a self-hosted Umami. Nothing here loads remote code: this file POSTs a small
// JSON body to Umami's collection endpoint and that is all.
//
// The boundary is enforced in send(), not at the call sites:
//   - a page is only ever reported as one of the route PATTERNS below, taken
//     from the router ("/s/:id", never "/s/k7m3xq2"). The sender does not read
//     location or document.title at all, so no id, query or #fragment (where
//     link keys live) can reach it;
//   - an event is one of EVENTS or it is dropped, and carries no data except a
//     plan id on the pricing buttons;
//   - the referring site is read on the public pages only;
//   - Do Not Track and Global Privacy Control switch it off;
//   - no cookie, no storage, no identifier of our own, and the reply is ignored.
// What is sent is described in docs/security.md; keep the two in step.
// /admin is never reported, and /pay is a separate page that does not load this.

export type AnalyticsConfig = { url: string; site: string }

/** The marketing pages. They also report the referring site and their real path, which is a fixed word. */
const PUBLIC_PAGES: ReadonlySet<string> = new Set(["/", "/security", "/terms", "/privacy", "/dpa"])

/** The rest of the app, by pattern. A route not listed here (admin, not found) reports nothing. */
const APP_PAGES: ReadonlySet<string> = new Set([
  "/receive",
  "/welcome",
  "/login",
  "/register",
  "/recover",
  "/drive",
  "/links",
  "/share",
  "/requests",
  "/settings",
  "/s/:id",
  "/r/:id",
])

/** Every event that exists, in one place. Anything else is dropped. */
export const EVENTS = [
  // Landing page
  "hero-request", // hero: "Create a request link"
  "hero-send", // hero: "Just need to send a file?"
  "composer-used", // a file was added to the quick-share composer
  "pricing-reached", // the pricing section scrolled into view
  "plan-clicked", // a plan's button; data.plan is the plan id
  "signup-header", // header: "Get a drive"
  "signup-drive", // drive section: "Create your drive"
  "waitlist-joined", // pricing: left an address to hear when the paid plans open
  // The app
  "signup-completed", // an account was created
  "login-completed", // someone signed in
  "share-dialog-opened", // the share dialog of a file or folder
  "share-created", // a share link was made, from the drive or the composer
  "request-created", // an upload link was made
  "upload-started", // someone pressed send on an upload link
  "download-started", // a share's file or zip was saved
] as const
export type AnalyticsEvent = (typeof EVENTS)[number]

const EVENT_NAMES: ReadonlySet<string> = new Set(EVENTS)
const PLAN_IDS: ReadonlySet<string> = new Set(["free", "starter", "plus", "pro"])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let config: AnalyticsConfig | null = null
// The pattern of the page being shown, or null where nothing is reported.
let page: string | null = null
// Events that fire once per page view (a pricing section stays in view, a composer takes many files).
let fired = new Set<string>()
let first = true

/** Turn analytics on with what /api/config says, or off with null. Anything malformed turns it off. */
export function configureAnalytics(c: AnalyticsConfig | null | undefined) {
  config = null
  if (!c || !UUID.test(c.site)) return
  try {
    const u = new URL(c.url)
    if ((u.protocol === "https:" || u.protocol === "http:") && u.origin === c.url) config = { url: u.origin, site: c.site }
  } catch {
    // not a URL: stay off
  }
}

/** A route's path as the router names it ("/s/$id") to the pattern we report ("/s/:id"), or null if it is not reported. */
export function routePattern(routePath: string | undefined | null): string | null {
  if (!routePath) return null
  const p = routePath.replace(/\$[A-Za-z_]+/g, (m) => `:${m.slice(1)}`)
  return PUBLIC_PAGES.has(p) || APP_PAGES.has(p) ? p : null
}

function optedOut(): boolean {
  const nav = globalThis.navigator as (Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string }) | undefined
  const win = globalThis as { doNotTrack?: string }
  const dnt = [nav?.doNotTrack, win.doNotTrack, nav?.msDoNotTrack]
  return dnt.some((v) => v === "1" || v === "yes") || nav?.globalPrivacyControl === true
}

/** The external site that sent the visitor here: its origin and path, never a query or fragment. */
function referrer(): string | undefined {
  try {
    const r = globalThis.document?.referrer
    if (!r) return
    const u = new URL(r)
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.origin === globalThis.origin) return
    return u.origin + u.pathname
  } catch {
    return
  }
}

/** This site's hostname, taken from its origin rather than from location. */
function hostname(): string | undefined {
  try {
    return new URL(globalThis.origin).hostname
  } catch {
    return
  }
}

function send(name?: AnalyticsEvent, data?: { plan: string }) {
  if (!config || !page || optedOut()) return
  if (name !== undefined && !EVENT_NAMES.has(name)) return
  const nav = globalThis.navigator
  const payload: Record<string, unknown> = {
    website: config.site,
    // The site's own name (coffer.rest), from its origin; without it Umami files every visit under "localhost".
    hostname: hostname(),
    url: page,
    language: nav.language,
    screen: `${globalThis.screen?.width ?? 0}x${globalThis.screen?.height ?? 0}`,
  }
  // Only the first page view of a document has a referrer worth sending, and only a public page may read it.
  if (first && PUBLIC_PAGES.has(page)) {
    const ref = referrer()
    if (ref) payload.referrer = ref
  }
  if (name) payload.name = name
  if (name === "plan-clicked" && data && PLAN_IDS.has(data.plan)) payload.data = { plan: data.plan }
  first = false
  void fetch(`${config.url}/api/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "event", payload }),
    // No cookies, no Referer header (which would carry our own page address), and the reply is not read.
    credentials: "omit",
    referrerPolicy: "no-referrer",
    keepalive: true,
  }).catch(() => {})
}

/** Say which page is showing, by pattern (null: one that is never reported), and count the visit. */
export function setPage(pattern: string | null) {
  const next = pattern !== null && (PUBLIC_PAGES.has(pattern) || APP_PAGES.has(pattern)) ? pattern : null
  if (next === page) return
  page = next
  fired = new Set()
  if (page) send()
}

/** Count something that happened on the current page. */
export function track(name: AnalyticsEvent, data?: { plan: string }) {
  send(name, data)
}

/** Like track, but at most once per page view. */
export function trackOnce(name: AnalyticsEvent) {
  if (fired.has(name)) return
  fired.add(name)
  send(name)
}

/** For tests. */
export function resetAnalytics() {
  config = null
  page = null
  fired = new Set()
  first = true
}
