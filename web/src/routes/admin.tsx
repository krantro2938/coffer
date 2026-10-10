import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CalendarIcon,
  CopyIcon,
  ExternalLinkIcon,
  FilterIcon,
  HandshakeIcon,
  Loader2Icon,
  LogOutIcon,
  RepeatIcon,
  SearchIcon,
} from "lucide-react"
import { OptionPicker } from "@/components/option-picker"
import { Brand, LogoMark } from "@/components/brand"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { UsageBar } from "@/components/usage-bar"
import { api, ApiError } from "@/lib/api"
import { formatBytes, relativeTime, shortDate } from "@/lib/format"
import { useCopy } from "@/hooks/use-copy"
import { cn } from "@/lib/utils"

// The operator's console. It is served on its own hostname by its own
// listener; on the public site its API does not exist and this page says so.
// English only: it is a tool for whoever runs the server.
export const Route = createFileRoute("/admin")({ component: AdminPage })

type Offer = { cents: number; interval: "month" | "year"; trialDays: number; quota: number }
type Terms = { compQuota?: number | null; compUntil?: number | null; offer?: Offer | null }
type User = Terms & {
  id: string
  email: string
  createdAt: number
  verified: boolean
  google: boolean
  plan: string | null
  status: string | null
  periodEnd: number | null
  cancelAt: number | null
  lapsedAt: number | null
  suspendedAt: number | null
  suspendReason: string | null
  note: string | null
  quota: number
  used: number
  files: number
  links: number
  covered: boolean
  customerId?: string
  subscriptionId?: string
  lastSeen?: number
}
type Overview = Record<string, number> & { billing: boolean; byPlan: Record<string, number> }
type Invite = Terms & { id: string; email: string; createdAt: number; expiresAt: number; usedAt?: number; note: string }
type TrialRequest = { email: string; lang: string; createdAt: number; invitedAt: number | null }
type Report = {
  id: string
  shareId: string
  reason: string
  details: string
  status: string
  createdAt: number
  resolvedAt?: number
  resolution: string
  linkLive: boolean
  contact: string
  ownerId?: string
  ownerEmail?: string
  ownerReports?: number
  reviewUrl?: string
}

const GB = 1024 ** 3
const euro = (cents: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100)

function AdminPage() {
  const qc = useQueryClient()
  const session = useQuery({
    queryKey: ["admin", "session"],
    queryFn: () => api<{ signedIn: boolean }>("/api/admin/session"),
    retry: false,
  })
  const [tab, setTab] = useState("overview")

  if (session.isLoading)
    return (
      <Centered>
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </Centered>
    )
  if (session.isError) {
    return (
      <Centered>
        <div className="text-center">
          <p className="eyebrow">Error 404</p>
          <h1 className="mt-2 text-3xl font-medium">Nothing to see here.</h1>
        </div>
      </Centered>
    )
  }
  if (!session.data?.signedIn) return <SignIn onDone={() => qc.invalidateQueries({ queryKey: ["admin"] })} />

  const signOut = async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {})
    qc.removeQueries({ queryKey: ["admin"] })
    qc.invalidateQueries({ queryKey: ["admin", "session"] })
  }

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Brand to="/admin" />
            <span className="rounded-full bg-forest px-2 py-0.5 text-[0.6875rem] font-medium text-forest-foreground">Admin</span>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOutIcon /> Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">Accounts</TabsTrigger>
            <TabsTrigger value="invites">Invitations</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="log">Activity</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="mt-6">
          {tab === "overview" && <OverviewTab go={setTab} />}
          {tab === "users" && <UsersTab />}
          {tab === "invites" && <InvitesTab />}
          {tab === "reports" && <ReportsTab />}
          {tab === "log" && <LogTab />}
        </div>
      </main>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-svh place-items-center px-4">{children}</div>
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api("/api/admin/login", { body: { token } })
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
      setToken("")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Centered>
      <form onSubmit={submit} className="grid w-full max-w-sm gap-6 rounded-[1.75rem] border bg-card p-6 shadow-soft sm:p-8">
        <div className="grid justify-items-center gap-4 text-center">
          <LogoMark className="size-12" />
          <div>
            <h1 className="text-2xl font-medium">Coffer admin</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">Enter the admin token from the server's settings.</p>
          </div>
        </div>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin token"
          autoComplete="off"
          autoFocus
          required
        />
        <Button size="lg" type="submit" disabled={busy}>
          {busy && <Loader2Icon className="animate-spin" />} Sign in
        </Button>
      </form>
    </Centered>
  )
}

