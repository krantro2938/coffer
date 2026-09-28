import { useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { ArrowRightIcon, Loader2Icon } from "lucide-react"
import { AuthLayout, PasswordStrength, strength } from "@/components/auth-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSession } from "@/lib/session"

export const Route = createFileRoute("/recover")({ component: Recover })

function Recover() {
  const { recover } = useSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [key, setKey] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (strength(password) < 1) return toast.error("Use at least 10 characters")
    setBusy(true)
    try {
      await recover(email, key, password)
      toast.success("Password reset — all other devices were signed out")
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
          <h1 className="text-3xl font-medium">Reset with recovery key</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your recovery key unlocks your master key, which we re-seal with a new password. Your files stay intact.
          </p>
        </div>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="key">Recovery key</Label>
            <Input
              id="key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="XXXX-XXXX-…"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <PasswordStrength password={password} />
          </div>
        </div>
        <Button size="lg" type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2Icon className="animate-spin" /> Re-sealing keys…
            </>
          ) : (
            <>
              Reset password <ArrowRightIcon data-icon="inline-end" />
            </>
          )}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Remembered it?{" "}
          <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
