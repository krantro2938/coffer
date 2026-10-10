import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, type Me } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"

const RESEND_AFTER = 60

/** Asks for the six-digit code emailed at sign-up. */
export function VerifyEmail({ onDone }: { onDone?: () => void }) {
  const { me, updateMe, logout } = useSession()
  const { t } = useI18n()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(RESEND_AFTER)

  useEffect(() => {
    if (wait <= 0) return
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])

  const submit = async (value: string) => {
    if (value.length !== 6 || busy) return
    setBusy(true)
    try {
      updateMe(await api<Me>("/api/auth/verify", { body: { code: value } }))
      onDone?.()
    } catch (e) {
      toast.error((e as Error).message)
      setCode("")
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setWait(RESEND_AFTER)
    try {
      await api("/api/auth/verify/resend", { method: "POST" })
      toast.success(t("A new code is on its way"))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(code)
      }}
    >
      <div>
        <h1 className="text-3xl font-medium">{t("Check your inbox")}</h1>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">
          {t("We sent a six-digit code to {email}. It works for 10 minutes.", { email: me?.email ?? "" })}
        </p>
      </div>
      <Input
        value={code}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 6)
          setCode(v)
          void submit(v)
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={t("Six-digit code")}
        placeholder="000000"
        autoFocus
        disabled={busy}
        className="h-16 text-center font-mono text-3xl tracking-[0.5em] placeholder:text-muted-foreground/30 md:text-3xl"
      />
      <Button size="lg" type="submit" disabled={busy || code.length !== 6}>
        {busy && <Loader2Icon className="animate-spin" />} {t("Confirm email")}
      </Button>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <button type="button" onClick={resend} disabled={wait > 0} className="hover:text-foreground disabled:hover:text-muted-foreground">
          {wait > 0 ? t("Send a new code in {n} s", { n: wait }) : t("Send a new code")}
        </button>
        <button type="button" onClick={() => logout()} className="hover:text-foreground">
          {t("Use another email")}
        </button>
      </div>
    </form>
  )
}
