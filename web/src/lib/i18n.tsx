import { createContext, useCallback, useContext, useState } from "react"
import { ru } from "@/lib/i18n-ru"

export type Lang = "en" | "ru"

export const LANGS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
]

const COOKIE = "coffer-lang"

function readCookie(): Lang | null {
  const m = document.cookie.match(/(?:^|;\s*)coffer-lang=(en|ru)\b/)
  return m ? (m[1] as Lang) : null
}

function browserLang(): Lang {
  const prefs = navigator.languages.length ? navigator.languages : [navigator.language]
  for (const l of prefs) {
    const base = l.toLowerCase().split("-")[0]
    if (base === "ru") return "ru"
    if (base === "en") return "en"
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

/** The active language, for code that formats outside React (dates, sizes). */
export const currentLang = (): Lang => current

type Vars = Record<string, string | number>

function fill(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
}

/** Translates an English UI string. Unknown strings fall back to English. */
export function t(en: string, vars?: Vars): string {
  return fill(current === "ru" ? (ru[en] ?? en) : en, vars)
}

function ruForm(n: number): 0 | 1 | 2 {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return 2
  if (b === 1) return 0
  if (b >= 2 && b <= 4) return 1
  return 2
}

/**
 * Plural-aware translation. `other` is the dictionary key; its Russian entry
 * holds three forms separated by "|" (one | few | many). `{n}` is filled in.
 */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  const v = { n, ...vars }
  if (current === "ru") {
    const forms = (ru[other] as string | undefined)?.split("|")
    if (forms && forms.length === 3) return fill(forms[ruForm(n)], v)
  }
  return fill(n === 1 ? one : other, v)
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: typeof t; tn: typeof tn }
const I18nContext = createContext<Ctx>({ lang: "en", setLang: () => {}, t, tn })

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // The app renders only after mount, so reading the cookie here can't cause a hydration mismatch.
  const [lang, setLangState] = useState<Lang>(() => {
    current = detectLang()
    document.documentElement.lang = current
    return current
  })

  const setLang = useCallback((l: Lang) => {
    current = l
    document.documentElement.lang = l
    const secure = location.protocol === "https:" ? "; Secure" : ""
    document.cookie = `${COOKIE}=${l}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
    setLangState(l)
  }, [])

  // Fresh function identities per language make every consumer re-render on a switch.
  const value = { lang, setLang, t: (en: string, vars?: Vars) => t(en, vars), tn: (...a: Parameters<typeof tn>) => tn(...a) }
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** Subscribes a component to the current language. */
export const useI18n = () => useContext(I18nContext)
