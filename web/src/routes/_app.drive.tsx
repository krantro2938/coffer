import { useCallback, useMemo, useRef, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  DownloadIcon,
  EyeIcon,
  FolderInputIcon,
  FolderPlusIcon,
  Link2Icon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  StickyNoteIcon,
  Trash2Icon,
  UploadCloudIcon,
  UploadIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FileGlyph } from "@/components/file-glyph"
import {
  ConfirmDialog,
  MoveDialog,
  NameDialog,
  NoteDialog,
  PreviewDialog,
  ShareDialog,
  canPreview,
  downloadItem,
} from "@/components/drive-dialogs"
import { api, getConfig } from "@/lib/api"
import { itemKeys, sealMeta, sealName, toB64 } from "@/lib/crypto"
import { useDrive, type DFolder, type DItem } from "@/lib/drive"
import { formatBytes, shortDate } from "@/lib/format"
import { useSession } from "@/lib/session"
import { storeItem } from "@/lib/transfer"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/drive")({
  validateSearch: (s: Record<string, unknown>): { folder?: string } =>
    typeof s.folder === "string" ? { folder: s.folder } : {},
  component: DrivePage,
})

type Upload = { key: string; name: string; progress: number; state: "queued" | "uploading" | "done" | "error"; error?: string }

type Dialog =
  | { t: "newFolder" }
  | { t: "note" }
  | { t: "renameFolder"; f: DFolder }
  | { t: "renameItem"; i: DItem }
  | { t: "moveFolder"; f: DFolder }
  | { t: "moveItem"; i: DItem }
  | { t: "deleteFolder"; f: DFolder }
  | { t: "deleteItem"; i: DItem }
  | null

