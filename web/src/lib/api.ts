import type { ItemKind, KdfParams } from "./crypto"
import { t } from "./i18n"

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    // Server and client messages are English; show them in the reader's language.
    super(t(message))
  }
}

type Opts = { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Coffer": "1", ...opts.headers }
  let body: BodyInit | undefined
  if (opts.body instanceof Uint8Array) {
    body = opts.body as Uint8Array<ArrayBuffer>
    headers["Content-Type"] = "application/octet-stream"
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers["Content-Type"] = "application/json"
  }
  let res: Response
  try {
    res = await fetch(path, {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      credentials: "same-origin",
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e
    throw new ApiError(0, "Network error — check your connection")
  }
  if (!res.ok) {
    let msg = res.statusText || "Request failed"
    try {
      msg = (await res.json()).error ?? msg
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg)
  }
  return (await res.json()) as T
}

// ------------------------------------------------------------------ shapes

export type ServerConfig = {
  allowRegistration: boolean
  allowAnonymous: boolean
  maxFileSize: number
  anonMaxFileSize: number
  anonMaxExpiry: number
}

export type Me = {
  email: string
  salt: string
  kdf: KdfParams
  wrappedMasterKey: string
  quota: number
  used: number
  createdAt: number
}

export type FolderRow = { id: string; parentId: string | null; encName: string; createdAt: number }

export type ItemRow = {
  id: string
  folderId: string | null
  kind: ItemKind
  encMeta: string
  wrappedKey: string
  size: number
  chunkSize: number
  chunkCount: number
  createdAt: number
}

export type ShareRow = {
  id: string
  itemId: string
  hasPassword: boolean
  encSecret: string | null
  short: boolean
  maxViews: number | null
  views: number
  expiresAt: number | null
  createdAt: number
}

export type DriveData = {
  folders: FolderRow[]
  items: ItemRow[]
  shares: ShareRow[]
  usage: { used: number; quota: number }
}

/** `secret` is only present for short links, where the id alone opens the share. */
export type ShareInfo = { id: string; hasPassword: boolean; pwSalt?: string; pwKdf?: KdfParams; secret?: string }

export type ShareOpen = {
  itemId: string
  kind: ItemKind
  encMeta: string
  wrappedKey: string
  size: number
  chunkSize: number
  chunkCount: number
  ticket: string
  burned: boolean
  viewsLeft?: number
  expiresAt?: number
}

let configPromise: Promise<ServerConfig> | null = null
export function getConfig() {
  configPromise ??= api<ServerConfig>("/api/config").catch((e) => {
    configPromise = null
    throw e
  })
  return configPromise
}
