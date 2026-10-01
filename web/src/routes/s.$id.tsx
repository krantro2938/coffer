import { useEffect, useMemo, useState } from "react"
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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { FileGlyph } from "@/components/file-glyph"
import { SiteHeader } from "@/components/site-header"
import { api, ApiError, type ShareInfo, type ShareOpen } from "@/lib/api"
import {
  b32decode,
  fromB64,
  itemKeys,
  normalizeCode,
  openMeta,
  shareKeys,
  stretch,
  toB64,
  unwrapShareKey,
  SHARE_SECRET_BYTES,
  type ItemMeta,
} from "@/lib/crypto"
import { formatBytes, relativeTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { downloadZip, fileBlobOpts, type BundleFile, type Manifest } from "@/lib/bundle"
import { downloadToBlob, saveDecrypted, triggerDownload } from "@/lib/transfer"
import { useCopy } from "@/hooks/use-copy"

export const Route = createFileRoute("/s/$id")({ component: SharePage })

const PREVIEW_LIMIT = 25 * 1024 * 1024

type Opened = {
  open: ShareOpen
  meta: ItemMeta
  fileKey: Uint8Array<ArrayBuffer>
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

  const decrypt = async () => {
    if (state.s !== "ready" && state.s !== "missing") return
    const info = state.info
    const secretBytes = b32decode(secret)
    if (!secretBytes || secretBytes.length !== SHARE_SECRET_BYTES || normalizeCode(secret).length !== 16) {
      toast.error(t("That key doesn't look right"), { description: t("It should be 16 characters, like h4c9-w2pz-8rtf-6mxn.") })
      return
    }
    if (info.hasPassword && !password) {
      toast.error(t("This link needs a password"))
      return
    }
    try {
      setWorking(info.hasPassword ? t("Deriving key from password") : t("Unlocking"))
      const pwKey = info.hasPassword ? await stretch(password, fromB64(info.pwSalt!), info.pwKdf!) : undefined
      const keys = await shareKeys(secretBytes, pwKey)
      const open = await api<ShareOpen>(`/api/s/${encodeURIComponent(id)}/open`, { body: { access: toB64(keys.access) } })
      const fileKey = await unwrapShareKey(keys, fromB64(open.wrappedKey), open.itemId)
      const meta = await openMeta(await itemKeys(fileKey), fromB64(open.encMeta), open.itemId)
      // The key has done its job; keep it out of history and screenshots.
      history.replaceState(history.state, "", location.pathname)

      const data: Opened = { open, meta, fileKey }
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
                  {t("It may have expired, reached its view limit, or been revoked by its owner. There's nothing left to decrypt — that's by design.")}
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
                  void decrypt()
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
                    <label className="eyebrow flex items-center gap-1.5" htmlFor="pw">
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
                      {progress > 0 && (
                        <span className="font-mono text-xs text-muted-foreground">{Math.round(progress * 100)}%</span>
                      )}
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
                  {t("Some links self-destruct once opened. Save what you need.")}
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
              <p className="truncate font-medium" title={meta.name}>{open.kind === "text" ? t("Private note") : meta.name}</p>
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
              <pre className="max-h-[50vh] overflow-y-auto rounded-2xl border bg-muted/40 p-4 pr-12 font-mono text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
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

function FolderView({ id, data, manifest }: { id: string; data: Opened; manifest: Manifest }) {
  const { open } = data
  const { t, tn } = useI18n()
  const [zipping, setZipping] = useState<number | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const total = manifest.files.reduce((n, f) => n + f.size, 0)

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
            <Button size="lg" onClick={zipAll} disabled={saving !== null}>
              <DownloadIcon /> {t("Download all as .zip")}
            </Button>
          )}
        </div>
      </Shell>
      <ViewsNotice open={open} />
    </div>
  )
}
