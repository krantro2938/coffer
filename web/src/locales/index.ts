/**
 * The languages the app speaks. Each has a folder here; a language's files
 * mirror the parts of the app (landing.ts, drive.ts, ...), and every entry is
 * keyed by the English text in the code. A missing entry falls back to English.
 *
 * To add a language: copy a folder, translate the values, and list it below.
 */
import en from "./en"
import type { Locale } from "./types"

export type { Locale, Messages } from "./types"

export const LANGS = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "nl", label: "Nederlands" },
  { value: "ru", label: "Русский" },
  { value: "zh", label: "中文" },
] as const

export type Lang = (typeof LANGS)[number]["value"]

export const isLang = (s: string): s is Lang => LANGS.some((l) => l.value === s)

/** English ships with the app; the others are fetched when first chosen. */
const loaders: Record<Lang, () => Promise<Locale>> = {
  en: async () => en,
  de: async () => (await import("./de")).default,
  es: async () => (await import("./es")).default,
  nl: async () => (await import("./nl")).default,
  ru: async () => (await import("./ru")).default,
  zh: async () => (await import("./zh")).default,
}

export const english = en

export function loadLocale(lang: Lang): Promise<Locale> {
  return loaders[lang]()
}
