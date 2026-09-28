import { useState } from "react"
import { EyeIcon, EyeOffIcon, FlameIcon, KeyRoundIcon, Link2Icon, ShieldAlertIcon, TimerIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { OptionPicker } from "@/components/option-picker"
import { EXPIRY_OPTIONS, VIEW_OPTIONS } from "@/lib/format"
import { cn } from "@/lib/utils"

export type ShareOptionsState = {
  expiresIn: number // seconds, 0 = never
  maxViews: number // 0 = unlimited
  usePassword: boolean
  password: string
  shortLink: boolean
}

export const defaultShareOptions = (expiresIn = 86400): ShareOptionsState => ({
  expiresIn,
  maxViews: 0,
  usePassword: false,
  password: "",
  shortLink: false,
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
        <OptionPicker
          label="Expires"
          icon={TimerIcon}
          value={value.expiresIn}
          options={expiries}
          onChange={(v) => set({ expiresIn: v })}
        />
        <OptionPicker
          label="Views"
          icon={FlameIcon}
          value={value.maxViews}
          options={VIEW_OPTIONS}
          onChange={(v) => set({ maxViews: v })}
        />
      </div>
      <div className="divide-y rounded-xl border bg-muted/40">
        <div className="p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <KeyRoundIcon className="size-4 text-muted-foreground" />
              Require a password
            </span>
            <Switch checked={value.usePassword} onCheckedChange={(c) => set({ usePassword: c })} />
          </label>
          {value.usePassword && (
            <div className="mt-3 grid gap-2">
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Link password"
                  value={value.password}
                  onChange={(e) => set({ password: e.target.value })}
                  className="pr-11"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute inset-y-0 right-1 grid w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Mixed into the encryption key. Share it through a different channel than the link.
              </p>
            </div>
          )}
        </div>
        <div className="p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <Link2Icon className="size-4 text-muted-foreground" />
              Short link only
            </span>
            <Switch checked={value.shortLink} onCheckedChange={(c) => set({ shortLink: c })} />
          </label>
          {value.shortLink && (
            <p className="mt-2 flex gap-2 text-xs text-muted-foreground">
              <ShieldAlertIcon className="mt-px size-3.5 shrink-0 text-coral" />
              <span>
                Just <span className="font-mono text-foreground">/s/k7m3xq2</span> — easy to type, no key in the link. The
                server keeps the key, so this isn't end-to-end encrypted
                {value.usePassword ? " — but your password still is." : ". Add a password to keep it private."}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export function toShareOptions(v: ShareOptionsState) {
  return {
    password: v.usePassword && v.password ? v.password : undefined,
    maxViews: v.maxViews || null,
    expiresIn: v.expiresIn || null,
    shortLink: v.shortLink,
  }
}
