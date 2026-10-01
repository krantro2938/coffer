import { CheckIcon, LockKeyholeIcon } from "lucide-react"
import { Brand } from "@/components/brand"
import { LangToggle } from "@/components/lang-toggle"
import { ThemeToggle } from "@/components/theme-toggle"
import { useI18n } from "@/lib/i18n"

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-4 py-5 sm:px-8">
        <div className="flex items-center justify-between">
          <Brand />
          <div className="flex items-center gap-1">
            <LangToggle />
            <ThemeToggle />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-forest p-10 text-forest-foreground lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute -right-40 -bottom-40 size-[36rem] rounded-full border border-white/10" />
        <div aria-hidden className="absolute -right-16 -bottom-16 size-[24rem] rounded-full border border-white/10" />
        <div
          aria-hidden
          className="absolute right-10 bottom-10 size-[14rem] rounded-full bg-[radial-gradient(closest-side,var(--lavender),transparent)] opacity-40"
        />
        <p className="font-mono text-[0.6875rem] tracking-[0.14em] uppercase opacity-60">{t("Zero-knowledge drive")}</p>
        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-medium">{t("Your password is the only key. We never see it.")}</h2>
          <ul className="mt-8 grid gap-3 text-sm opacity-85">
            {[
              "Stretched with Argon2id in your browser",
              "Unwraps a master key that encrypts everything",
              "Server stores only ciphertext and peppered hashes",
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="grid size-5 place-items-center rounded-full bg-white/10">
                  <CheckIcon className="size-3" />
                </span>
                {t(item)}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex max-w-xs items-center gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur">
          <span className="grid size-10 place-items-center rounded-xl bg-mint/20">
            <LockKeyholeIcon className="size-5" />
          </span>
          <div className="text-sm">
            <p className="font-medium">AES-256-GCM</p>
            <p className="opacity-60">{t("Every file, every name, every folder.")}</p>
          </div>
        </div>
      </aside>
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
