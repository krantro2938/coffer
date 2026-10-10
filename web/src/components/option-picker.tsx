import { useState } from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type PickerOption = { label: string; hint?: string; value: number }

/** A compact trigger that opens a roomy popover of labelled choices. */
export function OptionPicker({
  label,
  icon: Icon,
  value,
  options,
  onChange,
  placeholder,
}: {
  /** Shown instead of a choice while `value` matches none of the options. */
  placeholder?: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  value: number
  options: readonly PickerOption[]
  onChange: (v: number) => void
}) {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  const chosen = options.find((o) => o.value === value)
  const current = chosen ?? options[0]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex h-12 w-full min-w-0 items-center gap-2.5 rounded-xl border border-input bg-card px-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:border-ring dark:bg-input/30"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.6875rem] leading-tight text-muted-foreground">{t(label)}</span>
            <span
              className={cn(
                "block truncate text-sm leading-tight font-medium",
                !chosen && placeholder && "font-normal text-muted-foreground"
              )}
            >
              {!chosen && placeholder ? t(placeholder) : t(current.label)}
            </span>
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-(--radix-popover-trigger-width) min-w-60 rounded-2xl p-1.5 shadow-soft">
        <p className="px-2.5 pt-1.5 pb-1 eyebrow">{t(label)}</p>
        <div role="listbox" className="grid gap-0.5">
          {options.map((o) => {
            const selected = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted",
                  selected && "bg-secondary/60 hover:bg-secondary/80"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t(o.label)}</span>
                  {o.hint && <span className="block text-xs text-muted-foreground">{t(o.hint)}</span>}
                </span>
                {selected && <CheckIcon className="size-4 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
