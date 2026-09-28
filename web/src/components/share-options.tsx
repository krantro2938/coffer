import { useState } from "react"
import { EyeIcon, EyeOffIcon, FlameIcon, KeyRoundIcon, TimerIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EXPIRY_OPTIONS, VIEW_OPTIONS } from "@/lib/format"
import { cn } from "@/lib/utils"

export type ShareOptionsState = {
  expiresIn: number // seconds, 0 = never
  maxViews: number // 0 = unlimited
  usePassword: boolean
  password: string
}

export const defaultShareOptions = (expiresIn = 86400): ShareOptionsState => ({
  expiresIn,
  maxViews: 0,
  usePassword: false,
  password: "",
})

export function ShareOptionsFields({
  value,
  onChange,
  maxExpiry,
  className,
}: {
  value: ShareOptionsState
  onChange: (v: ShareOptionsState) => void
  maxExpiry?: number
  className?: string
}) {
  const [show, setShow] = useState(false)
  const set = (patch: Partial<ShareOptionsState>) => onChange({ ...value, ...patch })
  const expiries = EXPIRY_OPTIONS.filter((o) => !maxExpiry || (o.value > 0 && o.value <= maxExpiry))

  return (
    <div className={cn("grid gap-3", className)}>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TimerIcon className="size-3.5" /> Expires
          </Label>
          <Select value={String(value.expiresIn)} onValueChange={(v) => set({ expiresIn: Number(v) })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {expiries.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FlameIcon className="size-3.5" /> Views
          </Label>
          <Select value={String(value.maxViews)} onValueChange={(v) => set({ maxViews: Number(v) })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIEW_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="rounded-xl border bg-muted/40 p-3">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm">
            <KeyRoundIcon className="size-4 text-muted-foreground" />
            Require a password
          </span>
          <Switch checked={value.usePassword} onCheckedChange={(c) => set({ usePassword: c })} />
        </label>
        {value.usePassword && (
          <div className="relative mt-3">
            <Input
              type={show ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Link password"
              value={value.password}
              onChange={(e) => set({ password: e.target.value })}
              className="pr-10"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              Mixed into the encryption key. Share it through a different channel than the link.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export function toShareOptions(v: ShareOptionsState) {
  return {
    password: v.usePassword && v.password ? v.password : undefined,
    maxViews: v.maxViews || null,
    expiresIn: v.expiresIn || null,
  }
}
