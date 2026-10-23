import { useEffect, useRef, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  ArrowRightIcon,
  BriefcaseIcon,
  CalendarClockIcon,
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
import { PlanFinePrint, PlanGrid, usePlans, usePlansOpen } from "@/components/plans"
import { track, trackOnce } from "@/lib/analytics"
import { useSession } from "@/lib/session"
import { SiteFooter, SiteHeader } from "@/components/site-header"
import { formatBytes } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { GITHUB_URL, OPERATOR, SITE_HOST, SUPPORT_EMAIL } from "@/lib/contact"

export const Route = createFileRoute("/")({ component: Home })

function Home() {
  return (
    <div className="flex min-h-svh flex-col overflow-x-clip">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <Problem />
        <HowItWorks />
        <UseCases />
        <SendAFile />
        <DriveCta />
        <SecurityBand />
        <Pricing />
      </main>
      <SiteFooter />
    </div>
  )
}

function Hero() {
  const { t } = useI18n()
  const { status } = useSession()
  const signedIn = status === "locked" || status === "unlocked"
  return (
    <section className="px-3 pb-3 sm:px-4">
      <div className="relative mx-auto flex min-h-[min(calc(100svh-5.75rem),60rem)] max-w-[88rem] overflow-hidden rounded-[2rem] bg-hero text-hero-foreground sm:rounded-[2.5rem]">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute top-1/2 -right-40 size-[56rem] -translate-y-1/2 rounded-full border border-white/10" />
          <div className="absolute top-1/2 -right-16 size-[40rem] -translate-y-1/2 rounded-full border border-white/10" />
          <div className="absolute top-1/2 right-8 size-[24rem] -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--lime)_45%,transparent),transparent)]" />
        </div>

        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-5 py-12 sm:px-10 sm:py-14 lg:grid-cols-[1.2fr_1fr] lg:gap-10 lg:px-14">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/12 py-1 pr-3.5 pl-1 text-sm font-medium backdrop-blur">
              <span className="grid size-6 place-items-center rounded-full bg-lime text-hero">
                <InboxIcon className="size-3.5" />
              </span>
              {t("File requests, no account for your clients")}
            </span>
            <h1 className="mt-6 text-[2.25rem] leading-[1.02] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3rem] xl:text-[3.5rem]">
              {t("Collect documents from clients.")} <span className="text-lime">{t("Encrypted on their device, before upload.")}</span>
            </h1>
            <p className="mt-6 max-w-lg text-base text-pretty text-hero-foreground/80 sm:text-lg">
              {t(
                "Send a link. Your client uploads from any browser, no account needed. Only you hold the key, so not even we can open what they send."
              )}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Button size="lg" asChild className="h-12 bg-lime px-7 text-base text-hero hover:bg-lime/85">
                <Link to={signedIn ? "/requests" : "/register"} onClick={() => track("hero-request")}>
                  {t("Create a request link")} <ArrowRightIcon data-icon="inline-end" />
                </Link>
              </Button>
              <a
                href="#send"
                onClick={() => track("hero-send")}
                className="text-sm font-medium text-hero-foreground/85 underline-offset-4 hover:underline"
              >
                {t("Just need to send a file?")}
              </a>
            </div>
            <p className="mt-4 text-sm text-hero-foreground/70">
              {t("Free to start. No card needed.")}{" "}
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-hero-foreground">
                {t("Read the code on GitHub")}
              </a>
            </p>
          </div>

          <RequestPageMock />
        </div>
      </div>
    </section>
  )
}

/** What a client sees when they open the link. */
function RequestPageMock() {
  const { t } = useI18n()
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md text-foreground lg:mx-0 lg:ml-auto">
      <div className="rotate-1 rounded-[2rem] bg-card p-3 shadow-[0_30px_60px_-20px_oklch(0.2_0.05_158/45%)]">
        <div className="p-4 sm:p-5">
          <p className="font-heading text-2xl leading-tight font-semibold text-balance">{t("Documents for your tax return")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("Only the owner can open what you send.")}</p>
        </div>
        <div className="grid place-items-center gap-2 rounded-3xl border-2 border-dashed px-4 py-8 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-secondary text-secondary-foreground">
            <InboxIcon className="size-5" />
          </span>
          <p className="text-sm font-medium">{t("Drop files or tap to browse")}</p>
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-muted px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{t("payslip-march.pdf")}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card">
              <div className="h-full w-3/4 rounded-full bg-primary" />
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{formatBytes(1.2 * 1024 ** 2)}</span>
        </div>
      </div>
    </div>
  )
}

