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
import { api, getConfig } from "@/lib/api"
import { formatBytes, relativeTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { createShare, storeItem, type CreatedShare } from "@/lib/transfer"
import { cn } from "@/lib/utils"

type Mode = "file" | "text"
type Phase = { step: "idle" } | { step: "working"; label: string; progress: number } | { step: "done"; share: CreatedShare }

type Drop = { itemId: string; manageToken: string; shareId: string; name: string; kind: Mode; expiresAt: number }
const DROPS_KEY = "coffer-drops"

function loadDrops(): Drop[] {
  try {
    const all = JSON.parse(localStorage.getItem(DROPS_KEY) ?? "[]") as Drop[]
    return all.filter((d) => d.expiresAt > Date.now() / 1000)
  } catch {
    return []
  }
}

function saveDrops(d: Drop[]) {
  try {
    localStorage.setItem(DROPS_KEY, JSON.stringify(d.slice(0, 20)))
  } catch {
    /* storage unavailable */
  }
}

export function DropComposer() {
  const { status, masterKey } = useSession()
  const qc = useQueryClient()
  const { t } = useI18n()
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity })
  const signedIn = status === "unlocked" && masterKey
  const anonMax = config?.anonMaxExpiry ?? 7 * 86400

  const [mode, setMode] = useState<Mode>("file")
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState("")
  const [opts, setOpts] = useState(defaultShareOptions())
  const [phase, setPhase] = useState<Phase>({ step: "idle" })
  const [dragging, setDragging] = useState(false)
  const [drops, setDrops] = useState<Drop[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setDrops(loadDrops()), [])

  // Anonymous drops always expire; clamp the choice to the server maximum.
  useEffect(() => {
    if (!signedIn && (opts.expiresIn === 0 || opts.expiresIn > anonMax)) setOpts((o) => ({ ...o, expiresIn: 86400 }))
  }, [signedIn, anonMax, opts.expiresIn])

  const limit = signedIn ? config?.maxFileSize : config?.anonMaxFileSize
  const ready = mode === "file" ? !!file : text.trim().length > 0
  const busy = phase.step === "working"

  const pick = (f: File | undefined | null) => {
    if (!f) return
    if (limit && f.size > limit) {
      toast.error(t("That file is larger than {size}", { size: formatBytes(limit) }), {
        description: signedIn ? undefined : t("Create a free drive to share bigger files."),
      })
      return
    }
    setFile(f)
  }

  const submit = async () => {
    if (!ready || busy) return
    if (status === "locked") {
      toast.info(t("Unlock your drive first"), { description: t("You're signed in, so drops are saved to your drive.") })
      return
    }
    const o = toShareOptions(opts)
    if (opts.usePassword && !o.password) {
      toast.error(t("Enter a password or turn the password option off"))
      return
    }
    try {
      const blob = mode === "file" ? file! : new Blob([text], { type: "text/plain;charset=utf-8" })
      const name = mode === "file" ? file!.name : t("Note {date}", { date: new Date().toLocaleString() })
      setPhase({ step: "working", label: "Encrypting & uploading", progress: 0 })
      const stored = await storeItem({
        kind: mode,
        name,
        type: mode === "file" ? file!.type : "text/plain",
        blob,
        masterKey: signedIn ? masterKey : undefined,
        expiresIn: signedIn ? undefined : o.expiresIn ?? 86400,
        onProgress: (p) => setPhase({ step: "working", label: p < 1 ? "Encrypting & uploading" : "Sealing link", progress: p }),
      })
      setPhase({ step: "working", label: o.password ? "Deriving password key" : "Sealing link", progress: 1 })
      const share = await createShare(stored.id, stored.fileKey, o, {
        manageToken: stored.manageToken,
        masterKey: signedIn ? masterKey : null,
      })
      stored.fileKey.fill(0)
      if (stored.manageToken && stored.expiresAt) {
        const next = [
          { itemId: stored.id, manageToken: stored.manageToken, shareId: share.id, name, kind: mode, expiresAt: stored.expiresAt },
          ...drops,
        ]
        setDrops(next)
        saveDrops(next)
      }
      if (signedIn) qc.invalidateQueries({ queryKey: ["drive"] })
      setPhase({ step: "done", share })
    } catch (e) {
      setPhase({ step: "idle" })
      toast.error((e as Error).message || t("Something went wrong"))
    }
  }

  const reset = () => {
    setFile(null)
    setText("")
    setOpts((o) => ({ ...o, password: "", usePassword: false }))
    setPhase({ step: "idle" })
  }

  const revoke = async (d: Drop) => {
    try {
      await api(`/api/items/${d.itemId}`, { method: "DELETE", headers: { "X-Manage-Token": d.manageToken } })
    } catch {
      /* already gone */
    }
    const next = drops.filter((x) => x.itemId !== d.itemId)
    setDrops(next)
    saveDrops(next)
    toast.success(t("Deleted from the server"))
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
                      {t("The key is in the part after")} <span className="font-mono">#</span>{" "}
                      {t("— it never reaches our server.")}
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
              <span className="eyebrow hidden sm:block">{signedIn ? t("Saved to your drive") : t("No account needed")}</span>
            </div>

            {mode === "file" ? (
              file ? (
                <div className="mx-2 mt-1 flex items-center gap-3 rounded-2xl border bg-background/60 p-3">
                  <FileGlyph kind="file" type={file.type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={() => setFile(null)} disabled={busy} aria-label={t("Remove file")}>
                    <XIcon />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    pick(e.dataTransfer.files[0])
                  }}
                  className={cn(
                    "group mx-2 mt-1 grid cursor-pointer place-items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors",
                    dragging ? "border-primary bg-secondary/60" : "border-border hover:border-primary/40 hover:bg-muted/50",
                  )}
                >
                  <span className="grid size-12 place-items-center rounded-2xl bg-secondary text-secondary-foreground transition-transform group-hover:-translate-y-0.5">
                    <UploadIcon className="size-5" />
                  </span>
                  <span>
                    <span className="block font-medium">{t("Drop a file or tap to browse")}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {t("Up to {size}", { size: limit ? formatBytes(limit) : "…" })}
                      {!signedIn && config && config.maxFileSize > config.anonMaxFileSize && (
                        <> · {t("{size} with a drive", { size: formatBytes(config.maxFileSize) })}</>
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
                  className="max-h-80 min-h-40 resize-none rounded-none border-0 bg-transparent font-mono text-sm [overflow-wrap:anywhere] [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] focus-visible:ring-0 dark:bg-transparent"
                  disabled={busy}
                  spellCheck={false}
                />
              </div>
            )}
            <input ref={inputRef} type="file" hidden onChange={(e) => pick(e.target.files?.[0])} />

            <div className="p-2">
              <ShareOptionsFields value={opts} onChange={setOpts} maxExpiry={signedIn ? undefined : anonMax} />
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
              ) : status === "locked" ? (
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

      {drops.length > 0 && !signedIn && (
        <div className="rounded-2xl border bg-card/70 p-4 text-left">
          <p className="eyebrow mb-3">{t("Your recent drops · this device only")}</p>
          <ul className="grid gap-2">
            {drops.slice(0, 5).map((d) => (
              <li key={d.itemId} className="flex items-center gap-3 text-sm">
                <FileGlyph kind={d.kind} className="size-8 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{d.name}</p>
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
