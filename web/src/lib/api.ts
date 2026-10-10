import type { ItemKind, KdfParams } from "./crypto"
import { t } from "./i18n"

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
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

export type Plan = { id: string; name: string; quota: number; amount: number; currency: string }

export type ServerConfig = {
  allowRegistration: boolean
  allowAnonymous: boolean
  maxFileSize: number
  /** A quick share's files may add up to this many plaintext bytes. */
  anonMaxShareSize: number
  anonMaxFiles: number
  anonMaxExpiry: number
  /** Paid drive sizes; null on servers where drives are free. */
  plans: Plan[] | null
  /** Whether "Continue with Google" is offered. */
  google: boolean
}

export type Billing = {
  plan: string | null
  status: "active" | "trialing" | "past_due" | "paused" | "canceled" | null
  /** Whether the drive can be added to. A lapsed drive is read-only. */
  entitled: boolean
  /** A checkout was started and has not been confirmed yet. */
  pending: boolean
  periodEnd?: number
  cancelAt?: number
  /** When a lapsed drive's files will be deleted unless the plan is renewed. */
  deleteAt?: number
  /** Storage granted by an admin at no charge, until `until` if set. */
  comp?: { quota: number; until?: number }
  /** A personal price an admin has set for this account. */
  offer?: { amount: number; currency: string; interval: "month" | "year"; trialDays: number; quota: number }
}

export type Me = {
  email: string
  salt: string
  kdf: KdfParams
  wrappedMasterKey: string
  quota: number
  used: number
  createdAt: number
  billing: Billing | null
  /** Whether the email address has been confirmed. */
  verified: boolean
}

/** Whether this account's drive accepts new files. */
export const canWrite = (me: Me | null) => !!me && (!me.billing || me.billing.entitled)

export type FolderRow = { id: string; parentId: string | null; encName: string; createdAt: number }

export type ItemRow = {
  id: string
  folderId: string | null
  kind: ItemKind
  encMeta: string
  /** Null on a file that came in through a request and has not been re-wrapped yet; see `sealedKey`. */
  wrappedKey: string | null
  size: number
  chunkSize: number
  chunkCount: number
  createdAt: number
  /** The file key, sealed by an uploader to the public key of the request named by `requestId`. */
  sealedKey?: string
  requestId?: string
}

/** A file request: an upload link into this drive. Everything readable in it is sealed. */
export type RequestRow = {
  id: string
  folderId: string | null
  encInfo: string
  encSecret: string
  encPrivate: string
  maxFiles: number | null
  maxBytes: number | null
  maxFileSize: number | null
  expiresAt: number | null
  revokedAt: number | null
  createdAt: number
  /** Uploads finished or under way, and their ciphertext bytes. */
  uploads: number
  bytes: number
  /** Uploads finished. */
  received: number
  /** Set on the request behind a folder link whose holders may add files; it has no page of its own. */
  shareId?: string
}

/** A file added through a folder link, as the link's other holders are shown it. */
export type AddedItem = {
  id: string
  encMeta: string
  /** The file key, wrapped with the link's key. */
  linkKey: string
  size: number
  chunkSize: number
  chunkCount: number
  createdAt: number
}

/** What anyone holding a request's id is told. */
export type RequestPublic = {
  id: string
  encInfo: string
  maxFileSize: number
  filesLeft?: number
  bytesLeft?: number
  expiresAt?: number
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
  /** The link's wrap key, sealed to its owner; absent on links made before folder links could follow their folder. */
  encWrap: string | null
}

export type DriveData = {
  folders: FolderRow[]
  items: ItemRow[]
  shares: ShareRow[]
  requests: RequestRow[]
  usage: { used: number; quota: number }
}

/**
 * `secret` is only present for short links, where the id alone opens the share.
 * `limited` means opening it uses up one of a set number of views.
 */
export type ShareInfo = { id: string; hasPassword: boolean; limited?: boolean; pwSalt?: string; pwKdf?: KdfParams; secret?: string }

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
