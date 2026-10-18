import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EVENTS, configureAnalytics, resetAnalytics, routePattern, setPage, track, trackOnce } from "../src/lib/analytics"

const SITE = "0c1d3e5f-1a2b-4c3d-8e9f-0123456789ab"
const URL = "https://stats.example.com"

let fetchMock: ReturnType<typeof vi.fn>

/** A browser in which the page's address is a secret: touching location or the title fails the test. */
function browser(extra: { referrer?: string; dnt?: string; gpc?: boolean } = {}) {
  const forbidden = (what: string) => () => {
    throw new Error(`the sender read ${what}`)
  }
  vi.stubGlobal("location", new Proxy({}, { get: (_t, k) => forbidden(`location.${String(k)}`)() }))
  vi.stubGlobal("document", {
    get title() {
      return forbidden("document.title")()
    },
    referrer: extra.referrer ?? "",
  })
  vi.stubGlobal("origin", "https://coffer.test")
  vi.stubGlobal("navigator", { language: "de-DE", doNotTrack: extra.dnt ?? null, globalPrivacyControl: extra.gpc })
  vi.stubGlobal("screen", { width: 1440, height: 900 })
}
const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse(c[1].body))

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(new Response("{}")))
  vi.stubGlobal("fetch", fetchMock)
  resetAnalytics()
  configureAnalytics({ url: URL, site: SITE })
  browser()
})
afterEach(() => vi.unstubAllGlobals())

describe("what a page is reported as", () => {
  it("maps router paths to patterns, and reports nothing for admin or unknown routes", () => {
    expect(routePattern("/s/$id")).toBe("/s/:id")
    expect(routePattern("/r/$id")).toBe("/r/:id")
    for (const p of [
      "/",
      "/security",
      "/terms",
      "/privacy",
      "/drive",
      "/links",
      "/requests",
      "/settings",
      "/login",
      "/register",
      "/recover",
      "/receive",
      "/welcome",
    ]) {
      expect(routePattern(p), p).toBe(p)
    }
    for (const p of ["/admin", "/admin/x", "/pay", "/s/k7m3xq2", "/s/abc#key", "/drive?folder=1", "/nope", "", undefined, null]) {
      expect(routePattern(p as string), String(p)).toBeNull()
    }
  })

  it("sends the pattern of a share link and neither its id nor its key", () => {
    // The address bar says /s/k7m3xq2#h4c9w2pz8rtf6mxn; the router says /s/$id.
    browser({ referrer: "https://mail.example.org/inbox/12345?token=secret" })
    setPage(routePattern("/s/$id"))
    track("download-started")
    expect(bodies()).toEqual([
      { type: "event", payload: { website: SITE, hostname: "coffer.test", url: "/s/:id", language: "de-DE", screen: "1440x900" } },
      {
        type: "event",
        payload: { website: SITE, hostname: "coffer.test", url: "/s/:id", language: "de-DE", screen: "1440x900", name: "download-started" },
      },
    ])
    expect(JSON.stringify(bodies())).not.toMatch(/k7m3xq2|h4c9w2pz8rtf6mxn|token|inbox|mail\.example/)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${URL}/api/send`)
    expect(init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer" })
  })

  it("sends the public pages' referrer as origin and path only, and no other page's", () => {
    browser({ referrer: "https://news.example.org/some/path?q=1#frag" })
    setPage("/")
    expect(bodies()[0].payload.referrer).toBe("https://news.example.org/some/path")
    resetAnalytics()
    configureAnalytics({ url: URL, site: SITE })
    fetchMock.mockClear()
    for (const p of ["/drive", "/settings", "/r/:id", "/login"]) {
      setPage(null)
      resetAnalytics()
      configureAnalytics({ url: URL, site: SITE })
      setPage(p)
    }
    expect(bodies().every((b) => b.payload.referrer === undefined)).toBe(true)
    // Our own site is not a referrer.
    resetAnalytics()
    configureAnalytics({ url: URL, site: SITE })
    browser({ referrer: "https://coffer.test/security" })
    fetchMock.mockClear()
    setPage("/")
    expect(bodies()[0].payload.referrer).toBeUndefined()
  })

  it("never reports the admin console", () => {
    setPage(routePattern("/admin"))
    track("hero-request")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("counts a return to a page as a new visit, and a pattern once", () => {
    setPage("/")
    setPage("/")
    setPage("/login")
    setPage(null)
    setPage("/")
    expect(bodies().map((b) => b.payload.url)).toEqual(["/", "/login", "/"])
  })
})

describe("events", () => {
  it("drops a name that is not on the list", () => {
    setPage("/drive")
    fetchMock.mockClear()
    track("file-named-secret.pdf" as never)
    track("share-created ".concat("x") as never)
    expect(fetchMock).not.toHaveBeenCalled()
    for (const name of EVENTS) track(name)
    expect(fetchMock).toHaveBeenCalledTimes(EVENTS.length)
  })

  it("carries data only for a plan click, and only a known plan id", () => {
    setPage("/")
    fetchMock.mockClear()
    track("plan-clicked", { plan: "plus" })
    track("plan-clicked", { plan: "someone@example.com" })
    track("share-created", { plan: "pro" })
    const sent = bodies().map((b) => b.payload)
    expect(sent[0].data).toEqual({ plan: "plus" })
    expect(sent[1].data).toBeUndefined()
    expect(sent[2].data).toBeUndefined()
  })

  it("fires once-events once per page view", () => {
    setPage("/")
    fetchMock.mockClear()
    trackOnce("pricing-reached")
    trackOnce("pricing-reached")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("has no event names that could be mistaken for data", () => {
    for (const name of EVENTS) expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })
})

describe("switches", () => {
  it("sends nothing until it is configured, or when the settings are malformed", () => {
    for (const c of [
      null,
      undefined,
      { url: URL, site: "nope" },
      { url: `${URL}/path`, site: SITE },
      { url: "javascript:alert(1)", site: SITE },
      { url: "stats.example.com", site: SITE },
    ]) {
      configureAnalytics(c)
      setPage(null)
      setPage("/")
      track("hero-request")
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("honours Do Not Track and Global Privacy Control", () => {
    browser({ dnt: "1" })
    setPage("/")
    track("hero-request")
    browser({ gpc: true })
    track("hero-request")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
