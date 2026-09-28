import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FlameIcon,
  FolderIcon,
  HardDriveIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { ShareOptionsFields, defaultShareOptions, toShareOptions } from "@/components/share-options"
import { ShareResult } from "@/components/share-result"
import { FileGlyph } from "@/components/file-glyph"
import { api } from "@/lib/api"
import type { DFolder, DItem, DShare, Drive } from "@/lib/drive"
import { collectFolder, shareFolder } from "@/lib/bundle"
import { formatBytes, relativeTime } from "@/lib/format"
import { useSession } from "@/lib/session"
import { createShare, downloadToBlob, saveDecrypted, storeItem, type CreatedShare } from "@/lib/transfer"
import { useCopy } from "@/hooks/use-copy"
import { cn } from "@/lib/utils"

// ------------------------------------------------------------------ helpers

export function itemBlobOpts(item: DItem) {
  return {
    url: `/api/items/${item.id}/blob`,
    fileKey: item.fileKey!,
    chunkSize: item.row.chunkSize,
    chunkCount: item.row.chunkCount,
    size: item.row.size,
    name: item.name,
    type: item.type,
  }
}

export async function downloadItem(item: DItem) {
  const t = toast.loading(`Decrypting ${item.name}…`)
  try {
    await saveDecrypted({
      ...itemBlobOpts(item),
      onProgress: (p) => toast.loading(`Decrypting ${item.name}… ${Math.round(p * 100)}%`, { id: t }),
    })
    toast.success("Download ready", { id: t })
  } catch (e) {
    toast.error((e as Error).message, { id: t })
  }
}

// --------------------------------------------------------------- name dialog

export function NameDialog({
  open,
  onOpenChange,
  title,
  initial = "",
  cta,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  initial?: string
  cta: string
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setName(initial)
  }, [open, initial])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSubmit(name.trim())
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title}>
      <form onSubmit={submit} className="grid gap-4">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={255} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy && <Loader2Icon className="animate-spin" />} {cta}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  )
}

// --------------------------------------------------------------- move dialog

export function MoveDialog({
  open,
  onOpenChange,
  folders,
  exclude,
  onMove,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  folders: DFolder[]
  /** A folder being moved: it and its descendants are not valid targets. */
  exclude?: string
  onMove: (folderId: string | null) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const tree = useMemo(() => {
    const children = new Map<string | null, DFolder[]>()
    for (const f of folders) children.set(f.parentId, [...(children.get(f.parentId) ?? []), f])
    const out: { f: DFolder; depth: number }[] = []
    const walk = (parent: string | null, depth: number) => {
      for (const f of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
        if (f.id === exclude) continue
        out.push({ f, depth })
        walk(f.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [folders, exclude])

  const move = async (id: string | null) => {
    setBusy(true)
    try {
      await onMove(id)
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const Row = ({ id, name, depth, icon: Icon }: { id: string | null; name: string; depth: number; icon: typeof FolderIcon }) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => move(id)}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
      style={{ paddingLeft: `${0.75 + depth * 1.1}rem` }}
    >
      <Icon className="size-4 text-muted-foreground" />
      <span className="flex-1 truncate">{name}</span>
      <ChevronRightIcon className="size-4 text-muted-foreground/50" />
    </button>
  )

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Move to…">
      <div className="-mx-2 grid max-h-[50vh] gap-0.5 overflow-y-auto">
        <Row id={null} name="My drive" depth={0} icon={HardDriveIcon} />
        {tree.map(({ f, depth }) => (
          <Row key={f.id} id={f.id} name={f.name} depth={depth + 1} icon={FolderIcon} />
        ))}
      </div>
    </ResponsiveDialog>
  )
}

// -------------------------------------------------------------- note dialog

export function NoteDialog({
  open,
  onOpenChange,
  folderId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  folderId: string | null
}) {
  const { masterKey } = useSession()
  const qc = useQueryClient()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setTitle("")
      setBody("")
    }
  }, [open])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim() || !masterKey) return
    setBusy(true)
    try {
      await storeItem({
        kind: "text",
        name: title.trim() || `Note ${new Date().toLocaleString()}`,
        type: "text/plain",
        blob: new Blob([body], { type: "text/plain;charset=utf-8" }),
        masterKey,
        folderId,
      })
      await qc.invalidateQueries({ queryKey: ["drive"] })
      toast.success("Note encrypted and saved")
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="New private note" className="sm:max-w-lg">
      <form onSubmit={save} className="grid gap-3">
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <Textarea
          placeholder="Anything you want to keep private…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="max-h-[45vh] min-h-48 font-mono text-sm"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !body.trim()}>
            {busy && <Loader2Icon className="animate-spin" />} Encrypt & save
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  )
}

