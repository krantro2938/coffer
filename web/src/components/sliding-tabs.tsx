import { useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * A row of tabs whose highlight slides from the tab that was chosen to the
 * one that is. The panel below is the caller's; give it `key={value}` and the
 * `animate-tab-in` class to have it ease in as the highlight lands.
 */
export function SlidingTabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T
  onChange: (value: T) => void
  tabs: readonly { value: T; label: string }[]
  className?: string
}) {
  const list = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  // The first placement must not animate in from nowhere.
  const [settled, setSettled] = useState(false)

  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const place = () => {
      const active = el.querySelector<HTMLElement>('[aria-selected="true"]')
      if (active) setPill({ left: active.offsetLeft, width: active.offsetWidth })
    }
    place()
    const frame = requestAnimationFrame(() => setSettled(true))
    // Labels change width with the language and the fonts loading.
    const watch = new ResizeObserver(place)
    watch.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      watch.disconnect()
    }
  }, [value, tabs])

  const move = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = tabs.findIndex((tab) => tab.value === value)
    const next = tabs[(i + step + tabs.length) % tabs.length]
    onChange(next.value)
    list.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus()
  }

  return (
    <div
      ref={list}
      role="tablist"
      className={cn("relative inline-flex h-10 w-fit items-center rounded-full bg-muted p-1 text-muted-foreground", className)}
    >
      {pill && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-1 rounded-full bg-background shadow-sm",
            settled && "transition-[left,width] duration-300 ease-[cubic-bezier(0.3,1.2,0.4,1)] motion-reduce:transition-none"
          )}
          style={{ left: pill.left, width: pill.width }}
        />
      )}
      {tabs.map((tab) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            data-value={tab.value}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={move}
            className={cn(
              "relative z-10 inline-flex h-full cursor-pointer items-center rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active ? "text-foreground" : "text-foreground/60 hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