function DrivePage() {
  const { folder: folderId = null } = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { masterKey } = useSession()
  const { data, isLoading, error } = useDrive()
  const [query, setQuery] = useState("")
  const [dialog, setDialog] = useState<Dialog>(null)
  const [preview, setPreview] = useState<DItem | null>(null)
  const [sharing, setSharing] = useState<DItem | null>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadChain = useRef(Promise.resolve())

  const refresh = () => qc.invalidateQueries({ queryKey: ["drive"] })
  const closeDialog = useCallback(() => setDialog(null), [])

  const folderMap = useMemo(() => new Map(data?.folders.map((f) => [f.id, f]) ?? []), [data])
  const current = folderId ? folderMap.get(folderId) : undefined
  const crumbs = useMemo(() => {
    const out: DFolder[] = []
    let f = current
    while (f) {
      out.unshift(f)
      f = f.parentId ? folderMap.get(f.parentId) : undefined
    }
    return out
  }, [current, folderMap])

  const q = query.trim().toLowerCase()
  const folders = useMemo(
    () =>
      (data?.folders ?? [])
        .filter((f) => (q ? f.name.toLowerCase().includes(q) : f.parentId === folderId))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data, folderId, q],
  )
  const items = useMemo(
    () => (data?.items ?? []).filter((i) => (q ? i.name.toLowerCase().includes(q) : i.folderId === folderId)),
    [data, folderId, q],
  )
  const counts = useMemo(() => {
    const m = new Map<string | null, number>()
    for (const f of data?.folders ?? []) m.set(f.parentId, (m.get(f.parentId) ?? 0) + 1)
    for (const i of data?.items ?? []) m.set(i.folderId, (m.get(i.folderId) ?? 0) + 1)
    return m
  }, [data])

  // ------------------------------------------------------------ uploads

  const enqueue = async (files: File[]) => {
    if (!masterKey || files.length === 0) return
    const config = await getConfig()
    const batch: Upload[] = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, progress: 0, state: "queued" }))
    setUploads((u) => [...u.filter((x) => x.state !== "done"), ...batch])
    const patch = (key: string, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)))

    files.forEach((file, i) => {
      const key = batch[i].key
      uploadChain.current = uploadChain.current.then(async () => {
        if (file.size > config.maxFileSize) {
          patch(key, { state: "error", error: `Larger than ${formatBytes(config.maxFileSize)}` })
          return
        }
        patch(key, { state: "uploading" })
        try {
          await storeItem({
            kind: "file",
            name: file.name,
            type: file.type,
            blob: file,
            masterKey,
            folderId,
            onProgress: (p) => patch(key, { progress: p }),
          })
          patch(key, { state: "done", progress: 1 })
          refresh()
        } catch (e) {
          patch(key, { state: "error", error: (e as Error).message })
        }
      })
    })
  }

  // ------------------------------------------------------------ mutations

  const createFolder = async (name: string) => {
    await api("/api/folders", { body: { parentId: folderId ?? undefined, encName: toB64(await sealName(masterKey!, name)) } })
    await refresh()
  }
  const renameFolder = (f: DFolder) => async (name: string) => {
    await api(`/api/folders/${f.id}`, { method: "PATCH", body: { encName: toB64(await sealName(masterKey!, name)) } })
    await refresh()
  }
  const renameItem = (i: DItem) => async (name: string) => {
    const keys = await itemKeys(i.fileKey!)
    const encMeta = toB64(await sealMeta(keys, { name, type: i.type, size: i.size, v: 1 }, i.id))
    await api(`/api/items/${i.id}`, { method: "PATCH", body: { encMeta } })
    await refresh()
  }
  const moveFolder = (f: DFolder) => async (target: string | null) => {
    await api(`/api/folders/${f.id}`, { method: "PATCH", body: { parentId: target ?? "" } })
    await refresh()
    toast.success(`Moved “${f.name}”`)
  }
  const moveItem = (i: DItem) => async (target: string | null) => {
    await api(`/api/items/${i.id}`, { method: "PATCH", body: { folderId: target ?? "" } })
    await refresh()
    toast.success(`Moved “${i.name}”`)
  }
  const del = async (path: string, label: string) => {
    try {
      await api(path, { method: "DELETE" })
      await refresh()
      toast.success(`Deleted “${label}”`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const openItem = (i: DItem) => {
    if (i.broken) return toast.error("This item can't be decrypted with your key")
    if (canPreview(i)) setPreview(i)
    else downloadItem(i)
  }

  // ------------------------------------------------------------ render

  const empty = !isLoading && folders.length === 0 && items.length === 0

  return (
    <div
      className="relative mx-auto flex min-h-full max-w-6xl flex-col px-4 py-6 sm:px-8 sm:py-8"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        enqueue(Array.from(e.dataTransfer.files))
      }}
    >
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <nav className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <Link to="/drive" search={{}} className="shrink-0 hover:text-foreground">
              My drive
            </Link>
            {crumbs.map((c) => (
              <span key={c.id} className="flex min-w-0 items-center gap-1">
                <ChevronRightIcon className="size-3.5 shrink-0" />
                <Link to="/drive" search={{ folder: c.id }} className="truncate hover:text-foreground">
                  {c.name}
                </Link>
              </span>
            ))}
          </nav>
          <h1 className="mt-1 truncate text-3xl font-medium">{q ? "Search" : (current?.name ?? "My drive")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your drive"
              className="rounded-full pl-10"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>
          <NewMenu
            onUpload={() => fileInput.current?.click()}
            onFolder={() => setDialog({ t: "newFolder" })}
            onNote={() => setDialog({ t: "note" })}
            className="hidden md:inline-flex"
          />
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          enqueue(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />

      {/* Listing */}
      <div className="mt-6 flex-1">
        {error ? (
          <p className="rounded-2xl border p-6 text-sm text-destructive">{(error as Error).message}</p>
        ) : isLoading ? (
          <div className="grid gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-2xl" />
            ))}
          </div>
        ) : empty ? (
          <EmptyState
            searching={!!q}
            onUpload={() => fileInput.current?.click()}
            onNote={() => setDialog({ t: "note" })}
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-card">
            <div className="hidden grid-cols-[1fr_7rem_8rem_2.5rem] gap-4 border-b px-4 py-2.5 text-xs text-muted-foreground md:grid">
              <span>Name</span>
              <span>Size</span>
              <span>Added</span>
              <span />
            </div>
            <ul className="divide-y">
              {folders.map((f) => (
                <Row
                  key={f.id}
                  glyph={<FileGlyph kind="folder" />}
                  name={f.name}
                  sub={`${counts.get(f.id) ?? 0} items`}
                  size="—"
                  date={shortDate(f.createdAt)}
                  onOpen={() => {
                    setQuery("")
                    navigate({ to: "/drive", search: { folder: f.id } })
                  }}
                  menu={
                    <>
                      <DropdownMenuItem onClick={() => setDialog({ t: "renameFolder", f })}>
                        <PencilIcon /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDialog({ t: "moveFolder", f })}>
                        <FolderInputIcon /> Move
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setDialog({ t: "deleteFolder", f })}>
                        <Trash2Icon /> Delete
                      </DropdownMenuItem>
                    </>
                  }
                />
              ))}
              {items.map((i) => {
                const links = data?.sharesByItem.get(i.id)?.length ?? 0
                return (
                  <Row
                    key={i.id}
                    glyph={<FileGlyph kind={i.kind} type={i.type} />}
                    name={i.name}
                    muted={i.broken}
                    sub={
                      <>
                        {i.kind === "text" ? "Note" : formatBytes(i.size)}
                        {links > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 text-primary">
                            <Link2Icon className="size-3" /> {links}
                          </span>
                        )}
                      </>
                    }
                    size={i.kind === "text" ? "Note" : formatBytes(i.size)}
                    date={shortDate(i.createdAt)}
                    links={links}
                    onOpen={() => openItem(i)}
                    onShare={i.broken ? undefined : () => setSharing(i)}
                    menu={
                      <>
                        {canPreview(i) && (
                          <DropdownMenuItem onClick={() => setPreview(i)}>
                            <EyeIcon /> Preview
                          </DropdownMenuItem>
                        )}
                        {!i.broken && (
                          <>
                            <DropdownMenuItem onClick={() => downloadItem(i)}>
                              <DownloadIcon /> Download
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setSharing(i)}>
                              <Link2Icon /> Share link
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDialog({ t: "renameItem", i })}>
                              <PencilIcon /> Rename
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem onClick={() => setDialog({ t: "moveItem", i })}>
                          <FolderInputIcon /> Move
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setDialog({ t: "deleteItem", i })}>
                          <Trash2Icon /> Delete
                        </DropdownMenuItem>
                      </>
                    }
                  />
                )
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Mobile floating action */}
      <div className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 md:hidden">
        <NewMenu
          onUpload={() => fileInput.current?.click()}
          onFolder={() => setDialog({ t: "newFolder" })}
          onNote={() => setDialog({ t: "note" })}
          fab
        />
      </div>

      {/* Drop overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="grid place-items-center gap-3 rounded-3xl border-2 border-dashed border-primary bg-card px-12 py-10 text-center shadow-soft">
            <UploadCloudIcon className="size-8 text-primary" />
            <p className="font-medium">Drop to encrypt & upload</p>
            <p className="text-sm text-muted-foreground">into {current?.name ?? "My drive"}</p>
          </div>
        </div>
      )}

      <UploadTray uploads={uploads} onClear={() => setUploads((u) => u.filter((x) => x.state === "uploading" || x.state === "queued"))} />

      {/* Dialogs */}
      <NameDialog
        open={dialog?.t === "newFolder"}
        onOpenChange={closeDialog}
        title="New folder"
        cta="Create"
        onSubmit={createFolder}
      />
      <NoteDialog open={dialog?.t === "note"} onOpenChange={closeDialog} folderId={folderId} />
      {dialog?.t === "renameFolder" && (
        <NameDialog open onOpenChange={closeDialog} title="Rename folder" initial={dialog.f.name} cta="Rename" onSubmit={renameFolder(dialog.f)} />
      )}
      {dialog?.t === "renameItem" && (
        <NameDialog open onOpenChange={closeDialog} title="Rename" initial={dialog.i.name} cta="Rename" onSubmit={renameItem(dialog.i)} />
      )}
      {dialog?.t === "moveFolder" && (
        <MoveDialog open onOpenChange={closeDialog} folders={data?.folders ?? []} exclude={dialog.f.id} onMove={moveFolder(dialog.f)} />
      )}
      {dialog?.t === "moveItem" && (
        <MoveDialog open onOpenChange={closeDialog} folders={data?.folders ?? []} onMove={moveItem(dialog.i)} />
      )}
      <ConfirmDialog
        open={dialog?.t === "deleteFolder"}
        onOpenChange={closeDialog}
        title={`Delete “${dialog?.t === "deleteFolder" ? dialog.f.name : ""}”?`}
        description="The folder, everything inside it and all their share links will be permanently destroyed."
        cta="Delete folder"
        onConfirm={() => {
          if (dialog?.t === "deleteFolder") return del(`/api/folders/${dialog.f.id}`, dialog.f.name)
        }}
      />
      <ConfirmDialog
        open={dialog?.t === "deleteItem"}
        onOpenChange={closeDialog}
        title={`Delete “${dialog?.t === "deleteItem" ? dialog.i.name : ""}”?`}
        description="The encrypted file and all of its share links will be permanently destroyed."
        cta="Delete"
        onConfirm={() => {
          if (dialog?.t === "deleteItem") return del(`/api/items/${dialog.i.id}`, dialog.i.name)
        }}
      />
      <PreviewDialog item={preview} onOpenChange={(o) => !o && setPreview(null)} />
      <ShareDialog
        item={sharing}
        shares={sharing ? (data?.sharesByItem.get(sharing.id) ?? []) : []}
        onOpenChange={(o) => !o && setSharing(null)}
      />
    </div>
  )
}