// ----------------------------------------------------------- preview dialog

const PREVIEWABLE = /^(image\/|video\/|audio\/|text\/|application\/json)/
export const canPreview = (item: DItem) =>
  !item.broken && (item.kind === "text" || (PREVIEWABLE.test(item.type) && item.size < 50 * 1024 * 1024))

export function PreviewDialog({ item, onOpenChange }: { item: DItem | null; onOpenChange: (o: boolean) => void }) {
  const [state, setState] = useState<{ url?: string; text?: string; progress: number } | null>(null)
  const { copy, copied } = useCopy()

  useEffect(() => {
    if (!item) return
    let url: string | undefined
    let cancelled = false
    setState({ progress: 0 })
    downloadToBlob({ ...itemBlobOpts(item), onProgress: (p) => !cancelled && setState({ progress: p }) })
      .then(async (blob) => {
        if (cancelled) return
        if (item.kind === "text" || item.type.startsWith("text/") || item.type === "application/json") {
          setState({ text: await blob.text(), progress: 1 })
        } else {
          url = URL.createObjectURL(blob)
          setState({ url, progress: 1 })
        }
      })
      .catch((e) => {
        toast.error((e as Error).message)
        onOpenChange(false)
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [item, onOpenChange])

  if (!item) return null
  return (
    <ResponsiveDialog
      open={!!item}
      onOpenChange={onOpenChange}
      title={<span className="block truncate pr-6">{item.name}</span>}
      description={`${formatBytes(item.size)} · added ${relativeTime(item.createdAt)}`}
      className="sm:max-w-3xl"
    >
      <div className="grid gap-4">
        {!state || (state.url === undefined && state.text === undefined) ? (
          <div className="grid h-64 place-items-center rounded-2xl bg-muted/50">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Decrypting… {Math.round((state?.progress ?? 0) * 100)}%
            </span>
          </div>
        ) : state.text !== undefined ? (
          <pre className="max-h-[60vh] overflow-auto rounded-2xl border bg-muted/40 p-4 font-mono text-sm break-words whitespace-pre-wrap">
            {state.text}
          </pre>
        ) : item.type.startsWith("image/") ? (
          <img src={state.url} alt={item.name} className="max-h-[65vh] w-full rounded-2xl bg-muted object-contain" />
        ) : item.type.startsWith("video/") ? (
          <video src={state.url} controls autoPlay className="max-h-[65vh] w-full rounded-2xl bg-black" />
        ) : (
          <audio src={state.url} controls autoPlay className="w-full" />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {state?.text !== undefined && (
            <Button variant="outline" onClick={() => copy(state.text!, "Copied")}>
              {copied === state.text ? <CheckIcon /> : <CopyIcon />} Copy
            </Button>
          )}
          <Button onClick={() => downloadItem(item)}>
            <DownloadIcon /> Download
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  )
}

// ------------------------------------------------------------- share dialog

export type ShareTarget = { type: "item"; item: DItem } | { type: "folder"; folder: DFolder }

export function ShareDialog({
  target,
  drive,
  onOpenChange,
}: {
  target: ShareTarget | null
  drive: Drive | undefined
  onOpenChange: (o: boolean) => void
}) {
  const { masterKey } = useSession()
  const qc = useQueryClient()
  const [opts, setOpts] = useState(defaultShareOptions(7 * 86400))
  const [created, setCreated] = useState<CreatedShare | null>(null)
  const [creating, setCreating] = useState(false)
  const [composing, setComposing] = useState(false)
  const key = target ? (target.type === "item" ? target.item.id : target.folder.id) : null

  useEffect(() => {
    setCreated(null)
    setOpts(defaultShareOptions(7 * 86400))
    setComposing(false)
  }, [key])

  if (!target) return null
  const isFolder = target.type === "folder"
  const name = isFolder ? target.folder.name : target.item.name
  const shares = (isFolder ? drive?.sharesByFolder.get(target.folder.id) : drive?.sharesByItem.get(target.item.id)) ?? []
  const fileCount = isFolder && drive ? collectFolder(drive, target.folder).length : 0
  const showForm = composing || shares.length === 0

  const create = async () => {
    const o = toShareOptions(opts)
    if (opts.usePassword && !o.password) return toast.error("Enter a password or turn the option off")
    setCreating(true)
    try {
      const s = isFolder
        ? await shareFolder(drive!, target.folder, o, masterKey!)
        : await createShare(target.item.id, target.item.fileKey!, o, { masterKey })
      setCreated(s)
      setComposing(false)
      qc.invalidateQueries({ queryKey: ["drive"] })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <ResponsiveDialog
      open={!!target}
      onOpenChange={onOpenChange}
      title={
        <span className="flex min-w-0 items-center gap-3 pr-6">
          {isFolder ? (
            <FileGlyph kind="folder" className="size-9 rounded-lg" />
          ) : (
            <FileGlyph kind={target.item.kind} type={target.item.type} className="size-9 rounded-lg" />
          )}
          <span className="min-w-0">
            <span className="block text-xs font-normal text-muted-foreground">
              {isFolder ? `Share folder · ${fileCount} file${fileCount === 1 ? "" : "s"}` : "Share file"}
            </span>
            <span className="block truncate">{name}</span>
          </span>
        </span>
      }
      className="sm:max-w-lg"
    >
      <div className="grid gap-5">
        {created ? (
          <>
            <ShareResult share={created} hasPassword={opts.usePassword} maxViews={opts.maxViews || null} />
            <Button variant="secondary" onClick={() => setCreated(null)}>
              Done
            </Button>
          </>
        ) : showForm ? (
          <>
            {isFolder && (
              <p className="rounded-xl bg-muted/50 px-3.5 py-2.5 text-xs text-muted-foreground">
                Shares a snapshot of the folder as it is now, including subfolders. Files you add later need a new link;
                files you delete disappear from it.
              </p>
            )}
            <ShareOptionsFields value={opts} onChange={setOpts} />
            <div className="flex justify-end gap-2">
              {shares.length > 0 && (
                <Button variant="ghost" onClick={() => setComposing(false)}>
                  Back
                </Button>
              )}
              <Button onClick={create} disabled={creating || (isFolder && fileCount === 0)}>
                {creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Create link
              </Button>
            </div>
          </>
        ) : (
          <>
            <ShareList shares={shares} />
            <Button variant="secondary" onClick={() => setComposing(true)}>
              <PlusIcon /> New link
            </Button>
          </>
        )}
      </div>
    </ResponsiveDialog>
  )
}

export function ShareList({ shares, names }: { shares: DShare[]; names?: Map<string, DItem> }) {
  const qc = useQueryClient()
  const { copy, copied } = useCopy()
  const [revoking, setRevoking] = useState<DShare | null>(null)

  const revoke = async (s: DShare) => {
    try {
      await api(`/api/shares/${s.id}`, { method: "DELETE" })
      await qc.invalidateQueries({ queryKey: ["drive"] })
      toast.success("Link revoked — it can no longer be opened")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <ul className="grid gap-2">
        {shares.map((s) => {
          const item = names?.get(s.itemId)
          return (
            <li key={s.id} className="flex items-center gap-3 rounded-2xl border bg-card p-3">
              {item && <FileGlyph kind={item.kind} type={item.type} className="size-9 rounded-lg" />}
              <div className="min-w-0 flex-1">
                {item && <p className="truncate text-sm font-medium">{item.name}</p>}
                <p className={cn("font-mono text-sm", item && "text-xs text-muted-foreground")}>
                  /s/<span className="font-semibold text-foreground">{s.id}</span>
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Chip>{s.expiresAt ? `expires ${relativeTime(s.expiresAt)}` : "no expiry"}</Chip>
                  <Chip tone={s.maxViews === 1 ? "coral" : undefined}>
                    {s.maxViews === 1 ? (
                      <>
                        <FlameIcon className="size-3" /> one view
                      </>
                    ) : (
                      `${s.views}${s.maxViews ? ` / ${s.maxViews}` : ""} views`
                    )}
                  </Chip>
                  {s.hasPassword && (
                    <Chip tone="lavender">
                      <KeyRoundIcon className="size-3" /> password
                    </Chip>
                  )}
                </div>
              </div>
              {s.url && (
                <Button variant="ghost" size="icon-sm" onClick={() => copy(s.url!, "Link copied")} aria-label="Copy link">
                  {copied === s.url ? <CheckIcon /> : <CopyIcon />}
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" onClick={() => setRevoking(s)} aria-label="Revoke link">
                <Trash2Icon />
              </Button>
            </li>
          )
        })}
      </ul>
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this link?"
        description="Anyone holding it will no longer be able to open it. The file stays in your drive."
        cta="Revoke link"
        onConfirm={() => revoke(revoking!)}
      />
    </>
  )
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "coral" | "lavender" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem]",
        tone === "coral" ? "bg-coral-soft" : tone === "lavender" ? "bg-lavender-soft text-accent-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

// ----------------------------------------------------------- confirm dialog

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cta,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: string
  cta: string
  onConfirm: () => Promise<void> | void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void onConfirm()}>
            {cta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
