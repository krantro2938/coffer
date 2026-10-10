import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FlameIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockKeyholeIcon,
  LockKeyholeOpenIcon,
  ShieldCheckIcon,
  UploadIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { FileGlyph } from "@/components/file-glyph"
import { SiteHeader } from "@/components/site-header"
import { api, ApiError, type AddedItem, type ShareInfo, type ShareOpen } from "@/lib/api"
import {
  b32decode,
  fromB64,
  itemKeys,
  normalizeCode,
  openMeta,
  shareKeys,
  stretch,
  toB64,
  unwrapFromShare,
  unwrapShareKey,
  SHARE_SECRET_BYTES,
  type ItemMeta,
} from "@/lib/crypto"
import { formatBytes, relativeTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { ReportLink } from "@/components/report-link"
import { downloadZip, fileBlobOpts, type BundleFile, type Manifest } from "@/lib/bundle"
import { downloadToBlob, saveDecrypted, storeItem, triggerDownload } from "@/lib/transfer"
import { useCopy } from "@/hooks/use-copy"

export const Route = createFileRoute("/s/$id")({ component: SharePage })

const PREVIEW_LIMIT = 25 * 1024 * 1024

type Opened = {
  open: ShareOpen
  meta: ItemMeta
  fileKey: Uint8Array<ArrayBuffer>
  /** The link's wrap key: opens files added through the link, and wraps the ones added here. */
  wrap: CryptoKey
  text?: string
  previewUrl?: string
  manifest?: Manifest
}

type State =
  | { s: "loading" }
  | { s: "missing"; info: ShareInfo } // link arrived without its key fragment
  | { s: "gone"; message: string }
  | { s: "ready"; info: ShareInfo }
  | { s: "opened"; data: Opened }

function SharePage() {
  const { id } = Route.useParams()
  const { t } = useI18n()
  const [state, setState] = useState<State>({ s: "loading" })
  const [secret, setSecret] = useState("")
  const [password, setPassword] = useState("")
  const [working, setWorking] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const opening = useRef("")

  useEffect(() => {
    const frag = decodeURIComponent(location.hash.slice(1))
    api<ShareInfo>(`/api/s/${encodeURIComponent(id)}`)
      .then((info) => {
        // Short links carry no key: the server hands it out with the id.
        const key = frag || info.secret || ""
        setSecret(key)
        setState(key ? { s: "ready", info } : { s: "missing", info })
      })
      .catch((e) => setState({ s: "gone", message: (e as Error).message }))
  }, [id])

  // Revoke preview URLs when leaving.
  const previewUrl = state.s === "opened" ? state.data.previewUrl : undefined
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl])

  /** `quiet`: opened without being asked to, so a key that is no good is not worth a toast; the form is shown instead. */
  const decrypt = async (info: ShareInfo, key: string, pw: string, quiet = false) => {
    const secretBytes = b32decode(key)
    if (!secretBytes || secretBytes.length !== SHARE_SECRET_BYTES || normalizeCode(key).length !== 16) {
      if (!quiet) toast.error(t("That key doesn't look right"), { description: t("It should be 16 characters, like h4c9-w2pz-8rtf-6mxn.") })
      return
    }
    if (info.hasPassword && !pw) {
      toast.error(t("This link needs a password"))
      return
    }
    try {
      setWorking(info.hasPassword ? t("Deriving key from password") : t("Unlocking"))
      const pwKey = info.hasPassword ? await stretch(pw, fromB64(info.pwSalt!), info.pwKdf!) : undefined
      const keys = await shareKeys(secretBytes, pwKey)
      const open = await api<ShareOpen>(`/api/s/${encodeURIComponent(id)}/open`, { body: { access: toB64(keys.access) } })
      const fileKey = await unwrapShareKey(keys, fromB64(open.wrappedKey), open.itemId)
      const meta = await openMeta(await itemKeys(fileKey), fromB64(open.encMeta), open.itemId)
      // The key has done its job; keep it out of history and screenshots.
      history.replaceState(history.state, "", location.pathname)

      const data: Opened = { open, meta, fileKey, wrap: keys.wrap }
      const small = open.size <= PREVIEW_LIMIT
      if (open.kind === "bundle" || open.kind === "text" || (small && /^(image|video|audio)\//.test(meta.type))) {
        setWorking(t("Decrypting"))
        const blob = await downloadToBlob({
          url: `/api/s/${id}/blob`,
          headers: { "X-Ticket": open.ticket },
          fileKey,
          chunkSize: open.chunkSize,
          chunkCount: open.chunkCount,
          size: open.size,
          type: meta.type,
          onProgress: setProgress,
        })
        if (open.kind === "bundle") data.manifest = JSON.parse(await blob.text()) as Manifest
        else if (open.kind === "text") data.text = await blob.text()
        else data.previewUrl = URL.createObjectURL(blob)
      }
      setState({ s: "opened", data })
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState({ s: "gone", message: e.message })
      else toast.error(e instanceof ApiError ? e.message : t("Couldn't decrypt — the link may be damaged"))
    } finally {
      setWorking(null)
      setProgress(0)
    }
  }

  // Asking first protects a link that is used up by being opened, and a
  // password has to be typed anyway. A link with neither just opens.
  useEffect(() => {
    if (state.s !== "ready" || state.info.hasPassword || state.info.limited !== false || opening.current === id) return
    opening.current = id
    void decrypt(state.info, secret, "", true)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per link, when its details arrive
  }, [state, id])

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="relative flex flex-1 items-start justify-center px-4 pt-10 pb-20 sm:items-center sm:pt-0">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute top-1/2 left-1/2 size-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--lavender-soft),transparent)] opacity-70" />
        </div>
        <div className="w-full max-w-lg min-w-0">
          {state.s === "loading" && (
            <Shell>
              <div className="grid place-items-center py-16">
                <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
              </div>
            </Shell>
          )}

          {state.s === "gone" && (
            <Shell>
              <div className="grid gap-4 p-6 text-center sm:p-8">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-coral-soft">
                  <FlameIcon className="size-6 text-coral" />
                </span>
                <h1 className="text-2xl font-medium">{t("This link is gone")}</h1>
                <p className="text-sm text-muted-foreground">
                  {t(
                    "It may have expired, reached its view limit, or been revoked by its owner. There's nothing left to decrypt — that's by design."
                  )}
                </p>
                <Button asChild variant="secondary" className="mx-auto mt-2">
                  <Link to="/">{t("Share something yourself")}</Link>
                </Button>
              </div>
            </Shell>
          )}

          {(state.s === "ready" || state.s === "missing") && (
            <Shell>
              <form
                className="grid gap-5 p-6 sm:p-8"
                onSubmit={(e) => {
                  e.preventDefault()
                  void decrypt(state.info, secret, password)
                }}
              >
                <div className="grid gap-4 text-center">
                  <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
                    <LockKeyholeIcon className="size-6" />
                  </span>
                  <div>
                    <h1 className="text-2xl font-medium">{t("Someone sent you something private")}</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("It will be decrypted right here in your browser. Nothing readable ever touches the server.")}
                    </p>
                  </div>
                </div>

                {state.s === "missing" && (
                  <div className="grid gap-1.5">
                    <label className="eyebrow" htmlFor="secret">
                      {t("Decryption key")}
                    </label>
                    <Input
                      id="secret"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder="xxxx-xxxx-xxxx-xxxx"
                      className="font-mono"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">{t("This link arrived without its key. Ask the sender for it.")}</p>
                  </div>
                )}

                {state.info.hasPassword && (
                  <div className="grid gap-1.5">
                    <label className="flex items-center gap-1.5 eyebrow" htmlFor="pw">
                      <KeyRoundIcon className="size-3" /> {t("Password required")}
                    </label>
                    <Input
                      id="pw"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("Enter the password you were given")}
                      autoComplete="off"
                      data-1p-ignore
                      data-lpignore="true"
                      data-bwignore="true"
                      data-form-type="other"
                      autoFocus={state.s === "ready"}
                    />
                  </div>
                )}

                {working ? (
                  <div className="grid gap-2 rounded-full border bg-muted/40 px-5 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Loader2Icon className="size-3.5 animate-spin" /> {working}
                      </span>
                      {progress > 0 && <span className="font-mono text-xs text-muted-foreground">{Math.round(progress * 100)}%</span>}
                    </div>
                    {progress > 0 && <Progress value={progress * 100} className="h-1" />}
                  </div>
                ) : (
                  <Button size="lg" type="submit" className="w-full">
                    <LockKeyholeOpenIcon /> {t("Decrypt")}
                  </Button>
                )}
                <p className="flex items-start justify-center gap-1.5 text-center text-xs text-muted-foreground">
                  <FlameIcon className="mt-px size-3.5 shrink-0" />
                  {state.info.limited
                    ? t("Opening uses up one of this link's views. Save what you need.")
                    : t("Some links self-destruct once opened. Save what you need.")}
                </p>
              </form>
            </Shell>
          )}

          {state.s === "opened" &&
            (state.data.manifest ? (
              <FolderView id={id} data={state.data} manifest={state.data.manifest} />
            ) : (
              <OpenedView id={id} data={state.data} />
            ))}
          {(state.s === "ready" || state.s === "opened") && <ReportLink id={id} secret={normalizeCode(secret)} />}
        </div>
      </main>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 overflow-hidden rounded-[1.75rem] border bg-card shadow-soft">{children}</div>
}

