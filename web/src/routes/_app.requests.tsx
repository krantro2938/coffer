import { useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CheckIcon,
  CopyIcon,
  FilesIcon,
  FolderIcon,
  HardDriveIcon,
  InboxIcon,
  Loader2Icon,
  PlusIcon,
  Share2Icon,
  TimerIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react"
import { OptionPicker } from "@/components/option-picker"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useCopy } from "@/hooks/use-copy"
import { api, canWrite } from "@/lib/api"
import { useDrive } from "@/lib/drive"
import { EXPIRY_OPTIONS, formatBytes, relativeTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { createRequest, requestStatus, type DRequest, type RequestStatus } from "@/lib/requests"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/requests")({ component: RequestsPage })

const MB = 1024 ** 2
const GB = 1024 ** 3

const FILE_COUNT_OPTIONS = [
  { label: "Any number", hint: "Until it expires or you close it", value: 0 },
  { label: "1 file", hint: "A single document", value: 1 },
  { label: "10 files", hint: "A small set", value: 10 },
  { label: "100 files", hint: "A whole project", value: 100 },
] as const

const FILE_SIZE_OPTIONS = [
  { label: "Server limit", hint: "As large as this server takes", value: 0 },
  { label: "10 MB", hint: "Documents and photos", value: 10 * MB },
  { label: "100 MB", hint: "Scans and recordings", value: 100 * MB },
  { label: "1 GB", hint: "Video and archives", value: GB },
] as const

const TOTAL_OPTIONS = [
  { label: "Whatever fits", hint: "Bounded by the space in your drive", value: 0 },
  { label: "100 MB", hint: "", value: 100 * MB },
  { label: "1 GB", hint: "", value: GB },
  { label: "10 GB", hint: "", value: 10 * GB },
] as const

function RequestsPage() {
  const { data, isLoading } = useDrive()
  const { me } = useSession()
  const { t } = useI18n()
  const [creating, setCreating] = useState(false)
  // The requests behind folder links that take files are managed with those links.
  const requests = (data?.requests ?? []).filter((r) => !r.shareId)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{t("Upload links")}</p>
          <h1 className="mt-1 text-3xl font-medium">{t("File requests")}</h1>
        </div>
        <Button onClick={() => setCreating(true)} disabled={!canWrite(me)}>
          <PlusIcon /> {t("New request")}
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {t(
          "Need someone to send you a file? Give them an upload link. They need no account, their files are encrypted in their browser, and only you can open them."
        )}
      </p>

      <div className="mt-6">
        {isLoading ? (
          <div className="grid gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : requests.length > 0 ? (
          <ul className="grid gap-2">
            {requests.map((r) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </ul>
        ) : (
          <div className="grid place-items-center rounded-3xl border border-dashed bg-card/40 px-6 py-16 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
              <InboxIcon className="size-6" />
            </span>
            <p className="mt-5 font-medium">{t("No file requests yet")}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {t("Make one and send its link to whoever has the files. What they upload lands in a folder of its own in your drive.")}
            </p>
            <Button className="mt-6" onClick={() => setCreating(true)} disabled={!canWrite(me)}>
              <PlusIcon /> {t("New request")}
            </Button>
          </div>
        )}
      </div>

      <NewRequestDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

const statusStyle: Record<RequestStatus, string> = {
  open: "bg-secondary text-secondary-foreground",
  full: "bg-lavender-soft text-accent-foreground",
  expired: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
}

const statusLabel: Record<RequestStatus, string> = { open: "Taking files", full: "Full", expired: "Expired", closed: "Closed" }

function RequestCard({ request: r }: { request: DRequest }) {
  const { t, tn } = useI18n()
  const { copy, copied } = useCopy()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const status = requestStatus(r)
  const live = status === "open" || status === "full"

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(done)
      await qc.invalidateQueries({ queryKey: ["drive"] })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
          <InboxIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-medium", r.broken && "text-muted-foreground")} title={r.title}>
            {r.broken ? t("Can't be decrypted") : r.title || t("Untitled request")}
          </p>
          <p className="text-sm text-muted-foreground">
            {tn(r.received, "{n} file received", "{n} files received")}
            {r.maxFiles !== null ? ` ${t("of {n}", { n: r.maxFiles })}` : ""} · {formatBytes(r.bytes)}
            {r.maxBytes !== null ? ` ${t("of {size}", { size: formatBytes(r.maxBytes) })}` : ""}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", statusStyle[status])}>{t(statusLabel[status])}</span>
      </div>

      {r.note && <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">{r.note}</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {status === "closed"
            ? t("Closed {when}", { when: relativeTime(r.revokedAt!) })
            : r.expiresAt
              ? status === "expired"
                ? t("Expired {when}", { when: relativeTime(r.expiresAt) })
                : t("Expires {when}", { when: relativeTime(r.expiresAt) })
              : t("Never expires")}
        </span>
        {r.maxFileSize !== null && <span>{t("Up to {size} per file", { size: formatBytes(r.maxFileSize) })}</span>}
      </div>

      {live && r.url && (
        <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-muted/40 p-1.5 pl-3.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]" title={r.url}>
            {r.url}
          </code>
          <Button size="sm" onClick={() => copy(r.url!, t("Link copied"))} className="shrink-0">
            {copied === r.url ? <CheckIcon /> : <CopyIcon />}
            {t("Copy")}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {r.folderId && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/drive" search={{ folder: r.folderId }}>
              <FolderIcon /> {t("Open folder")}
            </Link>
          </Button>
        )}
        {live && r.url && typeof navigator !== "undefined" && "share" in navigator && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigator.share({ title: r.title || t("Send me files securely"), url: r.url! }).catch(() => {})}
          >
            <Share2Icon /> {t("Share")}
          </Button>
        )}
        {live ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => act(() => api(`/api/requests/${r.id}/revoke`, { method: "POST" }), t("Closed: the link takes no more files"))}
          >
            <XCircleIcon /> {t("Stop taking files")}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => act(() => api(`/api/requests/${r.id}`, { method: "DELETE" }), t("Removed. Its files are still in your drive"))}
          >
            <Trash2Icon /> {t("Remove from this list")}
          </Button>
        )}
      </div>
    </li>
  )
}

function NewRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n()
  const { masterKey } = useSession()
  const { copy, copied } = useCopy()
  const qc = useQueryClient()
  const [title, setTitle] = useState("")
  const [note, setNote] = useState("")
  const [expiresIn, setExpiresIn] = useState(7 * 86400)
  const [maxFiles, setMaxFiles] = useState(0)
  const [maxFileSize, setMaxFileSize] = useState(0)
  const [maxBytes, setMaxBytes] = useState(0)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(null)

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      // Start clean next time, once the closing animation is over.
      setTimeout(() => {
        setTitle("")
        setNote("")
        setUrl(null)
      }, 300)
    }
  }

  const create = async () => {
    if (!masterKey || busy) return
    setBusy(true)
    try {
      const made = await createRequest(masterKey, {
        title: title.trim(),
        note: note.trim(),
        expiresIn: expiresIn || null,
        maxFiles: maxFiles || null,
        maxFileSize: maxFileSize || null,
        maxBytes: maxBytes || null,
      })
      setUrl(made.url)
      await qc.invalidateQueries({ queryKey: ["drive"] })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (url) {
    return (
      <ResponsiveDialog
        open={open}
        onOpenChange={close}
        title={t("Your upload link is ready")}
        description={t("Send it to whoever has the files. Anyone with the link can upload; nobody with it can see what was uploaded.")}
        footer={<Button onClick={() => close(false)}>{t("Done")}</Button>}
      >
        <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-card p-1.5 pl-3.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]" title={url}>
            {url}
          </code>
          <Button size="sm" onClick={() => copy(url, t("Link copied"))} className="shrink-0">
            {copied === url ? <CheckIcon /> : <CopyIcon />}
            {t("Copy")}
          </Button>
        </div>
      </ResponsiveDialog>
    )
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={close}
      title={t("Request files")}
      description={t("Whoever opens the link sees the title and note, then picks files to send you.")}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button onClick={create} disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />}
            {t("Create link")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="request-title">{t("Title")}</Label>
          <Input
            id="request-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("Upload your documents")}
            maxLength={120}
            autoFocus
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="request-note">{t("Note (optional)")}</Label>
          <Textarea
            id="request-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("What you need, and by when")}
            maxLength={1000}
            className="max-h-32"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <OptionPicker label="Expires" icon={TimerIcon} value={expiresIn} options={EXPIRY_OPTIONS} onChange={setExpiresIn} />
          <OptionPicker label="Files" icon={FilesIcon} value={maxFiles} options={FILE_COUNT_OPTIONS} onChange={setMaxFiles} />
          <OptionPicker label="Per file" icon={FolderIcon} value={maxFileSize} options={FILE_SIZE_OPTIONS} onChange={setMaxFileSize} />
          <OptionPicker label="In all" icon={HardDriveIcon} value={maxBytes} options={TOTAL_OPTIONS} onChange={setMaxBytes} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("The title and note are encrypted with the link's key. What comes in counts against the space in your drive.")}
        </p>
      </div>
    </ResponsiveDialog>
  )
}