/** A 3D object for a card. Until its image is in /public/3d the card shows a plain icon instead. */
function Visual({ name, icon: Icon, className }: { name: string; icon: typeof LockKeyholeIcon; className?: string }) {
  const [missing, setMissing] = useState(false)
  if (missing)
    return (
      <span aria-hidden className={`grid place-items-center rounded-full bg-white/40 ${className ?? ""} !top-8 !right-8 size-28!`}>
        <Icon className="size-1/3 opacity-60" strokeWidth={1.5} />
      </span>
    )
  return (
    <img src={`/3d/${name}.webp`} alt="" loading="lazy" onError={() => setMissing(true)} className={`object-contain ${className ?? ""}`} />
  )
}

/** Why not just email: the habit Coffer replaces, said once. */
function Problem() {
  const { t } = useI18n()
  return (
    <section className="mx-auto max-w-3xl px-4 pt-20 text-center sm:px-6 sm:pt-28">
      <h2 className="text-3xl leading-[1.1] font-semibold text-balance sm:text-5xl">{t("Email was never meant for passports.")}</h2>
      <p className="mx-auto mt-5 max-w-2xl text-pretty text-muted-foreground sm:text-lg">
        {t(
          "A scan sent by email stays in your client's sent folder and in your inbox for years, readable by both email providers and by anyone who gets into either account. A Coffer link puts it in one place that only you can open, and you delete it when the job is done."
        )}
      </p>
    </section>
  )
}

function HowItWorks() {
  const { t } = useI18n()
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-24 pb-28 sm:px-6 sm:pt-36 sm:pb-44">
      <div className="text-center">
        <p className="eyebrow">{t("How it works")}</p>
        <h2 className="mt-3 text-4xl leading-[1.05] font-semibold text-balance sm:text-6xl">
          {t("Three steps. Nothing for your client to install.")}
        </h2>
      </div>
      <div className="mt-14 grid items-start gap-3 lg:grid-cols-3">
        <StepCard
          n="1"
          visual="make"
          icon={LinkIcon}
          title={t("Make a link")}
          body={t("Say what you need and by when. Set how many files, how large, and when the link stops working.")}
          className="bg-lavender-soft [&_.step-body]:text-foreground/70"
        >
          <div className="rounded-2xl bg-card px-3.5 py-2.5 text-sm shadow-soft">
            <p className="font-medium">{t("Documents for your tax return")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("Up to 10 files, closes in 7 days")}</p>
          </div>
        </StepCard>
        <StepCard
          n="2"
          visual="share"
          icon={SendIcon}
          title={t("Send it to your client")}
          body={t(
            "They open it in any browser, see that it comes from you, and drop their files in. The link can only upload: it can't read, list or delete anything."
          )}
          className="bg-forest text-forest-foreground lg:mt-12 [&_.step-body]:text-forest-foreground/70"
        >
          <div className="rounded-2xl bg-white/10 px-3.5 py-2.5 text-sm break-all">
            {SITE_HOST}/r/k7m3xq2<span className="rounded bg-lime/25 px-1 text-lime">#h4c9w2pz8rtf</span>
          </div>
        </StepCard>
        <StepCard
          n="3"
          visual="inbox"
          icon={InboxIcon}
          title={t("Open them in your drive")}
          body={t("We email you when files arrive. They wait in your drive, and only you can open them.")}
          className="bg-secondary [&_.step-body]:text-foreground/70"
        >
          <div className="flex items-center gap-3 rounded-2xl bg-card px-3.5 py-2.5 text-sm shadow-soft">
            <ShieldCheckIcon className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate font-medium">{t("payslip-march.pdf")}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(1.2 * 1024 ** 2)}</span>
          </div>
        </StepCard>
      </div>
    </section>
  )
}

