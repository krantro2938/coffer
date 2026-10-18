import { useEffect, useMemo, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { ArrowRightIcon, CheckIcon, Loader2Icon } from "lucide-react"
import { Brand } from "@/components/brand"
import { usePlans, usePlansOpen } from "@/components/plans"
import { Button } from "@/components/ui/button"
import { fromB64 } from "@/lib/crypto"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"
import { readWelcome, saveWelcome, type Pick } from "@/lib/welcome"

export const Route = createFileRoute("/welcome")({ component: WelcomePage })

/** Each answer has its own 3D object in /public/3d; until it is there the older render stands in. */
const choices: { id: Pick; stand: string; label: string }[] = [
  { id: "documents", stand: "cv", label: "Documents" },
  { id: "photos", stand: "folder", label: "Photos" },
  { id: "work", stand: "inbox", label: "Client work" },
  { id: "secrets", stand: "lock", label: "Passwords and codes" },
  { id: "sharing", stand: "share", label: "Things to send" },
]

function Art({ name, stand, className }: { name: string; stand: string; className?: string }) {
  const [src, setSrc] = useState(`/3d/${name}.webp`)
  return <img src={src} alt="" onError={() => setSrc(`/3d/${stand}.webp`)} className={cn("object-contain", className)} />
}

function WelcomePage() {
  const { status, me } = useSession()
  const navigate = useNavigate()

  useEffect(() => {
    if (status === "anonymous") navigate({ to: "/login" })
    // Only someone who has just signed up belongs here.
    else if (status !== "loading" && me && !readWelcome(me.email)) navigate({ to: "/drive" })
  }, [status, me, navigate])

  if (status === "loading" || !me) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <WelcomeFlow
      wrapped={me.wrappedMasterKey}
      onDone={(picks) => {
        saveWelcome({ email: me.email, picks, stage: "unbox" })
        navigate({ to: "/drive" })
      }}
    />
  )
}

/** The two welcome steps. */
function WelcomeFlow({ wrapped, onDone }: { wrapped: string; onDone: (picks: Pick[]) => void }) {
  const { t } = useI18n()
  const plans = usePlans()
  const [step, setStep] = useState<1 | 2>(1)
  const [picks, setPicks] = useState<Pick[]>([])

  const toggle = (p: Pick) => setPicks((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))
  const open = usePlansOpen()
  const steps = plans && open ? 3 : 2

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute top-1/2 right-[6%] hidden size-[30rem] -translate-y-1/2 lg:block">
        <div className="absolute inset-[-20%] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--lime)_22%,transparent),color-mix(in_oklch,var(--mint)_18%,transparent)_55%,transparent)]" />
        <img src="/3d/lock.webp" alt="" className="relative size-full animate-float object-contain" />
      </div>
      <header className="flex items-center justify-between px-4 py-5 sm:px-8">
        <Brand />
        <p className="text-sm text-muted-foreground tabular-nums">{t("Step {n} of {total}", { n: step, total: steps })}</p>
      </header>

      <main className="flex flex-1 items-center px-4 py-10 sm:px-8 lg:px-[max(2rem,calc((100vw-72rem)/2))]">
        {step === 1 ? (
          <div key="ask" className="grid w-full max-w-xl animate-rise gap-8">
            <div>
              <h1 className="text-4xl leading-[1.05] font-medium sm:text-5xl">{t("What will you keep here?")}</h1>
              <p className="mt-4 max-w-md text-pretty text-muted-foreground">
                {t("Pick as many as you like and we'll lay out your first folders. Your answer stays in this browser; we never see it.")}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {choices.map(({ id, stand, label }) => {
                const on = picks.includes(id)
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(id)}
                    className={cn(
                      "group relative flex items-center gap-4 rounded-2xl border bg-card p-3 pr-4 text-left transition-[border-color,background-color,box-shadow] duration-200 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:last:odd:col-span-2",
                      on ? "border-primary bg-primary/[0.06] shadow-[inset_0_0_0_1px_var(--primary)]" : "hover:border-foreground/25"
                    )}
                  >
                    <Art
                      name={id}
                      stand={stand}
                      className={cn(
                        "size-16 shrink-0 transition-transform duration-300 ease-out",
                        on ? "scale-110 -rotate-3" : "group-hover:scale-105"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t(label)}</span>
                    </span>
                    <span
                      className={cn(
                        "absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition-[opacity,scale] duration-200",
                        on ? "scale-100 opacity-100" : "scale-50 opacity-0"
                      )}
                    >
                      <CheckIcon className="size-3" strokeWidth={3} />
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button size="lg" onClick={() => setStep(2)} disabled={picks.length === 0}>
                {t("Continue")} <ArrowRightIcon data-icon="inline-end" />
              </Button>
              <Button size="lg" variant="ghost" onClick={() => setStep(2)}>
                {t("Skip")}
              </Button>
            </div>
          </div>
        ) : (
          <Sealed wrapped={wrapped} next={plans && open ? t("Choose my drive") : t("Open my drive")} onNext={() => onDone(picks)} />
        )}
      </main>
    </div>
  )
}

/** Shows what was just made on this device, and what the server got of it. */
function Sealed({ wrapped, next, onNext }: { wrapped: string; next: string; onNext: () => void }) {
  const { t } = useI18n()
  // The sealed key exactly as the server stores it: real bytes, unreadable without the password.
  const noise = useMemo(() => {
    const hex = [...fromB64(wrapped).subarray(0, 24)].map((b) => b.toString(16).padStart(2, "0")).join("")
    return hex.match(/.{4}/g)!.join(" ")
  }, [wrapped])
  const facts = [
    ["Your key was made on this device.", "256 random bits. It has never left this browser unsealed."],
    ["Your password seals it.", "Stretched here with Argon2id. We never receive the password."],
    ["Your recovery key is the only spare.", "We hold no copy and no back door, so keep it safe."],
  ]
  return (
    <div key="sealed" className="grid w-full max-w-xl gap-8">
      <div className="animate-rise">
        <h1 className="text-4xl leading-[1.05] font-medium sm:text-5xl">{t("Sealed before it left your hands.")}</h1>
      </div>
      <ol className="grid gap-5">
        {facts.map(([title, body], i) => (
          <li key={title} className="flex animate-rise gap-4" style={{ animationDelay: `${0.35 + i * 0.45}s` }}>
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <CheckIcon className="size-3.5" strokeWidth={2.5} />
            </span>
            <div>
              <p className="font-medium">{t(title)}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{t(body)}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="animate-rise rounded-2xl border bg-card p-5 shadow-soft" style={{ animationDelay: "1.8s" }}>
        <p className="text-sm text-muted-foreground">{t("This is all we hold of your key:")}</p>
        <p className="mt-2 font-mono text-sm leading-relaxed break-all text-primary">{noise} …</p>
      </div>
      <div className="animate-rise" style={{ animationDelay: "2.2s" }}>
        <Button size="lg" onClick={onNext}>
          {next} <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}