function OpenedView({ id, data }: { id: string; data: Opened }) {
  const { open, meta, fileKey, text, previewUrl } = data
  const { copy, copied } = useCopy()
  const { t } = useI18n()
  const [saving, setSaving] = useState<number | null>(null)
  const isImage = meta.type.startsWith("image/")
  const isVideo = meta.type.startsWith("video/")
  const isAudio = meta.type.startsWith("audio/")
  const cached = useMemo(() => (text !== undefined ? new Blob([text], { type: "text/plain" }) : null), [text])

  const save = async () => {
    if (cached) return triggerDownload(cached, meta.name.endsWith(".txt") ? meta.name : `${meta.name}.txt`)
    if (previewUrl) {
      const blob = await fetch(previewUrl).then((r) => r.blob())
      return triggerDownload(blob, meta.name)
    }
    try {
      setSaving(0)
      await saveDecrypted({
        url: `/api/s/${id}/blob`,
        headers: { "X-Ticket": open.ticket },
        fileKey,
        chunkSize: open.chunkSize,
        chunkCount: open.chunkCount,
        size: open.size,
        name: meta.name,
        type: meta.type,
        onProgress: setSaving,
      })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="grid gap-3">
      <Shell>
        <div className="grid gap-5 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <FileGlyph kind={open.kind} type={meta.type} className="size-12" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" title={meta.name}>
                {open.kind === "text" ? t("Private note") : meta.name}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatBytes(meta.size)}
                {open.expiresAt ? ` · ${t("link expires {when}", { when: relativeTime(open.expiresAt) })}` : ""}
              </p>
            </div>
            <span className="hidden items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground sm:flex">
              <ShieldCheckIcon className="size-3.5" /> {t("Verified")}
            </span>
          </div>

          {text !== undefined && (
            <div className="relative">
              <pre className="max-h-[50vh] overflow-y-auto rounded-2xl border bg-muted/40 p-4 pr-12 font-mono text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                {text}
              </pre>
              <Button
                size="icon-sm"
                variant="outline"
                className="absolute top-2.5 right-2.5"
                onClick={() => copy(text, t("Copied"))}
                aria-label={t("Copy text")}
              >
                {copied === text ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </div>
          )}

          {previewUrl && isImage && (
            <img src={previewUrl} alt={meta.name} className="max-h-[60vh] w-full rounded-2xl border bg-muted object-contain" />
          )}
          {previewUrl && isVideo && <video src={previewUrl} controls className="w-full rounded-2xl border bg-black" />}
          {previewUrl && isAudio && <audio src={previewUrl} controls className="w-full" />}

          {saving !== null ? (
            <div className="grid gap-2 rounded-full border bg-muted/40 px-5 py-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Loader2Icon className="size-3.5 animate-spin" /> {t("Decrypting")}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{Math.round(saving * 100)}%</span>
              </div>
              <Progress value={saving * 100} className="h-1" />
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button size="lg" onClick={save} className="flex-1">
                <DownloadIcon /> {open.kind === "text" ? t("Download as .txt") : t("Download")}
              </Button>
              {text !== undefined && (
                <Button size="lg" variant="outline" onClick={() => copy(text, t("Copied"))} className="flex-1">
                  <CopyIcon /> {t("Copy text")}
                </Button>
              )}
            </div>
          )}
        </div>
      </Shell>

      <ViewsNotice open={open} />
    </div>
  )
}

function ViewsNotice({ open }: { open: ShareOpen }) {
  const { t, tn } = useI18n()
  return (
    <>
      {(open.burned || open.viewsLeft !== undefined) && (
        <div className="flex items-start gap-3 rounded-2xl border border-coral/30 bg-coral-soft/60 p-4 text-sm">
          {open.burned ? (
            <FlameIcon className="mt-0.5 size-4 shrink-0 text-coral" />
          ) : (
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-coral" />
          )}
          <p>
            {open.burned
              ? t("This link has now self-destructed. Save anything you need before closing this page — it can't be opened again.")
              : tn(open.viewsLeft ?? 0, "This link can be opened {n} more time.", "This link can be opened {n} more times.")}
          </p>
        </div>
      )}
    </>
  )
}

function FolderView({ id, data, manifest: listed }: { id: string; data: Opened; manifest: Manifest }) {
  const { open } = data
  const { t, tn } = useI18n()
  const [zipping, setZipping] = useState<number | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  // Files added through the link since its manifest was written.
  const [added, setAdded] = useState<BundleFile[]>([])
  const [adding, setAdding] = useState<{ name: string; progress: number } | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const upload = listed.upload

  const loadAdded = useCallback(async () => {
    try {
      const rows = await api<AddedItem[]>(`/api/s/${id}/added`, { headers: { "X-Ticket": open.ticket } })
      const files = await Promise.all(
        rows.map(async (row): Promise<BundleFile | null> => {
          try {
            const key = await unwrapFromShare(data.wrap, fromB64(row.linkKey), row.id)
            const meta = await openMeta(await itemKeys(key), fromB64(row.encMeta), row.id)
            return {
              id: row.id,
              path: meta.name,
              name: meta.name,
              type: meta.type,
              size: meta.size,
              key: toB64(key),
              chunkSize: row.chunkSize,
              chunkCount: row.chunkCount,
              cipherSize: row.size,
            }
          } catch {
            return null // not wrapped for this link; nothing we can show
          }
        })
      )
      setAdded(files.filter((f): f is BundleFile => f !== null))
    } catch {
      /* the ticket ran out; what is listed stays */
    }
  }, [id, open.ticket, data.wrap])

  useEffect(() => {
    if (upload) void loadAdded()
  }, [upload, loadAdded])

  const manifest = useMemo(() => {
    const known = new Set(listed.files.map((f) => f.id))
    return { ...listed, files: [...listed.files, ...added.filter((f) => !known.has(f.id))] }
  }, [listed, added])
  const addedIds = useMemo(() => new Set(added.map((f) => f.id)), [added])
  const total = manifest.files.reduce((n, f) => n + f.size, 0)

  const add = async (files: FileList | null) => {
    if (!files || !upload || adding) return
    let sent = 0
    try {
      for (const file of Array.from(files)) {
        setAdding({ name: file.name, progress: 0 })
        await storeItem({
          kind: "file",
          name: file.name,
          type: file.type,
          blob: file,
          request: { id: upload.requestId, access: fromB64(upload.access), publicKey: fromB64(upload.publicKey), linkWrap: data.wrap },
          onProgress: (p) => setAdding({ name: file.name, progress: p }),
        })
        sent++
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAdding(null)
      if (sent > 0) {
        toast.success(tn(sent, "{n} file added", "{n} files added"))
        void loadAdded()
      }
    }
  }

  const zipAll = async () => {
    try {
      setZipping(0)
      const failed = await downloadZip(id, open.ticket, manifest, setZipping)
      if (failed.length) toast.warning(tn(failed.length, "{n} file was no longer available", "{n} files were no longer available"))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setZipping(null)
    }
  }

  const saveOne = async (f: BundleFile) => {
    try {
      setSaving(f.id)
      await saveDecrypted(fileBlobOpts(id, open.ticket, f))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="grid gap-3">
      <Shell>
        <div className="grid gap-5 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <FileGlyph kind="folder" className="size-12" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" title={manifest.name}>
                {manifest.name}
              </p>
              <p className="text-sm text-muted-foreground">
                {tn(manifest.files.length, "{n} file", "{n} files")} · {formatBytes(total)}
                {open.expiresAt ? ` · ${t("expires {when}", { when: relativeTime(open.expiresAt) })}` : ""}
              </p>
            </div>
          </div>

          <ul className="-mx-2 grid max-h-[45vh] overflow-y-auto">
            {manifest.files.map((f) => {
              const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""
              return (
                <li key={f.id} className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/50">
                  <FileGlyph kind="file" type={f.type} className="size-9 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" title={f.path}>
                      {f.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dir ? `${dir} · ` : ""}
                      {formatBytes(f.size)}
                      {addedIds.has(f.id) ? ` · ${t("added through this link")}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => saveOne(f)}
                    disabled={saving !== null || zipping !== null}
                    aria-label={t("Download {name}", { name: f.name })}
                  >
                    {saving === f.id ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
                  </Button>
                </li>
              )
            })}
          </ul>

          {zipping !== null ? (
            <div className="grid gap-2 rounded-full border bg-muted/40 px-5 py-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Loader2Icon className="size-3.5 animate-spin" /> {t("Decrypting & zipping")}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{Math.round(zipping * 100)}%</span>
              </div>
              <Progress value={zipping * 100} className="h-1" />
            </div>
          ) : (
            <Button size="lg" onClick={zipAll} disabled={saving !== null || manifest.files.length === 0}>
              <DownloadIcon /> {t("Download all as .zip")}
            </Button>
          )}

          {upload && (
            <div className="grid gap-2 border-t pt-5">
              {adding ? (
                <div className="grid gap-2 rounded-full border bg-muted/40 px-5 py-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
                      <span className="truncate">{t("Adding {name}…", { name: adding.name })}</span>
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{Math.round(adding.progress * 100)}%</span>
                  </div>
                  <Progress value={adding.progress * 100} className="h-1" />
                </div>
              ) : (
                <Button size="lg" variant="outline" onClick={() => picker.current?.click()} disabled={zipping !== null}>
                  <UploadIcon /> {t("Add files")}
                </Button>
              )}
              <p className="text-center text-xs text-muted-foreground">
                {t("This link lets you add files to the folder. They are encrypted here first, and everyone with the link will see them.")}
              </p>
              <input
                ref={picker}
                type="file"
                hidden
                multiple
                onChange={(e) => {
                  void add(e.target.files)
                  e.target.value = ""
                }}
              />
            </div>
          )}
        </div>
      </Shell>
      <ViewsNotice open={open} />
    </div>
  )
}
