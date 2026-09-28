import { useEffect, useState } from "react"

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mq = matchMedia(query)
    setMatches(mq.matches)
    const on = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [query])
  return matches
}

export const useIsDesktop = () => useMediaQuery("(min-width: 768px)")