// ------------------------------------------------------------------ overview

function OverviewTab({ go }: { go: (tab: string) => void }) {
  const { data } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api<Overview>("/api/admin/overview"),
    refetchInterval: 30_000,
  })
  if (!data) return <Loading />
  const stats: [string, string, string?][] = [
    ["Accounts", String(data.users), `${data.newThisWeek} new this week`],
    ["Paying", String(data.paying), data.pastDue ? `${data.pastDue} with a failed payment` : undefined],
    ["List revenue", `${euro(data.listMonthlyCents)} / mo`, "Listed plans, before VAT and fees"],
    ["Stored in drives", formatBytes(data.storedBytes), `${data.driveFiles} files`],
    ["Quick shares", formatBytes(data.quickShareBytes), `${data.liveLinks} live links in all`],
    ["Complimentary", String(data.comped)],
    ["Lapsed", String(data.lapsed), "In their grace period"],
    ["Suspended", String(data.suspended)],
  ]
  return (
    <div className="grid gap-6">
      {data.openReports > 0 && (
        <button
          type="button"
          onClick={() => go("reports")}
          className="flex items-center justify-between gap-4 rounded-2xl bg-coral-soft p-4 text-left text-sm"
        >
          <span>
            <span className="font-medium">
              {data.openReports} open {data.openReports === 1 ? "report" : "reports"}.
            </span>{" "}
            Someone flagged a link and is waiting for a decision.
          </span>
          <span className="shrink-0 font-medium underline underline-offset-4">Review</span>
        </button>
      )}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border lg:grid-cols-4">
        {stats.map(([label, value, hint]) => (
          <div key={label} className="bg-card p-5">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-3xl font-medium tracking-tight tabular-nums">{value}</dd>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>
        ))}
      </dl>
      <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
        This console shows who has an account, what they pay and how much they store. It cannot show file names or contents: those are
        encrypted in the browser and the keys never reach this server.
      </p>
    </div>
  )
}

function Loading() {
  return (
    <div className="grid place-items-center py-20">
      <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
    </div>
  )
}

// --------------------------------------------------------------------- terms

type TermsKind = "none" | "comp" | "offer"
// `span` is how long complimentary storage lasts: 0 for no end, a number of days, or -1 for a chosen date.
type TermsState = {
  kind: TermsKind
  quotaGB: string
  span: number
  until: string
  price: string
  interval: "month" | "year"
  trialDays: string
}

