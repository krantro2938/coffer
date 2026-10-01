import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { LanguagesIcon, Loader2Icon, LockIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { PasswordStrength, strength } from "@/components/auth-layout"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useDrive } from "@/lib/drive"
import { UsageBar } from "@/components/usage-bar"
import { formatBytes, shortDate } from "@/lib/format"
import { useSession } from "@/lib/session"
import { useTheme, type Theme } from "@/lib/theme"
import { LANGS, useI18n } from "@/lib/i18n"
import type { Lang } from "@/lib/i18n"

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage })

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <section className="grid gap-4 border-t py-8 md:grid-cols-[14rem_1fr] md:gap-10">
      <div>
        <h2 className="font-medium">{t(title)}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{t(description)}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function SettingsPage() {
  const { me, lock, logout } = useSession()
  const { theme, setTheme } = useTheme()
  const { t, lang, setLang } = useI18n()
  const { data } = useDrive()
  const usage = data?.usage ?? (me ? { used: me.used, quota: me.quota } : { used: 0, quota: 1 })

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <p className="eyebrow">{t("Account")}</p>
      <h1 className="mt-1 mb-8 text-3xl font-medium">{t("Settings")}</h1>

      <Section title="Profile">
        <div className="grid gap-4 rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-secondary text-lg font-medium text-secondary-foreground uppercase">
              {me?.email[0]}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{me?.email}</p>
              <p className="text-sm text-muted-foreground">{t("Member since {date}", { date: me ? shortDate(me.createdAt) : "—" })}</p>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-sm">
              <span>{t("Storage")}</span>
              <span className="text-muted-foreground">
                {t("{used} of {total}", { used: formatBytes(usage.used), total: formatBytes(usage.quota) })}
              </span>
            </div>
            <div className="mt-2">
              <UsageBar used={usage.used} quota={usage.quota} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Appearance" description="Light by default. Dark and system are one click away.">
        <ToggleGroup
          type="single"
          value={theme}
          onValueChange={(v) => v && setTheme(v as Theme)}
          variant="outline"
          className="w-full sm:w-auto"
        >
          <ToggleGroupItem value="light" className="flex-1 gap-2 px-4">
            <SunIcon /> {t("Light")}
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" className="flex-1 gap-2 px-4">
            <MoonIcon /> {t("Dark")}
          </ToggleGroupItem>
          <ToggleGroupItem value="system" className="flex-1 gap-2 px-4">
            <MonitorIcon /> {t("System")}
          </ToggleGroupItem>
        </ToggleGroup>
      </Section>

      <Section title="Language" description="Detected from your browser; your choice is remembered on this device.">
        <ToggleGroup
          type="single"
          value={lang}
          onValueChange={(v) => v && setLang(v as Lang)}
          variant="outline"
          className="w-full sm:w-auto"
        >
          {LANGS.map((l) => (
            <ToggleGroupItem key={l.value} value={l.value} className="flex-1 gap-2 px-4">
              <LanguagesIcon /> {l.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>

      <Section title="Password" description="Your files aren't re-encrypted — only the key that unlocks them is re-sealed.">
        <ChangePassword />
      </Section>

      <Section title="This device" description="Locking forgets the key on this device; signing out also ends the session.">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => lock()}>
            <LockIcon /> {t("Lock now")}
          </Button>
          <Button variant="outline" onClick={() => logout()}>
            <LogOutIcon /> {t("Sign out")}
          </Button>
        </div>
      </Section>

      <Section title="Encryption" description="What protects your data.">
        <dl className="grid gap-px overflow-hidden rounded-2xl border bg-border text-sm sm:grid-cols-2">
          {[
            ["Content", "AES-256-GCM, 4 MB chunks"],
            ["Password", "Argon2id · 64 MiB · 3 passes"],
            ["Key hierarchy", "Master key → per-file keys"],
            ["Names & folders", "Encrypted with your master key"],
          ].map(([k, v]) => (
            <div key={k} className="bg-card p-4">
              <dt className="text-xs text-muted-foreground">{t(k)}</dt>
              <dd className="mt-1 font-medium">{t(v)}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Danger zone">
        <DeleteAccount />
      </Section>
    </div>
  )
}

function ChangePassword() {
  const { changePassword } = useSession()
  const { t } = useI18n()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (strength(next) < 1) return toast.error(t("Use at least 10 characters"))
    if (next !== confirm) return toast.error(t("Passwords don't match"))
    setBusy(true)
    try {
      await changePassword(current, next)
      toast.success(t("Password changed — other devices were signed out"))
      setCurrent("")
      setNext("")
      setConfirm("")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-sm gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="cur">{t("Current password")}</Label>
        <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new">{t("New password")}</Label>
        <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        <PasswordStrength password={next} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirm">{t("Confirm new password")}</Label>
        <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      <Button type="submit" disabled={busy} className="mt-1 w-fit">
        {busy && <Loader2Icon className="animate-spin" />} {t("Update password")}
      </Button>
    </form>
  )
}

function DeleteAccount() {
  const { deleteAccount } = useSession()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await deleteAccount(password)
      toast.success(t("Your account and all data have been destroyed"))
      navigate({ to: "/" })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-destructive/30 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">{t("Delete account")}</p>
        <p className="text-sm text-muted-foreground">{t("Permanently destroys every file, note, folder and link.")}</p>
      </div>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        {t("Delete account")}
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title={t("Delete your account?")}
        description={t("This can't be undone. Enter your password to confirm.")}
      >
        <form onSubmit={submit} className="grid gap-4">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("Password")} autoFocus required />
          <Button type="submit" variant="destructive" disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />} {t("Permanently delete everything")}
          </Button>
        </form>
      </ResponsiveDialog>
    </div>
  )
}
