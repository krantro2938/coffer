import { useState } from "react"
import { CheckIcon, Loader2Icon, MailIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { currentLang, useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * For someone who would like to try a drive before paying: they leave an
 * address, and whoever runs the server answers with an invitation.
 */
export function TrialRequest({ className, email: known }: { className?: string; email?: string }) {
  const { t } = useI18n()
  const [email, setEmail] = useState(known ?? "")
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle")
  const [error, setError] = useState("")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (state === "sending") return
    setState("sending")
    setError("")
    try {
      await api("/api/trial", { body: { email: email.trim(), lang: currentLang() } })
      setState("sent")
    } catch (err) {
      setError((err as Error).message)
      setState("idle")
    }
  }

  return (
    <div className={cn("rounded-3xl border bg-card p-6 text-center sm:p-8", className)}>
      <p className="eyebrow">{t("Try it first")}</p>
      <h3 className="mt-2 text-xl font-medium text-balance sm:text-2xl">{t("Want to try a drive before you pay for one?")}</h3>
      {state === "sent" ? (
        <p className="mt-4 flex items-center justify-center gap-2 text-sm">
          <span className="grid size-5 place-items-center rounded-full bg-secondary text-secondary-foreground">
            <CheckIcon className="size-3" />
          </span>
          {t("Thanks. We'll email you a link to try Coffer.")}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">
            {t("Leave your email and we'll send you a link to a drive you can use for free for a while.")}
          </p>
          <form onSubmit={submit} className="mx-auto mt-5 flex max-w-md flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("you@example.com")}
              aria-label={t("Email")}
              autoComplete="email"
              className="h-10 flex-1"
            />
            <Button type="submit" disabled={state === "sending"} className="h-10">
              {state === "sending" ? <Loader2Icon className="animate-spin" /> : <MailIcon />}
              {t("Send me a link")}
            </Button>
          </form>
          <p className={cn("mt-3 text-xs text-muted-foreground", error && "text-destructive")}>
            {error || t("We use your address to send that link, and for nothing else.")}
          </p>
        </>
      )}
    </div>
  )
}
