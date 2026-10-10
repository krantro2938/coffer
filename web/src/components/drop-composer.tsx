import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { toast } from "sonner"
import { FileUpIcon, LockIcon, PlusIcon, SparklesIcon, TextIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { FileGlyph } from "@/components/file-glyph"
import { ShareOptionsFields, defaultShareOptions, toShareOptions } from "@/components/share-options"
import { ShareResult } from "@/components/share-result"
import { canWrite, getConfig } from "@/lib/api"
import { shareFiles } from "@/lib/bundle"
import { loadDrops, pruneDrops, revokeDrop, saveDrops, type Drop } from "@/lib/drops"
import { formatBytes, relativeTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { createShare, storeItem, type CreatedShare } from "@/lib/transfer"
import { cn } from "@/lib/utils"

type Mode = "file" | "text"
type Phase = { step: "idle" } | { step: "working"; label: string; progress: number } | { step: "done"; share: CreatedShare }

const QUICK_SHARE_MAX = 7 * 86400

export function DropComposer() {
  const { status, masterKey, me } = useSession()
  const qc = useQueryClient()
  const { t, tn } = useI18n()
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity })
  // With a usable drive, shares are saved to it. Everyone else gets a quick
  // share: no account, a few small files, gone when it expires.
  const toDrive = status === "unlocked" && !!masterKey && canWrite(me)
  const needsUnlock = status === "locked" && canWrite(me)
  const anonMax = config?.anonMaxExpiry ?? 7 * 86400
  // A quick share is quick whoever makes it: a week at most. Longer-lived links are made from the drive.
  const maxExpiry = toDrive ? QUICK_SHARE_MAX : Math.min(anonMax, QUICK_SHARE_MAX)
  const maxFiles = toDrive ? 1 : (config?.anonMaxFiles ?? 5)
  const limit = toDrive ? config?.maxFileSize : config?.anonMaxShareSize

  const [mode, setMode] = useState<Mode>("file")
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState("")
  const [opts, setOpts] = useState(defaultShareOptions())
  const [phase, setPhase] = useState<Phase>({ step: "idle" })
  const [dragging, setDragging] = useState(false)
  const [drops, setDrops] = useState<Drop[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const stored = await loadDrops()
      if (!live) return
      setDrops(stored)
      const current = await pruneDrops(stored)
      if (!live || current.length === stored.length) return
      setDrops(current)
      void saveDrops(current)
    })()
    return () => {
      live = false
    }
  }, [])

  // Quick shares always expire; clamp the choice to the server maximum.
  useEffect(() => {
    if (opts.expiresIn === 0 || opts.expiresIn > maxExpiry) setOpts((o) => ({ ...o, expiresIn: 86400 }))
  }, [maxExpiry, opts.expiresIn])

  const total = files.reduce((n, f) => n + f.size, 0)
  const ready = mode === "file" ? files.length > 0 : text.trim().length > 0
  const busy = phase.step === "working"

  const add = (incoming: FileList | null | undefined) => {
    if (!incoming?.length) return
    const next = maxFiles === 1 ? [incoming[0]] : [...files, ...incoming]
    if (next.length > maxFiles) {
      toast.error(tn(maxFiles, "A share holds {n} file", "A share holds up to {n} files"))
      return
    }
    if (limit && next.reduce((n, f) => n + f.size, 0) > limit) {
      toast.error(t("That's more than {size}", { size: formatBytes(limit) }), {
        description:
          toDrive || !config ? undefined : t("A drive takes files up to {size} each.", { size: formatBytes(config.maxFileSize) }),
      })
      return
    }
    setFiles(next)
  }

  const remember = (d: Drop) => {
    const next = [d, ...drops]
    setDrops(next)
    void saveDrops(next)
  }

  const submit = async () => {
    if (!ready || busy) return
    const o = toShareOptions(opts)
    if (opts.usePassword && !o.password) {
      toast.error(t("Enter a password or turn the password option off"))
      return
    }
    const uploading = (p: number) => setPhase({ step: "working", label: p < 1 ? "Encrypting & uploading" : "Sealing link", progress: p })
    try {
      setPhase({ step: "working", label: "Encrypting & uploading", progress: 0 })
      let share: CreatedShare
      if (mode === "file" && files.length > 1) {
        const made = await shareFiles(files, o, o.expiresIn ?? 86400, uploading)
        share = made.share
        remember({
          itemId: made.itemId,
          manageToken: made.manageToken,
          shareId: share.id,
          name: t("Shared files"),
          kind: "bundle",
          files: files.length,
          expiresAt: made.expiresAt,
        })
      } else {
        const file = files[0]
        const name = mode === "file" ? file.name : t("Note {date}", { date: new Date().toLocaleString() })
        const stored = await storeItem({
          kind: mode,
          name,
          type: mode === "file" ? file.type : "text/plain",
          blob: mode === "file" ? file : new Blob([text], { type: "text/plain;charset=utf-8" }),
          masterKey: toDrive ? masterKey : undefined,
          expiresIn: toDrive ? undefined : (o.expiresIn ?? 86400),
          onProgress: uploading,
        })
        setPhase({ step: "working", label: o.password ? "Deriving password key" : "Sealing link", progress: 1 })
        share = await createShare(stored.id, stored.fileKey, o, {
          manageToken: stored.manageToken,
          masterKey: toDrive ? masterKey : null,
        })
        stored.fileKey.fill(0)
        if (stored.manageToken && stored.expiresAt) {
          remember({
            itemId: stored.id,
            manageToken: stored.manageToken,
            shareId: share.id,
            name,
            kind: mode,
            files: 1,
            expiresAt: stored.expiresAt,
          })
        }
      }
      if (toDrive) qc.invalidateQueries({ queryKey: ["drive"] })
      setPhase({ step: "done", share })
    } catch (e) {
      setPhase({ step: "idle" })
      toast.error((e as Error).message || t("Something went wrong"))
    }
  }

  const reset = () => {
    setFiles([])
    setText("")
    setOpts((o) => ({ ...o, password: "", usePassword: false }))
    setPhase({ step: "idle" })
  }

  const revoke = async (d: Drop) => {
    try {
      await revokeDrop(d)
    } catch (e) {
      toast.error((e as Error).message || t("Something went wrong"))
      return
    }
    const next = drops.filter((x) => x.itemId !== d.itemId)
    setDrops(next)
    void saveDrops(next)
    toast.success(t("Deleted from the server"))
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

  return (
    <div className="grid gap-4">
      <div className="relative rounded-[1.75rem] border bg-card/90 p-2 shadow-soft backdrop-blur-sm">
        {phase.step === "done" ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  <span className="grid size-6 place-items-center rounded-full bg-secondary text-secondary-foreground">
                    <LockIcon className="size-3.5" />
                  </span>
                  {t("Encrypted and ready to share")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {phase.share.short ? (
                    opts.usePassword ? (
                      t("Short link — the password is the key; share it separately.")
                    ) : (
                      t("Short link — anyone with the code can open it.")
                    )
                  ) : (
                    <>
                      {t("The key is in the part after")} <span className="font-mono">#</span> {t("— it never reaches our server.")}
                    </>
                  )}
                </p>
              </div>
            </div>
            <ShareResult share={phase.share} hasPassword={opts.usePassword} maxViews={opts.maxViews || null} />
            <Button variant="secondary" onClick={reset} className="w-full">
              <PlusIcon /> {t("Share something else")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2 px-2 pt-2">
              <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <TabsList>
                  <TabsTrigger value="file" disabled={busy}>
                    <FileUpIcon /> {t("File")}
                  </TabsTrigger>
                  <TabsTrigger value="text" disabled={busy}>
                    <TextIcon /> {t("Text")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <span className="hidden eyebrow sm:block">{toDrive ? t("Saved to your drive") : t("No account needed")}</span>
            </div>

            {mode === "file" ? (
              files.length > 0 ? (
                <div
                  {...dropZone}
                  className={cn(
                    "mx-2 mt-1 grid gap-1 rounded-2xl border bg-background/60 p-1.5 transition-colors",
                    dragging && "border-primary bg-secondary/60"
                  )}
                >
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-xl p-1.5">
                      <FileGlyph kind="file" type={f.type} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{f.name}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setFiles(files.filter((_, j) => j !== i))}
                        disabled={busy}
                        aria-label={t("Remove file")}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  ))}
                  {maxFiles > 1 && (
                    <div className="flex items-center justify-between gap-3 border-t px-1.5 pt-1.5 pb-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => inputRef.current?.click()}
                        disabled={busy || files.length >= maxFiles}
                      >
                        <PlusIcon /> {t("Add files")}
                      </Button>
                      <span className="truncate pr-1.5 text-xs text-muted-foreground tabular-nums">
                        {t("{count} of {max} files", { count: files.length, max: maxFiles })}
                        {limit ? <> · {t("{used} of {total}", { used: formatBytes(total), total: formatBytes(limit) })}</> : null}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  {...dropZone}
                  className={cn(
                    "group mx-2 mt-1 grid cursor-pointer place-items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors",
                    dragging ? "border-primary bg-secondary/60" : "border-border hover:border-primary/40 hover:bg-muted/50"
                  )}
                >
                  <span className="grid size-12 place-items-center rounded-2xl bg-secondary text-secondary-foreground transition-transform group-hover:-translate-y-0.5">
                    <UploadIcon className="size-5" />
                  </span>
                  <span>
                    <span className="block font-medium">
                      {maxFiles > 1 ? t("Drop files or tap to browse") : t("Drop a file or tap to browse")}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {maxFiles > 1
                        ? t("Up to {n} files · {size} in total", { n: maxFiles, size: limit ? formatBytes(limit) : "…" })
                        : t("Up to {size}", { size: limit ? formatBytes(limit) : "…" })}
                      {!toDrive && config && config.maxFileSize > config.anonMaxShareSize && (
                        <> · {t("{size} per file with a drive", { size: formatBytes(config.maxFileSize) })}</>
                      )}
                    </span>
                  </span>
                </button>
              )
            ) : (
              <div className="mx-2 mt-1 overflow-hidden rounded-2xl border border-input bg-background/60 transition-[box-shadow,border-color] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t("Paste a password, an API key, a private note…")}
                  className="max-h-80 min-h-40 resize-none [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] rounded-none border-0 bg-transparent font-mono text-sm [overflow-wrap:anywhere] focus-visible:ring-0 dark:bg-transparent"
                  disabled={busy}
                  spellCheck={false}
                />
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple={maxFiles > 1}
              onChange={(e) => {
                add(e.target.files)
                e.target.value = ""
              }}
            />

            <div className="p-2">
              <ShareOptionsFields value={opts} onChange={setOpts} maxExpiry={maxExpiry} />
            </div>

            <div className="grid gap-2 p-2 pt-0">
              {busy ? (
                <div className="grid gap-2 rounded-full border bg-muted/40 px-5 py-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <LockIcon className="size-3.5 animate-pulse" /> {t(phase.label)}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{Math.round(phase.progress * 100)}%</span>
                  </div>
                  <Progress value={phase.progress * 100} className="h-1" />
                </div>
              ) : needsUnlock ? (
                <Button size="lg" asChild className="w-full">
                  <Link to="/drive">
                    <LockIcon /> {t("Unlock your drive to share")}
                  </Link>
                </Button>
              ) : (
                <Button size="lg" onClick={submit} disabled={!ready} className="w-full">
                  <SparklesIcon /> {t("Encrypt & create link")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {drops.length > 0 && !toDrive && (
        <div className="rounded-2xl border bg-card/70 p-4 text-left">
          <p className="mb-3 eyebrow">{t("Your recent drops · this device only")}</p>
          <ul className="grid gap-2">
            {drops.slice(0, 5).map((d) => (
              <li key={d.itemId} className="flex items-center gap-3 text-sm">
                <FileGlyph kind={d.kind} className="size-8 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{d.kind === "bundle" ? tn(d.files, "{n} file", "{n} files") : d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{d.shareId}</span> · {t("expires {when}", { when: relativeTime(d.expiresAt) })}
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => revoke(d)} aria-label={t("Delete now")}>
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
