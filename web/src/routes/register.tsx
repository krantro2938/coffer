import { useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangleIcon, ArrowRightIcon, CheckIcon, CopyIcon, DownloadIcon, Loader2Icon } from "lucide-react"
import { AuthLayout, PasswordStrength, strength } from "@/components/auth-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getConfig } from "@/lib/api"
import { useSession } from "@/lib/session"
import { triggerDownload } from "@/lib/transfer"
import { useCopy } from "@/hooks/use-copy"

export const Route = createFileRoute("/register")({ component: Register })

function Register() {
  const { register } = useSession()
  const navigate = useNavigate()
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [recovery, setRecovery] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const { copy, copied } = useCopy()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (strength(password) < 1) return toast.error("Use at least 10 characters")
    if (password !== confirm) return toast.error("Passwords don't match")
    setBusy(true)
    try {
      setRecovery(await register(email, password, false))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (recovery) {
    const download = () => {
      const text = `Coffer recovery key\n\nAccount: ${email}\nRecovery key: ${recovery}\n\nKeep this somewhere safe and offline. Anyone with this key and your email can reset your password.\n`
      triggerDownload(new Blob([text], { type: "text/plain" }), "coffer-recovery-key.txt")
      setSaved(true)
    }
    return (
      <AuthLayout>
        <div className="grid gap-6">
          <div>
            <p className="eyebrow">Last step</p>
            <h1 className="mt-2 text-3xl font-medium">Save your recovery key</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We can't reset your password — we never had it. This key is the only way back into your drive if you
              forget it.
            </p>
          </div>
          <div className="rounded-2xl border border-dashed bg-muted/40 p-4">
            <p className="font-mono text-[0.9375rem] leading-relaxed tracking-wide break-all">{recovery}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => {
                copy(recovery, "Recovery key copied")
                setSaved(true)
              }}
            >
              {copied === recovery ? <CheckIcon /> : <CopyIcon />} Copy
            </Button>
            <Button variant="outline" onClick={download}>
              <DownloadIcon /> Download
            </Button>
          </div>
          <div className="flex gap-3 rounded-xl bg-coral-soft/60 p-3 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-coral" />
            <p>Store it in a password manager or print it. It won't be shown again.</p>
          </div>
          <Button size="lg" disabled={!saved} onClick={() => navigate({ to: "/drive" })}>
            I've saved it — open my drive <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="grid gap-6">
        <div>
          <h1 className="text-3xl font-medium">Create your drive</h1>
          <p className="mt-2 text-sm text-muted-foreground">Just an email and a password. No verification, no tracking.</p>
        </div>
        {config && !config.allowRegistration ? (
          <p className="rounded-xl border bg-muted/40 p-4 text-sm">Registration is closed on this server.</p>
        ) : (
          <>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
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
                <Label htmlFor="password">Password</Label>
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
                <Label htmlFor="confirm">Confirm password</Label>
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
                  <Loader2Icon className="animate-spin" /> Generating keys…
                </>
              ) : (
                <>
                  Create drive <ArrowRightIcon data-icon="inline-end" />
                </>
              )}
            </Button>
          </>
        )}
        <p className="text-center text-sm text-muted-foreground">
          Already have one?{" "}
          <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