function StepCard({
  n,
  visual,
  icon,
  title,
  body,
  className,
  children,
}: {
  n: string
  visual: string
  icon: typeof LockKeyholeIcon
  title: string
  body: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`relative flex min-h-[26rem] flex-col overflow-hidden rounded-[2.5rem] p-7 sm:p-9 ${className ?? ""}`}>
      <Visual name={visual} icon={icon} className="pointer-events-none absolute top-0 right-4 size-52" />
      <span className="relative font-heading text-7xl leading-none font-semibold opacity-25">{n}</span>
      <div className="relative mt-auto pt-20">
        <h3 className="text-2xl leading-tight font-semibold sm:text-3xl">{title}</h3>
        <p className="step-body mt-2 text-sm">{body}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}

const cases = [
  {
    icon: FolderLockIcon,
    visual: "folder",
    title: "Client documents",
    body: "Tax papers, IDs and receipts. One link per client, and everything lands in one place instead of across email threads.",
    span: "lg:col-span-6",
    tone: "bg-forest text-forest-foreground [&_.case-body]:text-forest-foreground/70",
  },
  {
    icon: CalendarClockIcon,
    visual: "calendar",
    title: "Coursework with a deadline",
    body: "Set the link to close at the deadline and cap the file size. Students upload without making an account.",
    span: "lg:col-span-6",
    tone: "bg-lavender-soft [&_.case-body]:text-foreground/70",
  },
  {
    icon: FlameIcon,
    visual: "flame",
    title: "A contract that burns after one view",
    body: "Send a file with a link that works once or expires tomorrow. Add a password for a second lock.",
    span: "lg:col-span-6",
    tone: "bg-coral-soft [&_.case-body]:text-foreground/70",
  },
  {
    icon: BriefcaseIcon,
    visual: "cv",
    title: "Applications and CVs",
    body: "Put one link in a job post. Candidates upload their documents, and only you can open them.",
    span: "lg:col-span-6",
    tone: "bg-secondary [&_.case-body]:text-foreground/70",
  },
]

