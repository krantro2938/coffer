import { useEffect, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangleIcon, ArrowRightIcon, CheckIcon, CopyIcon, DownloadIcon, Loader2Icon } from "lucide-react"
import { AuthLayout, PasswordStrength, strength } from "@/components/auth-layout"
import { GoogleButton } from "@/components/google-button"
import { VerifyEmail } from "@/components/verify-email"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, getConfig } from "@/lib/api"
import { saveWelcome } from "@/lib/welcome"
import { formatPrice } from "@/lib/billing"
import { formatBytes, shortDate } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { triggerDownload } from "@/lib/transfer"
import { useCopy } from "@/hooks/use-copy"

// The server sends the same title and description with the page (server/internal/app/seo.go).
export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create your drive — Coffer" },
      {
        name: "description",
        content: "An end-to-end encrypted drive for files, notes, share links and upload links. Your password never leaves your device.",
      },
    ],
  }),
  component: Register,
})

function Register() {
  const { register, me } = useSession()
  const { t } = useI18n()
  const navigate = useNavigate()
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [recovery, setRecovery] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const { copy, copied } = useCopy()
  // Set when Google has already vouched for an address: only a password is left to choose.
  const [google, setGoogle] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  // An admin's invitation: the address is fixed and already proven by the emailed link.
  const [invite] = useState(() => new URLSearchParams(location.search).get("invite") ?? undefined)
  const [invited, setInvited] = useState<string | null>(null)
  const [terms, setTerms] = useState<{ compQuota?: number; compUntil?: number } | null>(null)
  useEffect(() => {
    if (!invite) return
    api<{ email: string; compQuota?: number; compUntil?: number }>(`/api/invites/${encodeURIComponent(invite)}`)
      .then((p) => {
        setInvited(p.email)
        setEmail(p.email)
        setTerms({ compQuota: p.compQuota, compUntil: p.compUntil })
      })
      .catch((e) => toast.error((e as Error).message))
  }, [invite])

  useEffect(() => {
    if (!new URLSearchParams(location.search).has("google")) return
    api<{ email: string }>("/api/auth/google/pending")
      .then((p) => {
        setGoogle(p.email)
        setEmail(p.email)
      })
      .catch(() => {})
  }, [])

  const finish = () => {
    saveWelcome({ email, picks: [], stage: "ask" })
    navigate({ to: "/welcome" })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (strength(password) < 1) return toast.error(t("Use at least 10 characters"))
    if (password !== confirm) return toast.error(t("Passwords don't match"))
    setBusy(true)
    try {
      setRecovery(await register(email, password, false, invited ? invite : undefined))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // The recovery key comes first: it is shown only once, and confirming the
  // email means leaving this page for an inbox.
  if (recovery && confirming && me && !me.verified) {
    return (
      <AuthLayout>
        <VerifyEmail onDone={finish} />
      </AuthLayout>
    )
  }

  if (recovery) {
    const download = () => {
      const text = t(
        "Coffer recovery key\n\nAccount: {email}\nRecovery key: {key}\n\nKeep this somewhere safe and offline. Anyone with this key and your email can reset your password.\n",
        { email, key: recovery }
      )
      triggerDownload(new Blob([text], { type: "text/plain" }), "coffer-recovery-key.txt")
      setSaved(true)
    }
    return (
      <AuthLayout>
        <div className="grid gap-6">
          <div>
            <h1 className="mt-2 text-3xl font-medium">{t("Save your recovery key")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("We can't reset your password — we never had it. This key is the only way back into your drive if you forget it.")}
            </p>
          </div>
          <div className="rounded-2xl border border-dashed bg-muted/40 p-4">
            <p className="font-mono text-[0.9375rem] leading-relaxed tracking-wide break-all">{recovery}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => {
                copy(recovery, t("Recovery key copied"))
                setSaved(true)
              }}
            >
              {copied === recovery ? <CheckIcon /> : <CopyIcon />} {t("Copy")}
            </Button>
            <Button variant="outline" onClick={download}>
              <DownloadIcon /> {t("Download")}
            </Button>
          </div>
          <div className="flex gap-3 rounded-xl bg-coral-soft/60 p-3 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-coral" />
            <p>{t("Store it in a password manager or print it. It won't be shown again.")}</p>
          </div>
          <Button size="lg" disabled={!saved} onClick={() => (me && !me.verified ? setConfirming(true) : finish())}>
            {t("I've saved it")} <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="grid gap-6">
        <div>
          <h1 className="text-3xl font-medium">{t("Create your drive")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {invited
              ? t("You're invited. Choose the password that encrypts your drive for {email}. It never leaves this device.", {
                  email: invited,
                })
              : google
                ? t("Google confirmed {email}. Now choose the password that encrypts your drive. Google never sees it.", { email: google })
                : t("Just an email and a password. No tracking.")}
          </p>
          {invite ? (
            // An invitation has terms of its own; the list prices are not what this person was offered.
            terms?.compQuota ? (
              <p className="mt-2 text-sm font-medium">
                {formatBytes(terms.compQuota)} ·{" "}
                {terms.compUntil
                  ? t("At no charge until {date}.", { date: shortDate(terms.compUntil) })
                  : t("At no charge, with no end date.")}
              </p>
            ) : null
          ) : config?.plans?.length ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("Drives start at {price} a month. You choose a plan in the next step.", { price: formatPrice(config.plans[0]) })}
            </p>
          ) : null}
        </div>
        {config && !config.allowRegistration ? (
          <p className="rounded-xl border bg-muted/40 p-4 text-sm">{t("Registration is closed on this server.")}</p>
        ) : (
          <>
            {!google && !invited && <GoogleButton />}
            <div className="grid gap-4">
              <div className={google || invited ? "hidden" : "grid gap-1.5"}>
                <Label htmlFor="email">{t("Email")}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus={!google && !invited}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">{t("Password")}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={10}
                  required
                />
                <PasswordStrength password={password} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="confirm">{t("Confirm password")}</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  aria-invalid={confirm.length > 0 && confirm !== password}
                />
              </div>
            </div>
            <Button size="lg" type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2Icon className="animate-spin" /> {t("Generating keys…")}
                </>
              ) : (
                <>
                  {t("Create drive")} <ArrowRightIcon data-icon="inline-end" />
                </>
              )}
            </Button>
          </>
        )}
        <p className="text-center text-xs text-pretty text-muted-foreground">
          {t("By creating a drive you agree to the")}{" "}
          <Link to="/terms" className="underline underline-offset-4 hover:text-foreground">
            {t("terms")}
          </Link>{" "}
          {t("and the")}{" "}
          <Link to="/privacy" className="underline underline-offset-4 hover:text-foreground">
            {t("privacy policy")}
          </Link>
          .
        </p>
        <p className="text-center text-sm text-muted-foreground">
          {t("Already have one?")}{" "}
          <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            {t("Sign in")}
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
