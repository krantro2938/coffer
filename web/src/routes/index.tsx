import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  ArrowRightIcon,
  CheckIcon,
  FlameIcon,
  FolderLockIcon,
  InboxIcon,
  KeyRoundIcon,
  LinkIcon,
  LockKeyholeIcon,
  SendIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropComposer } from "@/components/drop-composer"
import { TrialRequest } from "@/components/trial-request"
import { PlanFinePrint, PlanGrid, usePlans } from "@/components/plans"
import { useSession } from "@/lib/session"
import { SiteFooter, SiteHeader } from "@/components/site-header"
import { formatBytes } from "@/lib/format"
import { useI18n } from "@/lib/i18n"

export const Route = createFileRoute("/")({ component: Home })

function Home() {
  return (
    <div className="flex min-h-svh flex-col overflow-x-clip">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <SendAndRequest />
        <Pillars />
        <HowItWorks />
        <NoiseBand />
        <DriveCta />
        <Pricing />
      </main>
      <SiteFooter />
    </div>
  )
}

function Hero() {
  const { t } = useI18n()
  return (
    <section className="relative">
      {/* Soft warm arc behind the composer, echoing the concentric rings of a lock dial.
          It fades out rather than stopping at the section edge, so it can drift into the next one. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[22rem] -z-10 flex justify-center [mask-image:linear-gradient(to_bottom,black_35%,transparent_85%)]"
      >
        <div className="relative size-[56rem] shrink-0">
          <div className="absolute inset-0 rounded-full border border-foreground/[0.06]" />
          <div className="absolute inset-24 rounded-full border border-foreground/[0.06]" />
          <div className="absolute inset-48 rounded-full bg-[radial-gradient(closest-side,var(--coral-soft),var(--lavender-soft)_60%,transparent)] opacity-90" />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pt-12 pb-28 sm:px-6 sm:pt-20 sm:pb-44">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
            <span className="grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
              <LockKeyholeIcon className="size-2.5" />
            </span>
            {t("Zero-knowledge · keys never leave your device")}
          </span>
          <h1 className="mt-6 text-[2.75rem] leading-[1.02] font-medium sm:text-7xl">
            {t("Share anything.")}
            <br />
            <span className="text-muted-foreground/70">{t("Reveal nothing.")}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
            {t(
              "Files and notes are encrypted in your browser before they leave it. The link carries the key — our server only ever stores noise."
            )}
          </p>
        </div>

        <div id="top" className="relative mx-auto mt-10 max-w-xl scroll-mt-24 sm:mt-12">
          <FloatingCards />
          <DropComposer />
        </div>
      </div>
    </section>
  )
}

/** The two things Coffer is for, and what neither asks of the other person. */
function SendAndRequest() {
  const { t } = useI18n()
  const { status } = useSession()
  const signedIn = status === "locked" || status === "unlocked"
  return (
    <section className="mx-auto max-w-6xl px-4 pb-28 sm:px-6 sm:pb-44">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col rounded-3xl border bg-card p-6 sm:p-8">
          <span className="grid size-11 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
            <SendIcon className="size-5" />
          </span>
          <p className="mt-6 eyebrow">{t("Send files")}</p>
          <h2 className="mt-2 text-2xl font-medium text-balance sm:text-3xl">
            {t("Share private files without making the other person sign up for anything.")}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {t("They open your link in any browser and the files decrypt right there. No account, no app, nothing to install.")}
          </p>
          <div className="mt-auto pt-8">
            <Button size="lg" variant="outline" asChild>
              <a href="#top">
                {t("Send something")} <ArrowRightIcon data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </div>
        <div className="flex flex-col rounded-3xl bg-lavender-soft p-6 sm:p-8">
          <span className="grid size-11 place-items-center rounded-2xl bg-card text-foreground shadow-soft">
            <InboxIcon className="size-5" />
          </span>
          <p className="mt-6 eyebrow">{t("Request files")}</p>
          <h2 className="mt-2 text-2xl font-medium text-balance sm:text-3xl">
            {t("Need someone to send you a file? Create a secure upload link. No account required for them.")}
          </h2>
          <p className="mt-3 text-foreground/70">
            {t(
              "Their browser encrypts each file to a key only you hold. The link can upload, and nothing else: not even read back what it sent."
            )}
          </p>
          <div className="mt-auto pt-8">
            <Button size="lg" asChild>
              <Link to={signedIn ? "/requests" : "/register"}>
                {signedIn ? t("Request files") : t("Get a drive to request files")} <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

function FloatingCards() {
  const { t } = useI18n()
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
      <div className="absolute top-10 -left-60 w-48 animate-float rounded-2xl border bg-card p-4 shadow-soft">
        <p className="text-2xl font-medium tracking-tight">256-bit</p>
        <p className="text-xs text-muted-foreground">{t("AES-GCM per file")}</p>
        <div className="mt-3 flex h-6 items-end gap-1">
          {[40, 65, 50, 85, 70, 95, 60, 80].map((h, i) => (
            <span key={i} className="flex-1 rounded-sm bg-lavender" style={{ height: `${h}%`, opacity: 0.35 + i * 0.08 }} />
          ))}
        </div>
      </div>

      <div
        className="absolute top-72 -left-72 w-60 animate-float rounded-2xl border bg-card p-3.5 shadow-soft"
        style={{ animationDelay: "-2s" }}
      >
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-coral-soft">
            <KeyRoundIcon className="size-4 text-coral" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("Password locked")}</p>
            <p className="font-mono text-[0.6875rem] text-muted-foreground">argon2id · 64 MiB</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-secondary px-2.5 py-1.5 text-xs text-secondary-foreground">
          <CheckIcon className="size-3.5" /> {t("Key derived on-device")}
        </div>
      </div>

      <div
        className="absolute top-16 -right-64 w-56 animate-float rounded-2xl border bg-card p-4 shadow-soft"
        style={{ animationDelay: "-4s" }}
      >
        <p className="eyebrow">{t("Share link")}</p>
        <p className="mt-2 font-mono text-sm">
          /s/<span className="font-semibold text-primary">k7m3xq2</span>
          <span className="text-muted-foreground">#h4c9…</span>
        </p>
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[0.6875rem]">
          <span className="rounded-md bg-muted py-1">{t("1 day")}</span>
          <span className="rounded-md bg-coral-soft py-1">{t("1 view")}</span>
          <span className="rounded-md bg-lavender-soft py-1">{t("pw")}</span>
        </div>
      </div>

      <div
        className="absolute top-80 -right-56 w-52 animate-float rounded-2xl border bg-card p-3.5 shadow-soft"
        style={{ animationDelay: "-1s" }}
      >
        <div className="flex items-center gap-2 text-sm">
          <FlameIcon className="size-4 text-coral" />
          <span className="font-medium">{t("Burned after reading")}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("Link opened once, then destroyed.")}</p>
      </div>
    </div>
  )
}

const pillars = [
  { icon: LockKeyholeIcon, title: "Encrypted in your browser", body: "AES-256-GCM before a single byte is uploaded." },
  { icon: LinkIcon, title: "Key lives in the link", body: "After the #, which browsers never send to servers." },
  { icon: FlameIcon, title: "Burn after reading", body: "Links that expire by time, by views, or both." },
  { icon: KeyRoundIcon, title: "Optional passwords", body: "Mixed into the key with Argon2id for a second factor." },
]

function Pillars() {
  const { t } = useI18n()
  return (
    <section className="relative mx-auto max-w-6xl px-4 pb-28 sm:px-6 sm:pb-44">
      <p className="mx-auto max-w-3xl text-center text-2xl leading-snug font-medium tracking-tight text-balance sm:text-4xl">
        {t("Private by construction — not by promise. Even the people running this server can't read what you share.")}
      </p>
      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {pillars.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border bg-card p-5 transition-shadow hover:shadow-soft">
            <Icon className="size-5 text-primary" strokeWidth={1.75} />
            <p className="mt-6 font-medium">{t(title)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t(body)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function HowItWorks() {
  const { t } = useI18n()
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-28 sm:px-6 sm:pb-44">
      <div className="text-center">
        <p className="eyebrow">{t("How it works")}</p>
        <h2 className="mt-3 text-3xl font-medium sm:text-5xl">
          {t("Three steps.")}
          <br className="sm:hidden" /> {t("Zero trust required.")}
        </h2>
      </div>
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        <StepCard
          n="01"
          title={t("Encrypt locally")}
          body={t("A fresh 256-bit key is generated for every file. Your file is sealed in 4 MB chunks, right here in the tab.")}
          className="bg-lavender-soft"
        >
          <div className="grid gap-1.5 font-mono text-[0.6875rem]">
            <div className="flex items-center justify-between rounded-lg bg-card px-3 py-2 shadow-soft">
              <span>{t("quarterly-report.pdf")}</span>
              <span className="text-muted-foreground">{formatBytes(2.4 * 1024 ** 2)}</span>
            </div>
            <div className="truncate rounded-lg bg-card/60 px-3 py-2 text-muted-foreground">9f3a c1e0 7b44 d2aa 08fe 51c3 e97d 2b10 …</div>
          </div>
        </StepCard>
        <StepCard
          n="02"
          title={t("Share the link")}
          body={t("The decryption key rides in the URL fragment. Add a password, an expiry or a view limit if you like.")}
          className="bg-forest text-forest-foreground [&_.step-body]:text-forest-foreground/70"
        >
          <div className="rounded-lg bg-white/10 px-3 py-2.5 font-mono text-xs">
            coffer.app/s/k7m3xq2<span className="rounded bg-mint/30 px-1 text-mint">#h4c9-w2pz-8rtf-6mxn</span>
          </div>
        </StepCard>
        <StepCard
          n="03"
          title={t("Decrypt on arrival")}
          body={t("Your recipient's browser fetches the ciphertext and unlocks it locally. Burned links vanish for good.")}
          className="bg-secondary"
        >
          <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-2.5 text-xs shadow-soft">
            <ShieldCheckIcon className="size-4 text-primary" />
            {t("Integrity verified · decrypted in 38 ms")}
          </div>
        </StepCard>
      </div>
    </section>
  )
}

function StepCard({
  n,
  title,
  body,
  className,
  children,
}: {
  n: string
  title: string
  body: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex flex-col justify-between gap-10 rounded-3xl p-6 sm:p-7 ${className ?? ""}`}>
      <div>
        <span className="font-mono text-xs opacity-60">{n}</span>
        <h3 className="mt-3 text-2xl font-medium">{title}</h3>
        <p className="step-body mt-2 text-sm text-muted-foreground">{body}</p>
      </div>
      {children}
    </div>
  )
}

const stats = [
  { value: "0", unit: "bytes", label: "Plaintext stored on the server" },
  { value: "256", unit: "bit", label: "Unique key for every file" },
  { value: "80", unit: "bit", label: "Secret in every share link" },
  { value: "64", unit: "MiB", label: "Argon2id memory per guess" },
]

function NoiseBand() {
  const { t } = useI18n()
  return (
    <section className="bg-forest text-forest-foreground">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-20 sm:px-6 sm:pt-28 lg:grid-cols-[1.2fr_1fr] lg:items-end">
        <div>
          <p className="font-mono text-[0.6875rem] tracking-[0.14em] uppercase opacity-60">{t("Built to be breached")}</p>
          <h2 className="mt-3 text-3xl font-medium sm:text-4xl">
            {t("If someone steals our disks,")}
            <br className="hidden sm:block" /> {t("they get very expensive noise.")}
          </h2>
        </div>
        <p className="text-sm opacity-70 lg:pb-1">
          {t(
            "No master key on the server. No plaintext file names. Passwords are stretched on your device and never sent. Access tokens are hashed; account hashes are peppered."
          )}
        </p>
      </div>
      <div className="mx-auto mt-14 grid max-w-6xl grid-cols-2 border-t border-white/10 lg:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`flex flex-col justify-between gap-10 px-4 py-8 sm:px-6 ${i % 2 === 1 ? "border-l border-white/10" : ""} ${i >= 2 ? "border-t border-white/10 lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}
          >
            <p className="max-w-[12rem] text-xs opacity-60">{t(s.label)}</p>
            <p className="text-5xl font-light tracking-tight sm:text-6xl">
              {s.value}
              <span className="ml-1 text-lg opacity-60">{t(s.unit)}</span>
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Pricing() {
  const { t } = useI18n()
  const { status, me } = useSession()
  const navigate = useNavigate()
  const plans = usePlans()
  if (!plans) return null
  const signedIn = status === "locked" || status === "unlocked"
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-28 sm:px-6 sm:pb-44">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">{t("Pricing")}</p>
        <h2 className="mt-3 text-3xl font-medium sm:text-5xl">{t("Pay for space, not with your data.")}</h2>
        <p className="mt-4 text-pretty text-muted-foreground">
          {t(
            "Quick shares are free and need no account. A drive is a subscription, because storage that isn't paid for by you is paid for by someone else."
          )}
        </p>
      </div>
      <div className="mx-auto mt-12 max-w-4xl">
        <PlanGrid
          plans={plans}
          label={() => (signedIn ? t("Choose plan") : t("Get started"))}
          onPick={() => navigate({ to: signedIn ? "/drive" : "/register" })}
        />
        <PlanFinePrint className="mx-auto mt-6 max-w-xl text-center" />
        {/* Anyone without a running plan may ask, signed in or not. */}
        {!me?.billing?.entitled && <TrialRequest key={me?.email} className="mt-10" email={me?.email} />}
      </div>
    </section>
  )
}

function DriveCta() {
  const { t } = useI18n()
  const plans = usePlans()
  return (
    <section className={`mx-auto max-w-6xl px-4 pt-28 sm:px-6 sm:pt-44 ${plans ? "pb-20 sm:pb-28" : "pb-28 sm:pb-44"}`}>
      <div className="grid items-center gap-10 overflow-hidden rounded-3xl border bg-card p-6 sm:p-10 lg:grid-cols-2">
        <div>
          <p className="eyebrow">{plans ? t("Private drive") : t("Optional account")}</p>
          <h2 className="mt-3 text-3xl font-medium sm:text-4xl">{t("A private drive, when you want one.")}</h2>
          <p className="mt-3 text-muted-foreground">
            {t(
              "Sign up with just an email and a password to keep everything in one encrypted place — folders, notes, and every link you've shared, revocable at any time."
            )}
          </p>
          <ul className="mt-6 grid gap-2 text-sm">
            {[
              "Folders and file names are encrypted too",
              "Revoke any share link instantly",
              "Recovery key so a forgotten password isn't fatal",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-secondary text-secondary-foreground">
                  <CheckIcon className="size-3" />
                </span>
                {t(item)}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-2">
            <Button size="lg" asChild>
              <Link to="/register">
                {t("Create your drive")} <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <Link to="/login">{t("I have an account")}</Link>
            </Button>
          </div>
        </div>
        <DrivePreview />
      </div>
    </section>
  )
}

function DrivePreview() {
  const { t } = useI18n()
  const rows = [
    { name: t("Contracts"), meta: t("Folder · 12 items"), tone: "bg-secondary text-secondary-foreground", icon: FolderLockIcon },
    { name: t("passport-scan.jpg"), meta: t("1.8 MB · 2 links"), tone: "bg-coral-soft text-coral", icon: LockKeyholeIcon },
    { name: t("Wi-Fi & door codes"), meta: t("Note · burned"), tone: "bg-lavender-soft text-accent-foreground", icon: KeyRoundIcon },
  ]
  return (
    <div aria-hidden className="relative rounded-2xl bg-muted/60 p-3 sm:p-4">
      <div className="rounded-xl border bg-card p-2 shadow-soft">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-medium">{t("My drive")}</span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.6875rem] text-secondary-foreground">
            {t("{used} of {total}", { used: formatBytes(2.1 * 1024 ** 3), total: formatBytes(100 * 1024 ** 3) })}
          </span>
        </div>
        <ul className="mt-1 grid">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60">
              <span className={`grid size-9 place-items-center rounded-lg ${r.tone}`}>
                <r.icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.meta}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
