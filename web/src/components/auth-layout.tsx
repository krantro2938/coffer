import { CheckIcon, LockKeyholeIcon } from "lucide-react"
import { Brand } from "@/components/brand"
import { PreferencesMenu } from "@/components/site-header"
import { useI18n } from "@/lib/i18n"

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-4 py-5 sm:px-8">
        <div className="flex items-center justify-between">
          <Brand />
          <PreferencesMenu />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="hidden p-3 lg:block">
        <aside className="relative flex h-full flex-col justify-between overflow-hidden rounded-[2.5rem] bg-hero p-12 text-hero-foreground">
          <div aria-hidden className="absolute -right-40 -bottom-40 size-[36rem] rounded-full border border-white/10" />
          <div aria-hidden className="absolute -right-16 -bottom-16 size-[24rem] rounded-full border border-white/10" />
          <div
            aria-hidden
            className="absolute right-10 bottom-10 size-[14rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--lime)_45%,transparent),transparent)]"
          />
          <span className="relative grid size-12 place-items-center rounded-2xl bg-lime text-hero">
            <LockKeyholeIcon className="size-6" />
          </span>
          <div className="relative max-w-md">
            <h2 className="text-5xl leading-[1.02] font-semibold text-balance">{t("Your password is the only key. We never see it.")}</h2>
            <ul className="mt-8 grid gap-3 text-base text-hero-foreground/85">
              {[
                "Your password stays on your device",
                "It unlocks the key that protects your files",
                "Our server only stores what it can't read",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <span className="grid size-6 place-items-center rounded-full bg-lime text-hero">
                    <CheckIcon className="size-3.5" />
                  </span>
                  {t(item)}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-sm text-hero-foreground/70">{t("Every file, every name, every folder.")}</p>
        </aside>
      </div>
    </div>
  )
}

export function PasswordStrength({ password }: { password: string }) {
  const { t } = useI18n()
  const score = strength(password)
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"]
  const colors = ["bg-destructive", "bg-coral", "bg-coral", "bg-primary/70", "bg-primary"]
  if (!password) return null
  return (
    <div className="grid gap-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < score ? colors[score] : "bg-muted"}`} />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{t(labels[score])}</span>
    </div>
  )
}

export function strength(pw: string): number {
  if (pw.length < 10) return 0
  let s = 1
  if (pw.length >= 14) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^\w]/.test(pw)) s++
  if (pw.length >= 20) s = Math.max(s, 3)
  return Math.min(s, 4)
}