function NewMenu({
  onUpload,
  onFolder,
  onNote,
  fab,
  className,
}: {
  onUpload: () => void
  onFolder: () => void
  onNote: () => void
  fab?: boolean
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {fab ? (
          <Button size="icon-lg" className="size-14 shadow-lg" aria-label="New">
            <PlusIcon className="size-6" />
          </Button>
        ) : (
          <Button className={className}>
            <PlusIcon /> New
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={fab ? "top" : "bottom"} className="min-w-48">
        <DropdownMenuItem onClick={onUpload}>
          <UploadIcon /> Upload files
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNote}>
          <StickyNoteIcon /> New note
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onFolder}>
          <FolderPlusIcon /> New folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Row({
  glyph,
  name,
  sub,
  size,
  date,
  links,
  muted,
  onOpen,
  onShare,
  menu,
}: {
  glyph: React.ReactNode
  name: string
  sub: React.ReactNode
  size: string
  date: string
  links?: number
  muted?: boolean
  onOpen: () => void
  onShare?: () => void
  menu: React.ReactNode
}) {
  return (
    <li className="group grid grid-cols-[1fr_auto] items-center gap-2 px-2 py-1.5 transition-colors hover:bg-muted/50 md:grid-cols-[1fr_7rem_8rem_auto] md:gap-4 md:px-4">
      <button onClick={onOpen} className="flex min-w-0 items-center gap-3 rounded-xl p-1.5 text-left">
        {glyph}
        <span className="min-w-0">
          <span className={cn("block truncate text-sm font-medium", muted && "text-muted-foreground italic")}>{name}</span>
          <span className="block text-xs text-muted-foreground md:hidden">{sub}</span>
          {links ? (
            <span className="hidden items-center gap-1 text-xs text-primary md:flex">
              <Link2Icon className="size-3" /> {links} active link{links === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
      </button>
      <span className="hidden text-sm text-muted-foreground md:block">{size}</span>
      <span className="hidden text-sm text-muted-foreground md:block">{date}</span>
      <div className="flex items-center">
        {onShare && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onShare}
            className="hidden opacity-0 group-hover:opacity-100 focus-visible:opacity-100 md:inline-flex"
            aria-label="Share"
          >
            <Link2Icon />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {menu}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

function EmptyState({ searching, onUpload, onNote }: { searching: boolean; onUpload: () => void; onNote: () => void }) {
  if (searching) {
    return (
      <div className="grid place-items-center rounded-3xl border border-dashed py-20 text-center">
        <SearchIcon className="size-6 text-muted-foreground" />
        <p className="mt-3 font-medium">No matches</p>
        <p className="text-sm text-muted-foreground">Names are decrypted locally, so search stays private too.</p>
      </div>
    )
  }
  return (
    <div className="grid place-items-center rounded-3xl border border-dashed bg-card/40 px-6 py-20 text-center">
      <div className="relative">
        <span className="grid size-16 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
          <UploadCloudIcon className="size-7" />
        </span>
        <span className="absolute -top-2 -right-3 grid size-7 place-items-center rounded-lg bg-lavender-soft text-accent-foreground">
          <StickyNoteIcon className="size-3.5" />
        </span>
      </div>
      <p className="mt-6 text-lg font-medium">Nothing here yet</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Drag files anywhere on this page, or start with a note. Everything is encrypted before it leaves your device.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={onUpload}>
          <UploadIcon /> Upload files
        </Button>
        <Button variant="outline" onClick={onNote}>
          <StickyNoteIcon /> Write a note
        </Button>
      </div>
    </div>
  )
}

function UploadTray({ uploads, onClear }: { uploads: Upload[]; onClear: () => void }) {
  if (uploads.length === 0) return null
  const active = uploads.filter((u) => u.state === "uploading" || u.state === "queued").length
  return (
    <div className="fixed right-4 bottom-[calc(10rem+env(safe-area-inset-bottom))] left-4 z-30 rounded-2xl border bg-popover p-3 shadow-soft sm:left-auto sm:w-80 md:bottom-6">
      <div className="flex items-center justify-between px-1 pb-2">
        <p className="text-sm font-medium">{active ? `Encrypting ${active} file${active === 1 ? "" : "s"}…` : "Uploads complete"}</p>
        {!active && (
          <Button variant="ghost" size="icon-xs" onClick={onClear} aria-label="Dismiss">
            <XIcon />
          </Button>
        )}
      </div>
      <ul className="grid max-h-60 gap-2 overflow-y-auto">
        {uploads.map((u) => (
          <li key={u.key} className="grid gap-1.5 rounded-xl bg-muted/50 px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              {u.state === "done" ? (
                <CheckCircle2Icon className="size-4 shrink-0 text-primary" />
              ) : u.state === "error" ? (
                <XCircleIcon className="size-4 shrink-0 text-destructive" />
              ) : (
                <Loader2Icon className={cn("size-4 shrink-0 text-muted-foreground", u.state === "uploading" && "animate-spin")} />
              )}
              <span className="flex-1 truncate">{u.name}</span>
              {u.state === "uploading" && <span className="font-mono text-xs text-muted-foreground">{Math.round(u.progress * 100)}%</span>}
            </div>
            {u.state === "uploading" && <Progress value={u.progress * 100} className="h-1" />}
            {u.error && <p className="text-xs text-destructive">{u.error}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
