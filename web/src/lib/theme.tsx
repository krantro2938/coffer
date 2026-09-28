import { createContext, useCallback, useContext, useEffect, useState } from "react"

export type Theme = "light" | "dark" | "system"

const KEY = "coffer-theme"

/** Runs before first paint (inlined in <head>) to avoid a flash of the wrong theme. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})()`

type Ctx = { theme: Theme; resolved: "light" | "dark"; setTheme: (t: Theme) => void }
const ThemeContext = createContext<Ctx>({ theme: "system", resolved: "light", setTheme: () => {} })

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    if (t === "light" || t === "dark" || t === "system") return t
  } catch {
    /* storage unavailable */
  }
  return "system"
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system")
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    setThemeState(readTheme())
    const mq = matchMedia("(prefers-color-scheme: dark)")
    setSystemDark(mq.matches)
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])

  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", resolved === "dark")
    root.style.colorScheme = resolved
  }, [resolved])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    try {
      localStorage.setItem(KEY, t)
    } catch {
      /* storage unavailable */
    }
  }, [])

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