const KINDS: TermsKind[] = ["none", "comp", "offer"]
const kindOptions = [
  { value: 0, label: "Standard plans", hint: "They pick a listed plan and pay for it" },
  { value: 1, label: "Complimentary", hint: "Storage at no charge, for a while or for good" },
  { value: 2, label: "Personal price", hint: "Your price, paid through the checkout" },
]
const spanOptions = [
  { value: 0, label: "No end date", hint: "Until you change it" },
  { value: 30, label: "1 month" },
  { value: 90, label: "3 months" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
  { value: -1, label: "Until a date", hint: "Pick the last day" },
]
const intervalOptions = [
  { value: 0, label: "Every month" },
  { value: 1, label: "Every year" },
]

const termsFrom = (t: Terms): TermsState => ({
  kind: t.compQuota ? "comp" : t.offer ? "offer" : "none",
  quotaGB: String(Math.round((t.compQuota ?? t.offer?.quota ?? 100 * GB) / GB)),
  span: t.compUntil ? -1 : 0,
  until: t.compUntil ? new Date(t.compUntil * 1000).toISOString().slice(0, 10) : "",
  price: t.offer ? (t.offer.cents / 100).toFixed(2) : "4.99",
  interval: t.offer?.interval ?? "month",
  trialDays: String(t.offer?.trialDays ?? 0),
})

function compUntil(s: TermsState): number {
  if (s.span > 0) return Math.floor(Date.now() / 1000) + s.span * 86400
  if (s.span === -1 && s.until) return Math.floor(new Date(`${s.until}T23:59:59Z`).getTime() / 1000)
  return 0
}

function toTerms(s: TermsState): Terms {
  const quota = Math.round(Number(s.quotaGB) * GB)
  if (s.kind === "comp") return { compQuota: quota, compUntil: compUntil(s), offer: null }
  if (s.kind === "offer") {
    return {
      compQuota: null,
      offer: { cents: Math.round(Number(s.price) * 100), interval: s.interval, trialDays: Number(s.trialDays) || 0, quota },
    }
  }
  return { compQuota: null, offer: null }
}

function describeTerms(t: Terms): string {
  if (t.compQuota) return `${formatBytes(t.compQuota)} free${t.compUntil ? ` until ${shortDate(t.compUntil)}` : ", no end date"}`
  if (t.offer)
    return `${formatBytes(t.offer.quota)} for ${euro(t.offer.cents)} a ${t.offer.interval}${t.offer.trialDays ? `, ${t.offer.trialDays}-day trial` : ""}`
  return "Standard plans"
}

/** An input drawn like the pickers beside it: one tile with its label inside and its unit at the edge. */
function Field({ label, unit, className, ...input }: { label: string; unit?: string } & React.ComponentProps<"input">) {
  return (
    <label
      className={cn(
        "flex h-12 min-w-0 cursor-text items-center gap-2 rounded-xl border border-input bg-card px-3 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        className
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[0.6875rem] leading-tight text-muted-foreground">{label}</span>
        <input
          {...input}
          className="block w-full min-w-0 [appearance:textfield] bg-transparent text-sm leading-tight font-medium tabular-nums outline-none placeholder:font-normal placeholder:text-muted-foreground/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </span>
      {unit && <span className="shrink-0 text-sm text-muted-foreground">{unit}</span>}
    </label>
  )
}

function TermsFields({ value, onChange, billing }: { value: TermsState; onChange: (v: TermsState) => void; billing: boolean }) {
  const set = (patch: Partial<TermsState>) => onChange({ ...value, ...patch })
  return (
    <div className="grid gap-3">
      <OptionPicker
        label="Arrangement"
        icon={HandshakeIcon}
        value={KINDS.indexOf(value.kind)}
        options={billing ? kindOptions : kindOptions.slice(0, 2)}
        onChange={(v) => set({ kind: KINDS[v] })}
      />
      {value.kind === "comp" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Storage"
              unit="GB"
              type="number"
              min={1}
              max={102400}
              value={value.quotaGB}
              onChange={(e) => set({ quotaGB: e.target.value })}
              required
            />
            <OptionPicker label="Lasts" icon={CalendarIcon} value={value.span} options={spanOptions} onChange={(v) => set({ span: v })} />
          </div>
          {value.span === -1 && (
            <Field label="Last day" type="date" value={value.until} onChange={(e) => set({ until: e.target.value })} required />
          )}
          {value.span !== 0 && (
            <p className="text-xs text-pretty text-muted-foreground">
              Afterwards the drive turns read-only and follows the usual grace period before its files are deleted.
            </p>
          )}
        </>
      )}
      {value.kind === "offer" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Storage"
              unit="GB"
              type="number"
              min={1}
              max={102400}
              value={value.quotaGB}
              onChange={(e) => set({ quotaGB: e.target.value })}
              required
            />
            <Field
              label="Price"
              unit="EUR"
              type="number"
              min={1}
              step="0.01"
              value={value.price}
              onChange={(e) => set({ price: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <OptionPicker
              label="Charged"
              icon={RepeatIcon}
              value={value.interval === "year" ? 1 : 0}
              options={intervalOptions}
              onChange={(v) => set({ interval: v === 1 ? "year" : "month" })}
            />
            <Field
              label="Free trial"
              unit="days"
              type="number"
              min={0}
              max={365}
              value={value.trialDays}
              onChange={(e) => set({ trialDays: e.target.value })}
            />
          </div>
        </>
      )}
    </div>
  )
}

function useBilling() {
  const { data } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => api<Overview>("/api/admin/overview") })
  return !!data?.billing
}

// ------------------------------------------------------------------ accounts

const FILTERS = ["all", "paying", "comped", "lapsed", "suspended", "unverified"]
const filterOptions = [
  { value: 0, label: "All accounts" },
  { value: 1, label: "Paying" },
  { value: 2, label: "Complimentary" },
  { value: 3, label: "Lapsed" },
  { value: 4, label: "Suspended" },
  { value: 5, label: "Unconfirmed email" },
]

function standing(u: User): { label: string; tone: string } {
  if (u.suspendedAt) return { label: "Suspended", tone: "bg-destructive/10 text-destructive" }
  if (!u.verified) return { label: "Unconfirmed", tone: "bg-muted text-muted-foreground" }
  if (u.status === "past_due") return { label: "Payment failed", tone: "bg-coral-soft" }
  if (u.status === "active" || u.status === "trialing")
    return {
      label: u.status === "trialing" ? "Trial" : u.plan ? u.plan[0].toUpperCase() + u.plan.slice(1) : "Paying",
      tone: "bg-secondary text-secondary-foreground",
    }
  if (u.compQuota && (!u.compUntil || u.compUntil > Date.now() / 1000)) return { label: "Complimentary", tone: "bg-lavender-soft" }
  if (u.lapsedAt) return { label: "Lapsed", tone: "bg-coral-soft" }
  return { label: "No plan", tone: "bg-muted text-muted-foreground" }
}

function UsersTab() {
  const [q, setQ] = useState("")
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const [openId, setOpenId] = useState<string | null>(null)
  useEffect(() => {
    const id = setTimeout(() => setSearch(q), 250)
    return () => clearTimeout(id)
  }, [q])
  const { data } = useQuery({
    queryKey: ["admin", "users", search, filter],
    queryFn: () => api<User[]>(`/api/admin/users?q=${encodeURIComponent(search)}&filter=${filter}`),
  })

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email" className="h-12 rounded-xl pl-9" />
        </div>
        <div className="w-56">
          <OptionPicker
            label="Show"
            icon={FilterIcon}
            value={FILTERS.indexOf(filter)}
            options={filterOptions}
            onChange={(v) => setFilter(FILTERS[v])}
          />
        </div>
      </div>
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          No accounts match. Invite someone from the Invitations tab.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="hidden grid-cols-[1fr_9rem_12rem_7rem] gap-4 border-b px-4 py-2.5 text-xs text-muted-foreground sm:grid">
            <span>Account</span>
            <span>Standing</span>
            <span>Storage</span>
            <span>Joined</span>
          </div>
          <ul>
            {data.map((u) => {
              const s = standing(u)
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(u.id)}
                    className="grid w-full grid-cols-1 items-center gap-x-4 gap-y-1.5 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/50 sm:grid-cols-[1fr_9rem_12rem_7rem]"
                  >
                    <span className="truncate font-medium">{u.email}</span>
                    <span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", s.tone)}>{s.label}</span>
                    </span>
                    <span className="grid gap-1">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatBytes(u.used)}
                        {u.quota > 0 && <> of {formatBytes(u.quota)}</>} · {u.files} files
                      </span>
                      {u.quota > 0 && <UsageBar used={u.used} quota={u.quota} />}
                    </span>
                    <span className="text-xs text-muted-foreground">{shortDate(u.createdAt)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {data && data.length >= 200 && <p className="text-xs text-muted-foreground">Showing the newest 200. Search to narrow it down.</p>}
      <UserDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words">{children}</dd>
    </div>
  )
}

function UserDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const billing = useBilling()
  const { data: u } = useQuery({ queryKey: ["admin", "user", id], queryFn: () => api<User>(`/api/admin/users/${id}`), enabled: !!id })
  const [terms, setTerms] = useState<TermsState | null>(null)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [confirmDelete, setConfirmDelete] = useState("")
  useEffect(() => {
    if (u) {
      setTerms(termsFrom(u))
      setNote(u.note ?? "")
      setReason("")
      setConfirmDelete("")
    }
  }, [u])

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] })
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<User>(`/api/admin/users/${id}`, { body }),
    onSuccess: (next, body) => {
      qc.setQueryData(["admin", "user", id], next)
      refresh()
      toast.success(body.action === "terms" ? "Terms saved" : body.action === "suspend" ? "Account suspended" : "Done")
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: () => api(`/api/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Account and all its files deleted")
      refresh()
      onClose()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const busy = act.isPending || remove.isPending

  return (
    <ResponsiveDialog
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={u?.email ?? "Account"}
      description={u ? `Joined ${shortDate(u.createdAt)}` : undefined}
      className="sm:max-w-2xl"
    >
      {!u || !terms ? (
        <Loading />
      ) : (
        <div className="grid max-h-[70svh] gap-6 overflow-y-auto pr-1">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
            <Fact label="Standing">{standing(u).label}</Fact>
            <Fact label="Storage">
              {formatBytes(u.used)}
              {u.quota > 0 ? ` of ${formatBytes(u.quota)}` : ""}
            </Fact>
            <Fact label="Files and links">
              {u.files} files, {u.links} links
            </Fact>
            <Fact label="Sign-in">{u.google ? "Password and Google" : "Password"}</Fact>
            <Fact label="Last signed in">{u.lastSeen ? relativeTime(u.lastSeen) : "No live session"}</Fact>
            <Fact label="Plan">
              {u.plan ? `${u.plan} (${u.status})` : "None"}
              {u.cancelAt
                ? `, ends ${shortDate(u.cancelAt)}`
                : u.periodEnd && u.status === "active"
                  ? `, renews ${shortDate(u.periodEnd)}`
                  : ""}
            </Fact>
          </dl>
          {u.suspendedAt && (
            <p className="rounded-xl bg-destructive/10 p-3 text-sm">
              <span className="font-medium">Suspended {shortDate(u.suspendedAt)}.</span> {u.suspendReason}
            </p>
          )}
          {u.lapsedAt && !u.covered && (
            <p className="rounded-xl bg-coral-soft p-3 text-sm">
              Lapsed on {shortDate(u.lapsedAt)}; the drive is read-only and in its grace period.
            </p>
          )}

          <section className="grid gap-4">
            <h3 className="font-medium">Terms</h3>
            <TermsFields value={terms} onChange={setTerms} billing={billing} />
            <div>
              <Button onClick={() => act.mutate({ action: "terms", ...toTerms(terms) })} disabled={busy}>
                Save terms
              </Button>
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="font-medium">Private note</h3>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              placeholder="Only admins see this."
              className="min-h-20"
            />
            <div>
              <Button variant="outline" onClick={() => act.mutate({ action: "note", note })} disabled={busy}>
                Save note
              </Button>
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="font-medium">Access</h3>
            <div className="flex flex-wrap gap-2">
              {!u.verified && (
                <Button variant="outline" onClick={() => act.mutate({ action: "verify" })} disabled={busy}>
                  Mark email confirmed
                </Button>
              )}
              <Button variant="outline" onClick={() => act.mutate({ action: "sign-out" })} disabled={busy}>
                Sign out everywhere
              </Button>
              {billing && u.subscriptionId && (
                <Button variant="outline" onClick={() => act.mutate({ action: "sync" })} disabled={busy}>
                  Refresh from Paddle
                </Button>
              )}
              {u.suspendedAt && (
                <Button variant="outline" onClick={() => act.mutate({ action: "unsuspend" })} disabled={busy}>
                  Lift suspension
                </Button>
              )}
            </div>
            {!u.suspendedAt && (
              <div className="grid gap-2 rounded-xl border p-3">
                <Label htmlFor="suspend-reason">Suspend this account</Label>
                <p className="text-xs text-muted-foreground">
                  Signs them out, blocks sign-in and pauses every link they shared. Nothing is deleted.
                </p>
                <div className="flex gap-2">
                  <Input
                    id="suspend-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (kept in the activity log)"
                    maxLength={500}
                  />
                  <Button variant="outline" onClick={() => act.mutate({ action: "suspend", reason })} disabled={busy || !reason.trim()}>
                    Suspend
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="grid gap-2 rounded-xl border border-destructive/30 p-3">
            <h3 className="font-medium">Delete account</h3>
            <p className="text-xs text-muted-foreground">
              Cancels their plan and permanently deletes the account with all {u.files} files. This cannot be undone. Type the email to
              confirm.
            </p>
            <div className="flex gap-2">
              <Input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} placeholder={u.email} autoComplete="off" />
              <Button
                variant="destructive"
                onClick={() => remove.mutate()}
                disabled={busy || confirmDelete.trim().toLowerCase() !== u.email.toLowerCase()}
              >
                Delete
              </Button>
            </div>
          </section>
        </div>
      )}
    </ResponsiveDialog>
  )
}

// --------------------------------------------------------------- invitations

function InvitesTab() {
  const qc = useQueryClient()
  const billing = useBilling()
  const { copy } = useCopy()
  const { data } = useQuery({ queryKey: ["admin", "invites"], queryFn: () => api<Invite[]>("/api/admin/invites") })
  const [email, setEmail] = useState("")
  const [note, setNote] = useState("")
  const [terms, setTerms] = useState<TermsState>(termsFrom({ compQuota: 100 * GB }))
  const [made, setMade] = useState<{ link: string; emailed: boolean; email: string } | null>(null)
  const trials = useQuery({ queryKey: ["admin", "trials"], queryFn: () => api<TrialRequest[]>("/api/admin/trials") })
  const waiting = (trials.data ?? []).filter((r) => !r.invitedAt)

  const create = useMutation({
    mutationFn: () => api<{ link: string; emailed: boolean }>("/api/admin/invites", { body: { email, note, ...toTerms(terms) } }),
    onSuccess: (res) => {
      setMade({ ...res, email })
      setEmail("")
      setNote("")
      qc.invalidateQueries({ queryKey: ["admin"] })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/admin/invites/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr] lg:items-start">
      <div className="grid gap-4">
        {waiting.length > 0 && (
          <div className="rounded-2xl border bg-card p-5 sm:p-6">
            <h2 className="font-medium">Asked for a trial</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              People who left their address on the home page. Pick one to fill in the invitation below, set the terms, and send.
            </p>
            <ul className="mt-3 grid max-h-64 gap-1 overflow-y-auto">
              {waiting.map((r) => (
                <li key={r.email} className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-muted/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{r.email}</span>
                    <span className="block text-xs text-muted-foreground">
                      {relativeTime(r.createdAt)}
                      {r.lang ? ` · ${r.lang}` : ""}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setEmail(r.email)}>
                    Invite
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <form
          className="grid gap-3 rounded-2xl border bg-card p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <div className="mb-2">
            <h2 className="font-medium">Invite someone</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              They get a link by email, choose their own password, and the account opens on these terms. You never see or set their
              password.
            </p>
          </div>
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            required
          />
          <TermsFields value={terms} onChange={setTerms} billing={billing} />
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            aria-label="Message to add to the email"
            placeholder="Message to add to the email (optional)"
            className="min-h-24 rounded-xl bg-card"
          />
          <Button type="submit" size="lg" className="mt-2" disabled={create.isPending}>
            {create.isPending && <Loader2Icon className="animate-spin" />} Send invitation
          </Button>
          {made && (
            <div className="grid gap-2 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
              <p>
                {made.emailed
                  ? `Invitation emailed to ${made.email}.`
                  : `Email is not set up or did not go out. Send this link to ${made.email} yourself:`}
              </p>
              <button
                type="button"
                onClick={() => copy(made.link, "Link copied")}
                className="flex items-center gap-2 text-left font-mono text-xs break-all"
              >
                <CopyIcon className="size-3.5 shrink-0" /> {made.link}
              </button>
              <p className="text-xs opacity-70">This link is shown only now.</p>
            </div>
          )}
        </form>
      </div>

      <div className="grid gap-3">
        <h2 className="font-medium">Sent</h2>
        {!data ? (
          <Loading />
        ) : data.length === 0 ? (
          <p className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">No invitations yet.</p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border bg-card">
            {data.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-4 border-b px-4 py-3 text-sm last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {describeTerms(inv)} · {inv.usedAt ? `accepted ${shortDate(inv.usedAt)}` : `expires ${relativeTime(inv.expiresAt)}`}
                  </p>
                </div>
                {!inv.usedAt && (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(inv.id)} disabled={revoke.isPending}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------- reports

const reasonLabels: Record<string, string> = {
  malware: "Malware",
  phishing: "Phishing or scam",
  illegal: "Illegal content",
  copyright: "Copyright",
  harassment: "Harassment or private information",
  other: "Other",
}

function ReportsTab() {
  const qc = useQueryClient()
  const [status, setStatus] = useState("open")
  const { data } = useQuery({ queryKey: ["admin", "reports", status], queryFn: () => api<Report[]>(`/api/admin/reports?status=${status}`) })
  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api(`/api/admin/reports/${id}`, { body: { action } }),
    onSuccess: () => {
      toast.success("Report closed")
      qc.invalidateQueries({ queryKey: ["admin"] })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Something went wrong"),
  })

  return (
    <div className="grid gap-4">
      <Tabs value={status} onValueChange={setStatus}>
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="resolved">Closed</TabsTrigger>
        </TabsList>
      </Tabs>
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          {status === "open" ? "No open reports. Anyone holding a link can report it from the link's page." : "Nothing closed yet."}
        </p>
      ) : (
        <ul className="grid gap-3">
          {data.map((r) => (
            <li key={r.id} className="grid gap-3 rounded-2xl border bg-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="font-medium">
                  {reasonLabels[r.reason] ?? r.reason}{" "}
                  <span className="font-mono text-sm font-normal text-muted-foreground">/s/{r.shareId}</span>
                </p>
                <p className="text-xs text-muted-foreground">{relativeTime(r.createdAt)}</p>
              </div>
              <p className="text-sm whitespace-pre-wrap">{r.details}</p>
              <p className="text-xs text-muted-foreground">
                {r.ownerEmail
                  ? `Shared by ${r.ownerEmail}${r.ownerReports && r.ownerReports > 1 ? ` (${r.ownerReports} reports against this account)` : ""}`
                  : "Shared without an account (quick share)"}
                {" · "}
                {r.linkLive ? "link is live" : "link is gone"}
                {r.contact ? ` · reporter: ${r.contact}` : ""}
              </p>
              {r.status === "open" ? (
                <div className="flex flex-wrap gap-2">
                  {r.reviewUrl && r.linkLive && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={r.reviewUrl} target="_blank" rel="noreferrer noopener">
                        <ExternalLinkIcon /> Open the link
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => resolve.mutate({ id: r.id, action: "remove-link" })}
                    disabled={resolve.isPending || !r.linkLive}
                  >
                    Remove link
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => resolve.mutate({ id: r.id, action: "delete-file" })}
                    disabled={resolve.isPending}
                  >
                    Delete the file
                  </Button>
                  {r.ownerId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resolve.mutate({ id: r.id, action: "suspend" })}
                      disabled={resolve.isPending}
                    >
                      Suspend account
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resolve.mutate({ id: r.id, action: "dismiss" })}
                    disabled={resolve.isPending}
                  >
                    Dismiss
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Closed {r.resolvedAt ? relativeTime(r.resolvedAt) : ""}: {r.resolution}
                </p>
              )}
              {r.status === "open" && !r.reviewUrl && (
                <p className="text-xs text-muted-foreground">
                  The reporter did not share the link's key, so its contents cannot be reviewed.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ activity

function LogTab() {
  const { data } = useQuery({
    queryKey: ["admin", "log"],
    queryFn: () => api<{ at: number; action: string; target: string; detail: string }[]>("/api/admin/log"),
  })
  if (!data) return <Loading />
  if (data.length === 0)
    return <p className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">Nothing has been done here yet.</p>
  return (
    <ul className="overflow-hidden rounded-2xl border bg-card">
      {data.map((e, i) => (
        <li key={i} className="grid gap-x-4 gap-y-0.5 border-b px-4 py-2.5 text-sm last:border-b-0 sm:grid-cols-[9rem_12rem_1fr]">
          <span className="text-xs text-muted-foreground">{relativeTime(e.at)}</span>
          <span className="font-medium capitalize">{e.action}</span>
          <span className="truncate text-muted-foreground">
            {e.target} {e.detail && e.detail !== "null" ? <span className="font-mono text-xs">{e.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}
