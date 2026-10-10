import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { english, isLang, loadLocale, type Lang, type Locale } from "@/locales"

export { LANGS, type Lang } from "@/locales"

const COOKIE = "coffer-lang"

function readCookie(): Lang | null {
  const m = document.cookie.match(/(?:^|;\s*)coffer-lang=([a-z]{2})\b/)
  return m && isLang(m[1]) ? m[1] : null
}

function browserLang(): Lang {
  const prefs = navigator.languages.length ? navigator.languages : [navigator.language]
  for (const l of prefs) {
    const base = l.toLowerCase().split("-")[0]
    if (isLang(base)) return base
  }
  return "en"
}

/** Cookie first (an explicit choice), then the browser's preferred languages. */
export function detectLang(): Lang {
  try {
    return readCookie() ?? browserLang()
  } catch {
    return "en"
  }
}

// Module-level so non-React code (thrown errors, toasts from lib/) speaks the same language.
let current: Lang = "en"
let locale: Locale = english

/** The active language, for code that formats outside React (dates, sizes). */
export const currentLang = (): Lang => current

type Vars = Record<string, string | number>

function fill(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
}

/** Translates an English UI string. Unknown strings fall back to English. */
export function t(en: string, vars?: Vars): string {
  return fill(locale.messages[en] ?? en, vars)
}

/**
 * Plural-aware translation. `other` is the dictionary key; its entry holds the
 * language's plural forms separated by "|". `{n}` is filled in.
 */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  const v = { n, ...vars }
  const forms = locale.messages[other]?.split("|")
  if (forms) return fill(forms[Math.min(locale.plural(n), forms.length - 1)], v)
  return fill(n === 1 ? one : other, v)
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: typeof t; tn: typeof tn }
const I18nContext = createContext<Ctx>({ lang: "en", setLang: () => {}, t, tn })

function activate(lang: Lang, loaded: Locale) {
  current = lang
  locale = loaded
  document.documentElement.lang = lang
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Null until the first language has loaded; nothing is rendered before that,
  // so the page never flashes English at someone who reads another language.
  const [lang, setLangState] = useState<Lang | null>(null)

  useEffect(() => {
    const wanted = detectLang()
    loadLocale(wanted)
      .then((loaded) => activate(wanted, loaded))
      .catch(() => activate("en", english))
      .finally(() => setLangState(current))
  }, [])

  const setLang = useCallback((l: Lang) => {
    const secure = location.protocol === "https:" ? "; Secure" : ""
    document.cookie = `${COOKIE}=${l}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
    void loadLocale(l).then((loaded) => {
      activate(l, loaded)
      setLangState(l)
    })
  }, [])

  if (!lang) return null
  // Fresh function identities per language make every consumer re-render on a switch.
  const value = { lang, setLang, t: (en: string, vars?: Vars) => t(en, vars), tn: (...a: Parameters<typeof tn>) => tn(...a) }
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** Subscribes a component to the current language. */
export const useI18n = () => useContext(I18nContext)