function UseCases() {
  const { t } = useI18n()
  return (
    <section id="use-cases" className="relative mx-auto max-w-6xl scroll-mt-20 px-4 pb-28 sm:px-6 sm:pb-44">
      <h2 className="mx-auto max-w-3xl text-center text-4xl leading-[1.05] font-semibold text-balance sm:text-6xl">
        {t("The paperwork you keep chasing")}
      </h2>
      <div className="mt-14 grid gap-3 lg:grid-cols-12">
        {cases.map(({ icon, visual, title, body, span, tone }) => (
          <div
            key={title}
            className={`relative flex min-h-[19rem] flex-col justify-end overflow-hidden rounded-[2.5rem] p-7 sm:p-9 lg:min-h-[17rem] ${span} ${tone}`}
          >
            <Visual
              name={visual}
              icon={icon}
              className="pointer-events-none absolute -top-2 -right-3 size-52 sm:right-4 lg:top-1/2 lg:right-8 lg:size-56 lg:-translate-y-1/2"
            />
            <h3 className="relative max-w-[15rem] text-2xl leading-tight font-semibold text-balance sm:text-3xl">{t(title)}</h3>
            <p className="case-body relative mt-2 max-w-[15rem] text-sm">{t(body)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The second act: no account, no request, just a link. */
function SendAFile() {
  const { t } = useI18n()
  return (
    <section id="send" className="scroll-mt-20 px-3 pb-28 sm:px-4 sm:pb-44">
      <div className="mx-auto grid max-w-6xl items-center gap-10 rounded-[2.5rem] bg-secondary p-6 sm:p-12 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
        <div>
          <h2 className="text-4xl leading-[1.05] font-semibold text-balance sm:text-5xl">{t("Just need to send a file?")}</h2>
          <p className="mt-4 max-w-md text-pretty text-foreground/70">
            {t("Drop it here and get a link. No account needed. Add a password, an expiry or a view limit if you like.")}
          </p>
        </div>
        <div className="mx-auto w-full max-w-xl lg:mx-0">
          <DropComposer onFilesAdded={() => trackOnce("composer-used")} />
        </div>
      </div>
    </section>
  )
}

function DriveCta() {
  const { t } = useI18n()
  return (
    <section className="mx-auto max-w-[88rem] px-4 pb-28 sm:px-6 sm:pb-44">
      <div className="grid items-center gap-12 overflow-hidden rounded-[2.5rem] bg-lavender-soft p-6 sm:rounded-[3rem] sm:p-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:p-16">
        <div>
          <h2 className="text-4xl leading-[1.05] font-semibold text-balance sm:text-5xl">{t("A private place for what comes in.")}</h2>
          <p className="mt-4 max-w-lg text-pretty text-foreground/70">
            {t("A drive keeps what clients send, with folders, notes and every link you've shared. You can revoke any link at any time.")}
          </p>
          <ul className="mt-6 grid gap-2.5 text-sm">
            {[
              "File names stay private too",
              "Revoke any share link instantly",
              "A recovery key, so a forgotten password isn't the end",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <span className="grid size-5 place-items-center rounded-full bg-hero text-lime">
                  <CheckIcon className="size-3" />
                </span>
                {t(item)}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <Button size="lg" asChild>
              <Link to="/register" onClick={() => track("signup-drive")}>
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
    { name: t("Tax documents"), meta: t("Folder · 12 items"), tone: "bg-secondary text-secondary-foreground", icon: FolderLockIcon },
    { name: t("passport-scan.jpg"), meta: t("1.8 MB · 2 links"), tone: "bg-coral-soft text-coral", icon: LockKeyholeIcon, active: true },
    { name: t("Rental application"), meta: t("Note · burned"), tone: "bg-lavender-soft text-accent-foreground", icon: KeyRoundIcon },
  ]
  return (
    <div aria-hidden className="relative sm:pr-8 sm:pb-9">
      <div className="rounded-[2rem] bg-card p-3 text-card-foreground shadow-[0_30px_60px_-20px_oklch(0.2_0.05_300/35%)] sm:p-4">
        <div className="flex items-center justify-between px-2 py-2">
          <span className="font-medium">{t("My drive")}</span>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
            {t("{used} of {total}", { used: formatBytes(2.1 * 1024 ** 3), total: formatBytes(100 * 1024 ** 3) })}
          </span>
        </div>
        <ul className="mt-1 grid gap-1">
          {rows.map((r) => (
            <li key={r.name} className={`flex items-center gap-3 rounded-2xl px-2 py-2.5 ${r.active ? "bg-muted" : ""}`}>
              <span className={`grid size-11 place-items-center rounded-xl ${r.tone}`}>
                <r.icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate">{r.name}</p>
                <p className="text-sm text-muted-foreground">{r.meta}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative -mt-5 ml-6 flex items-center gap-3 rounded-3xl bg-hero p-3 pr-4 text-hero-foreground shadow-[0_24px_50px_-18px_oklch(0.2_0.05_158/60%)] sm:absolute sm:right-0 sm:bottom-0 sm:left-auto sm:mt-0 sm:ml-0 sm:w-[22rem]">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-lime text-hero">
          <LinkIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{t("Share link")}</p>
          <p className="text-xs text-pretty text-hero-foreground/70">{t("Expires in 7 days · 1 view left")}</p>
        </div>
        <span className="shrink-0 rounded-full bg-white/12 px-3 py-1.5 text-xs font-medium">{t("Revoke link")}</span>
      </div>
    </div>
  )
}

/** Said once, plainly. The details live on /security. */
function SecurityBand() {
  const { t } = useI18n()
  return (
    <section className="bg-forest text-forest-foreground">
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-6 py-16 sm:px-10 sm:py-24 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <h2 className="text-4xl leading-[1.05] font-semibold text-balance sm:text-5xl">{t("Don't take our word for it.")}</h2>
          <p className="mt-5 max-w-xl text-pretty text-forest-foreground/75 sm:text-lg">
            {t(
              "Files and their names are encrypted in your browser before upload, so our server only stores what it can't open. The code is public, so anyone can check. What the server does see: how large a file is and when it arrived."
            )}
          </p>
          <ul className="mt-6 grid gap-2.5 text-sm sm:text-base">
            <li className="flex items-center gap-2.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-lime text-hero">
                <CheckIcon className="size-3" />
              </span>
              {t("Servers in Germany, encrypted files stored in the EU")}
            </li>
            <li className="flex items-center gap-2.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-lime text-hero">
                <CheckIcon className="size-3" />
              </span>
              <Link to="/dpa" className="underline-offset-4 hover:underline">
                {t("A GDPR data processing agreement, included")}
              </Link>
            </li>
          </ul>
          <div className="mt-8 flex flex-wrap gap-2">
            <Button size="lg" variant="secondary" asChild>
              <Link to="/security">{t("How it works in detail")}</Link>
            </Button>
            <Button size="lg" variant="ghost" asChild className="text-forest-foreground hover:bg-white/10 hover:text-forest-foreground">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                {t("Read the code on GitHub")}
              </a>
            </Button>
          </div>
          <p className="mt-8 max-w-xl text-sm text-pretty text-forest-foreground/70">
            {t("Built and run by {name}. Questions go straight to the person who built it:", { name: OPERATOR })}{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4 hover:text-forest-foreground">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
        <div className="flex justify-center lg:justify-end">
          <Visual name="lock" icon={LockKeyholeIcon} className="size-60 sm:size-72" />
        </div>
      </div>
    </section>
  )
}

function Pricing() {
  const { t } = useI18n()
  const { status } = useSession()
  const navigate = useNavigate()
  const plans = usePlans()
  const open = usePlansOpen()
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = section.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && trackOnce("pricing-reached"), {
      threshold: 0.3,
    })
    seen.observe(el)
    return () => seen.disconnect()
  }, [plans])
  if (!plans) return null
  const signedIn = status === "locked" || status === "unlocked"
  return (
    <section ref={section} id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-28 sm:px-6 sm:py-44">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">{t("Pricing")}</p>
        <h2 className="mt-3 text-4xl leading-[1.05] font-semibold text-balance sm:text-6xl">
          {t("Start free. Pay when you need more room.")}
        </h2>
        <p className="mt-4 text-pretty text-muted-foreground">
          {open
            ? t("The free account is yours to keep, with nothing deleted. Pay only when you need more room.")
            : t("Start with the free drive today. The paid plans, with more room, open soon.")}
        </p>
      </div>
      <div className="mx-auto mt-12 max-w-6xl">
        <PlanGrid
          plans={plans}
          freeLabel={signedIn ? t("Open drive") : t("Start free")}
          onPickFree={() => {
            track("plan-clicked", { plan: "free" })
            navigate({ to: signedIn ? "/drive" : "/register" })
          }}
          label={() => (signedIn ? t("Choose plan") : t("Get started"))}
          onPick={(plan) => {
            track("plan-clicked", { plan: plan.id })
            navigate({ to: signedIn ? "/drive" : "/register" })
          }}
        />
        <PlanFinePrint className="mx-auto mt-6 max-w-xl text-center" />
      </div>
    </section>
  )
}
