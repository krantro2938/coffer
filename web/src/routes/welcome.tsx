import { useEffect, useMemo, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { ArrowRightIcon, BriefcaseIcon, CheckIcon, FileTextIcon, ImageIcon, KeyRoundIcon, Loader2Icon, SendIcon } from "lucide-react"
import { Brand } from "@/components/brand"
import { Dial } from "@/components/dial"
import { usePlans } from "@/components/plans"
import { Button } from "@/components/ui/button"
import { fromB64 } from "@/lib/crypto"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"
import { readWelcome, saveWelcome, type Pick } from "@/lib/welcome"

export const Route = createFileRoute("/welcome")({ component: WelcomePage })

const choices: { id: Pick; icon: typeof FileTextIcon; label: string; hint: string }[] = [
  { id: "documents", icon: FileTextIcon, label: "Documents", hint: "Passports, contracts, tax papers" },
  { id: "photos", icon: ImageIcon, label: "Photos", hint: "The ones that are nobody's business" },
  { id: "work", icon: BriefcaseIcon, label: "Client work", hint: "Files you are trusted with" },
  { id: "secrets", icon: KeyRoundIcon, label: "Passwords and codes", hint: "Recovery keys, PINs, door codes" },
  { id: "sharing", icon: SendIcon, label: "Things to send", hint: "Links that expire or burn" },
]

function WelcomePage() {
  const { status, me } = useSession()
  const navigate = useNavigate()
  const { t } = useI18n()
  const plans = usePlans()
  const [step, setStep] = useState<1 | 2>(1)
  const [picks, setPicks] = useState<Pick[]>([])

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

  const toggle = (p: Pick) => setPicks((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))
  const done = (chosen: Pick[]) => {
    saveWelcome({ email: me.email, picks: chosen, stage: "unbox" })
    navigate({ to: "/drive" })
  }
  const steps = plans ? 3 : 2

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden">
      <Dial
        state={step === 2 ? "turning" : "idle"}
        numerals
        className="pointer-events-none absolute top-1/2 -right-[18rem] hidden size-[52rem] -translate-y-1/2 text-forest/25 lg:block dark:text-forest-foreground/15"
      />
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
              {choices.map(({ id, icon: Icon, label, hint }) => {
                const on = picks.includes(id)
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(id)}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:last:odd:col-span-2",
                      on ? "border-forest bg-forest text-forest-foreground" : "bg-card hover:border-foreground/25"
                    )}
                  >
                    <Icon className="size-5 shrink-0" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t(label)}</span>
                      <span className={cn("block text-sm", on ? "text-forest-foreground/65" : "text-muted-foreground")}>{t(hint)}</span>
                    </span>
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-full border transition-opacity",
                        on ? "border-transparent bg-mint text-forest" : "opacity-40"
                      )}
                    >
                      {on && <CheckIcon className="size-3" strokeWidth={3} />}
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
          <Sealed wrapped={me.wrappedMasterKey} next={plans ? t("Choose my drive") : t("Open my drive")} onNext={() => done(picks)} />
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
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
              <CheckIcon className="size-3.5" strokeWidth={2.5} />
            </span>
            <div>
              <p className="font-medium">{t(title)}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{t(body)}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="animate-rise rounded-2xl bg-forest p-5 text-forest-foreground" style={{ animationDelay: "1.8s" }}>
        <p className="text-sm text-forest-foreground/65">{t("This is all we hold of your key:")}</p>
        <p className="mt-2 font-mono text-sm leading-relaxed break-all text-mint">{noise} …</p>
      </div>
      <div className="animate-rise" style={{ animationDelay: "2.2s" }}>
        <Button size="lg" onClick={onNext}>
          {next} <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}
