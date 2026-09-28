import { api, ApiError } from "./api"
import {
  CHUNK_SIZE,
  GCM_TAG,
  itemKeys,
  openChunk,
  randomBytes,
  randomId,
  sealChunk,
  sealMeta,
  sha256,
  shareKeys,
  stretch,
  toB64,
  wrapFileKey,
  wrapShareKey,
  b32encode,
  KDF_DEFAULT,
  SHARE_SECRET_BYTES,
  sealShareSecret,
  type ItemMeta,
} from "./crypto"

export type Progress = (fraction: number) => void

export type StoredItem = {
  id: string
  fileKey: Uint8Array<ArrayBuffer>
  meta: ItemMeta
  manageToken?: string
  expiresAt?: number
}

/**
 * Encrypts a blob in the browser and uploads it chunk by chunk. With a master
 * key the item lands in the user's drive; without one it is an anonymous drop
 * that the server deletes after `expiresIn` seconds.
 */
export async function storeItem(opts: {
  kind: "file" | "text"
  name: string
  type: string
  blob: Blob
  masterKey?: CryptoKey
  folderId?: string | null
  expiresIn?: number
  onProgress?: Progress
  signal?: AbortSignal
}): Promise<StoredItem> {
  const id = randomId(26)
  const fileKey = randomBytes(32)
  const keys = await itemKeys(fileKey)
  const meta: ItemMeta = { name: opts.name, type: opts.type || "application/octet-stream", size: opts.blob.size, v: 1 }
  const chunkCount = Math.max(1, Math.ceil(opts.blob.size / CHUNK_SIZE))

  const created = await api<{ id: string; manageToken?: string; expiresAt?: number }>("/api/items", {
    body: {
      id,
      kind: opts.kind,
      encMeta: toB64(await sealMeta(keys, meta, id)),
      wrappedKey: opts.masterKey ? toB64(await wrapFileKey(opts.masterKey, fileKey, id)) : undefined,
      folderId: opts.folderId ?? undefined,
      size: opts.blob.size + chunkCount * GCM_TAG,
      chunkSize: CHUNK_SIZE,
      chunkCount,
      expiresIn: opts.masterKey ? undefined : opts.expiresIn,
    },
    signal: opts.signal,
  })
  const headers: Record<string, string> = created.manageToken ? { "X-Manage-Token": created.manageToken } : {}

  opts.onProgress?.(0)
  for (let i = 0; i < chunkCount; i++) {
    const slice = opts.blob.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    const plain = new Uint8Array(await slice.arrayBuffer())
    const sealed = await sealChunk(keys.content, i, i === chunkCount - 1, plain)
    await withRetry(() => api(`/api/items/${id}/chunks/${i}`, { method: "PUT", body: sealed, headers, signal: opts.signal }))
    opts.onProgress?.((i + 1) / chunkCount)
  }
  await api(`/api/items/${id}/complete`, { method: "POST", headers, signal: opts.signal })
  return { id, fileKey, meta, manageToken: created.manageToken, expiresAt: created.expiresAt }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const retryable = e instanceof ApiError && (e.status === 0 || e.status >= 500)
      if (!retryable || i >= attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
}

export type ShareOptions = {
  password?: string
  maxViews?: number | null
  expiresIn?: number | null
}

export type CreatedShare = { id: string; secret: string; url: string; expiresAt: number | null }

/** Creates a share link. The secret lives only in the URL fragment, never on the server. */
export async function createShare(
  itemId: string,
  fileKey: Uint8Array<ArrayBuffer>,
  opts: ShareOptions,
  auth: { manageToken?: string; masterKey?: CryptoKey | null } = {},
): Promise<CreatedShare> {
  const secretBytes = randomBytes(SHARE_SECRET_BYTES)
  const secret = b32encode(secretBytes)
  let pwSalt: Uint8Array<ArrayBuffer> | undefined
  let pwKey: Uint8Array<ArrayBuffer> | undefined
  if (opts.password) {
    pwSalt = randomBytes(16)
    pwKey = await stretch(opts.password, pwSalt, KDF_DEFAULT)
  }
  const keys = await shareKeys(secretBytes, pwKey)
  const res = await api<{ id: string; expiresAt: number | null }>("/api/shares", {
    body: {
      itemId,
      wrappedKey: toB64(await wrapShareKey(keys, fileKey, itemId)),
      accessHash: toB64(await sha256(keys.access)),
      // Lets the owner copy the link again later; sealed with their master key.
      encSecret: auth.masterKey ? toB64(await sealShareSecret(auth.masterKey, secret)) : undefined,
      pwSalt: pwSalt ? toB64(pwSalt) : undefined,
      pwKdf: pwSalt ? KDF_DEFAULT : undefined,
      maxViews: opts.maxViews ?? undefined,
      expiresIn: opts.expiresIn ?? undefined,
    },
    headers: auth.manageToken ? { "X-Manage-Token": auth.manageToken } : {},
  })
  return { id: res.id, secret, url: shareUrl(res.id, secret), expiresAt: res.expiresAt }
}

export function shareUrl(id: string, secret: string) {
  return `${location.origin}/s/${id}#${secret}`
}

/**
 * Streams an encrypted blob and decrypts it chunk by chunk into `sink`.
 * Truncation, reordering and tampering all surface as a DecryptError.
 */
export async function downloadDecrypted(opts: {
  url: string
  headers?: Record<string, string>
  fileKey: Uint8Array<ArrayBuffer>
  chunkSize: number
  chunkCount: number
  size: number
  sink: (plain: Uint8Array<ArrayBuffer>) => Promise<void> | void
  onProgress?: Progress
  signal?: AbortSignal
}) {
  const { content } = await itemKeys(opts.fileKey)
  const res = await fetch(opts.url, { headers: opts.headers, credentials: "same-origin", signal: opts.signal })
  if (!res.ok || !res.body) {
    let msg = "Download failed"
    try {
      msg = (await res.json()).error ?? msg
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg)
  }
  const reader = res.body.getReader()
  const full = opts.chunkSize + GCM_TAG
  const buf = new Uint8Array(full)
  let fill = 0
  let index = 0
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.length
    let off = 0
    while (off < value.length) {
      if (index >= opts.chunkCount) throw new ApiError(0, "Unexpected data in download")
      const last = index === opts.chunkCount - 1
      const need = last ? opts.size - index * full : full
      const take = Math.min(need - fill, value.length - off)
      buf.set(value.subarray(off, off + take), fill)
      fill += take
      off += take
      if (fill === need) {
        await opts.sink(await openChunk(content, index, last, buf.slice(0, need)))
        index++
        fill = 0
      }
    }
    opts.onProgress?.(Math.min(received / opts.size, 1))
  }
  if (index !== opts.chunkCount) throw new ApiError(0, "Download was cut short")
}

