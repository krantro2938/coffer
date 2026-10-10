import { useEffect, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { ArrowRightIcon, Loader2Icon } from "lucide-react"
import { AuthLayout } from "@/components/auth-layout"
import { GoogleButton } from "@/components/google-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"

// The server sends the same title and description with the page (server/internal/app/seo.go).
export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Sign in — Coffer" }, { name: "description", content: "Unlock your encrypted Coffer drive." }],
  }),
  component: Login,
})

function Login() {
  const { login } = useSession()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)

  // Coming back from a Google sign-in that did not work out.
  useEffect(() => {
    const url = new URL(location.href)
    const outcome = url.searchParams.get("google")
    if (!outcome) return
    url.searchParams.delete("google")
    history.replaceState(history.state, "", url)
    toast.error(
      outcome === "closed"
        ? t("Registration is closed on this server.")
        : outcome === "suspended"
          ? t("this account has been suspended")
          : t("Google sign-in didn't go through. Try again, or use your password.")
    )
  }, [t])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await login(email, password, remember)
      navigate({ to: "/drive" })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="grid gap-6">
        <div>
          <h1 className="text-3xl font-medium">{t("Welcome back")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("Unlock your encrypted drive.")}</p>
        </div>
        <GoogleButton />
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="email">{t("Email")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("Password")}</Label>
              <Link to="/recover" className="text-xs text-muted-foreground hover:text-foreground">
                {t("Forgot password?")}
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border bg-muted/40 p-3">
            <span className="text-sm">
              {t("Stay unlocked on this device")}
              <span className="block text-xs text-muted-foreground">{t("Only on devices you alone use.")}</span>
            </span>
            <Switch checked={remember} onCheckedChange={setRemember} />
          </label>
        </div>
        <Button size="lg" type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2Icon className="animate-spin" /> {t("Deriving keys…")}
            </>
          ) : (
            <>
              {t("Sign in")} <ArrowRightIcon data-icon="inline-end" />
            </>
          )}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          {t("New here?")}{" "}
          <Link to="/register" className="font-medium text-foreground underline-offset-4 hover:underline">
            {t("Create a drive")}
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
