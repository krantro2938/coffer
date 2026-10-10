import { useEffect, useRef, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CheckIcon,
  InboxIcon,
  LinkIcon,
  Loader2Icon,
  LockKeyholeIcon,
  SendIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { FileGlyph } from "@/components/file-glyph"
import { SiteHeader } from "@/components/site-header"
import { ApiError } from "@/lib/api"
import { formatBytes, relativeTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { BadRequestLink, openRequest, uploadToRequest, type OpenRequest } from "@/lib/requests"
import { cn } from "@/lib/utils"

/**
 * The page behind a file request link. Anyone holding the link can send files
 * through it, without an account; nobody holding it can see what was sent.
 */
export const Route = createFileRoute("/r/$id")({ component: RequestPage })

type Gone = "missing" | "closed" | "damaged" | "error"

type State = { s: "loading" } | { s: "gone"; why: Gone; message?: string } | { s: "ready"; req: OpenRequest }

type Entry = {
  key: number
  file: File
  state: "queued" | "sending" | "sent" | "failed"
  progress: number
  error?: string
}

let nextKey = 0

function RequestPage() {
  const { id } = Route.useParams()
  const { t, tn } = useI18n()
  const [state, setState] = useState<State>({ s: "loading" })
  const [entries, setEntries] = useState<Entry[]>([])
  const [from, setFrom] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  // How many files this visit has delivered; the request's own count is not ours to see.
  const [delivered, setDelivered] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    openRequest(id, decodeURIComponent(location.hash.slice(1)))
      .then((req) => live && setState({ s: "ready", req }))
      .catch((e) => {
        if (!live) return
        if (e instanceof BadRequestLink) setState({ s: "gone", why: "damaged" })
        else if (e instanceof ApiError && e.status === 404) setState({ s: "gone", why: "missing" })
        else if (e instanceof ApiError && e.status === 410) setState({ s: "gone", why: "closed" })
        else setState({ s: "gone", why: "error", message: (e as Error).message })
      })
    return () => {
      live = false
    }
  }, [id])

  const req = state.s === "ready" ? state.req : null
  const patch = (key: number, p: Partial<Entry>) => setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...p } : e)))

  const add = (files: FileList | null) => {
    if (!files || !req) return
    const fresh: Entry[] = Array.from(files, (file) => {
      const tooBig = file.size > req.maxFileSize
      return {
        key: nextKey++,
        file,
        state: tooBig ? "failed" : "queued",
        progress: 0,
        error: tooBig ? t("Larger than the {size} this link takes per file", { size: formatBytes(req.maxFileSize) }) : undefined,
      } as Entry
    })
    setEntries((list) => [...list, ...fresh])
  }

  const queued = entries.filter((e) => e.state === "queued")
  const sent = entries.filter((e) => e.state === "sent")
  const filesLeft = req?.filesLeft === undefined ? undefined : Math.max(req.filesLeft - delivered, 0)
  const full = filesLeft === 0 || req?.bytesLeft === 0
  const overCount = filesLeft !== undefined && queued.length > filesLeft

  const send = async () => {
    if (!req || busy || queued.length === 0 || overCount) return
    setBusy(true)
    const sender = { from: from.trim() || undefined, note: note.trim() || undefined }
    for (const entry of queued) {
      patch(entry.key, { state: "sending", progress: 0 })
      try {
        await uploadToRequest(req, entry.file, sender, (p) => patch(entry.key, { progress: p }))
        patch(entry.key, { state: "sent", progress: 1 })
        setDelivered((n) => n + 1)
      } catch (e) {
        patch(entry.key, { state: "failed", error: (e as Error).message })
        // The link stopped taking files; the rest would fail the same way.
        if (e instanceof ApiError && (e.status === 410 || e.status === 404)) {
          setState({ s: "gone", why: "closed" })
          break
        }
      }
    }
    setBusy(false)
  }

  const dropZone = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(true)
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (!busy) add(e.dataTransfer.files)
    },
  }

  const allSent = entries.length > 0 && !busy && queued.length === 0 && sent.length > 0 && entries.every((e) => e.state !== "sending")

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="relative flex flex-1 items-start justify-center px-4 pt-10 pb-20 sm:items-center sm:pt-0">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute top-1/2 left-1/2 size-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--mint),transparent)] opacity-50" />
        </div>
        <div className="w-full max-w-lg min-w-0">
          <div className="min-w-0 overflow-hidden rounded-[1.75rem] border bg-card shadow-soft">
            {state.s === "loading" && (
              <div className="grid place-items-center py-16">
                <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {state.s === "gone" && <GoneCard why={state.why} message={state.message} sent={sent.length} />}

            {req && (
              <div className="grid gap-5 p-6 sm:p-8">
                <div className="grid gap-4 text-center">
                  <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
                    <InboxIcon className="size-6" />
                  </span>
                  <div className="min-w-0">
                    <h1 className="text-2xl font-medium break-words">{req.title || t("Send files securely")}</h1>
                    {req.note && <p className="mt-2 text-sm break-words whitespace-pre-wrap text-muted-foreground">{req.note}</p>}
                    <p className="mt-2 text-sm text-pretty text-muted-foreground">
                      <LockKeyholeIcon className="mr-1.5 inline size-3.5 -translate-y-px" />
                      {t("Encrypted in your browser before they leave it. Only the person who gave you this link can open them.")}
                    </p>
                  </div>
                </div>

                {allSent ? (
                  <div className="grid justify-items-center gap-3 rounded-2xl border bg-secondary/50 px-4 py-6 text-center">
                    <CheckCircle2Icon className="size-8 text-primary" />
                    <div>
                      <p className="font-medium">{tn(sent.length, "{n} file delivered", "{n} files delivered")}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("You can close this page. Nothing was kept in this browser.")}
                      </p>
                    </div>
                    {!full && (
                      <Button variant="outline" size="sm" onClick={() => setEntries([])}>
                        {t("Send more")}
                      </Button>
                    )}
                  </div>
                ) : full && queued.length === 0 ? (
                  <p className="rounded-2xl border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                    {t("This link has all the files it asked for.")}
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => input.current?.click()}
                    {...dropZone}
                    className={cn(
                      "group grid cursor-pointer place-items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors disabled:cursor-default",
                      dragging ? "border-primary bg-secondary/60" : "border-border hover:border-primary/40 hover:bg-muted/50"
                    )}
                  >
                    <span className="grid size-12 place-items-center rounded-2xl bg-secondary text-secondary-foreground transition-transform group-hover:-translate-y-0.5">
                      <UploadIcon className="size-5" />
                    </span>
                    <span>
                      <span className="block font-medium">{t("Drop files or tap to browse")}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {t("Up to {size} per file", { size: formatBytes(req.maxFileSize) })}
                        {filesLeft !== undefined && <> · {tn(filesLeft, "{n} more file", "{n} more files")}</>}
                        {req.bytesLeft !== undefined && <> · {t("{size} in all", { size: formatBytes(req.bytesLeft) })}</>}
                      </span>
                    </span>
                  </button>
                )}
                <input
                  ref={input}
                  type="file"
                  hidden
                  multiple
                  onChange={(e) => {
                    add(e.target.files)
                    e.target.value = ""
                  }}
                />

                {entries.length > 0 && (
                  <ul className="grid max-h-[40vh] gap-1 overflow-y-auto">
                    {entries.map((e) => (
                      <li key={e.key} className="flex min-w-0 items-center gap-3 rounded-xl px-1 py-1.5">
                        <FileGlyph kind="file" type={e.file.type} className="size-9 rounded-lg" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm" title={e.file.name}>
                            {e.file.name}
                          </p>
                          {e.state === "sending" ? (
                            <Progress value={e.progress * 100} className="mt-1.5 h-1" />
                          ) : (
                            <p className={cn("truncate text-xs text-muted-foreground", e.state === "failed" && "text-destructive")}>
                              {e.state === "failed" ? e.error : formatBytes(e.file.size)}
                            </p>
                          )}
                        </div>
                        {e.state === "sent" && <CheckIcon className="size-4 shrink-0 text-primary" aria-label={t("Sent")} />}
                        {e.state === "sending" && <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />}
                        {e.state === "failed" && <AlertCircleIcon className="size-4 shrink-0 text-destructive" />}
                        {(e.state === "queued" || e.state === "failed") && !busy && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setEntries((list) => list.filter((x) => x.key !== e.key))}
                            aria-label={t("Remove {name}", { name: e.file.name })}
                          >
                            <XIcon />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {!allSent && queued.length > 0 && (
                  <>
                    <div className="grid gap-2">
                      <Input
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        placeholder={t("Your name (optional)")}
                        maxLength={80}
                        disabled={busy}
                        autoComplete="name"
                      />
                      <Textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t("A message to go with them (optional)")}
                        maxLength={500}
                        disabled={busy}
                        className="max-h-32"
                      />
                      <p className="text-xs text-muted-foreground">{t("Both are encrypted along with the files.")}</p>
                    </div>
                    {overCount && (
                      <p className="text-sm text-destructive">
                        {tn(filesLeft ?? 0, "This link takes {n} more file. Remove some.", "This link takes {n} more files. Remove some.")}
                      </p>
                    )}
                    <Button size="lg" onClick={send} disabled={busy || overCount} className="w-full">
                      {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                      {busy ? t("Encrypting and sending") : tn(queued.length, "Send {n} file", "Send {n} files")}
                    </Button>
                  </>
                )}

                <p className="text-center text-xs text-muted-foreground">
                  {t("No account needed.")}
                  {req.expiresAt ? ` ${t("This link closes {when}.", { when: relativeTime(req.expiresAt) })}` : ""}
                </p>
              </div>
            )}
          </div>
          {req && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              <Link to="/security" className="underline underline-offset-2 hover:text-foreground">
                {t("How the encryption works")}
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

function GoneCard({ why, message, sent }: { why: Gone; message?: string; sent: number }) {
  const { t, tn } = useI18n()
  const copy: Record<Gone, { title: string; body: string }> = {
    missing: {
      title: t("This upload link doesn't exist"),
      body: t("Check that you copied all of it, or ask whoever sent it for a new one."),
    },
    closed: {
      title: t("This upload link is closed"),
      body: t("It has expired, or the person who made it stopped taking files. Ask them for a new one."),
    },
    damaged: {
      title: t("This upload link is incomplete"),
      body: t("The part after the # is its key, and it is missing or damaged. Copy the whole link and open it again."),
    },
    error: { title: t("This page couldn't load"), body: message ?? t("Check your connection and try again.") },
  }
  return (
    <div className="grid gap-4 p-6 text-center sm:p-8">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-coral-soft">
        <LinkIcon className="size-6 text-coral" />
      </span>
      <h1 className="text-2xl font-medium">{copy[why].title}</h1>
      <p className="text-sm text-muted-foreground">{copy[why].body}</p>
      {sent > 0 && (
        <p className="text-sm font-medium">{tn(sent, "{n} file was delivered before that.", "{n} files were delivered before that.")}</p>
      )}
      <Button asChild variant="secondary" className="mx-auto mt-2">
        <Link to="/">{t("About Coffer")}</Link>
      </Button>
    </div>
  )
}