/** Decrypts into memory and returns a Blob of the given type. */
export async function downloadToBlob(opts: Omit<Parameters<typeof downloadDecrypted>[0], "sink"> & { type: string }) {
  const parts: Uint8Array<ArrayBuffer>[] = []
  await downloadDecrypted({ ...opts, sink: (p) => void parts.push(p) })
  return new Blob(parts, { type: opts.type })
}

type SavePicker = (o: { suggestedName: string }) => Promise<{
  createWritable(): Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>
}>

/**
 * Saves a decrypted download to disk. Large files stream straight to disk when
 * the browser supports the File System Access API; otherwise they buffer.
 */
export async function saveDecrypted(
  opts: Omit<Parameters<typeof downloadDecrypted>[0], "sink"> & { name: string; type: string },
) {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  if (picker && opts.size > 256 * 1024 * 1024) {
    let handle
    try {
      handle = await picker({ suggestedName: opts.name })
    } catch {
      return false // user cancelled
    }
    const writable = await handle.createWritable()
    try {
      await downloadDecrypted({ ...opts, sink: (p) => writable.write(p) })
      await writable.close()
    } catch (e) {
      await writable.abort()
      throw e
    }
    return true
  }
  const blob = await downloadToBlob(opts)
  triggerDownload(blob, opts.name)
  return true
}

export function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
