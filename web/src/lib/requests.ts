/**
 * File requests: a link through which anyone can upload into a drive without
 * an account. The uploader's browser encrypts each file under a fresh key and
 * seals that key to the request's public key, so the link is upload-only:
 * neither it nor the server can read what came in.
 *
 * The link is /r/<id>#<secret>. The secret never reaches the server. It opens
 * the request's description, which carries the public key (so the server
 * cannot substitute its own), and derives the token an upload must present.
 */
import { api, type RequestPublic, type RequestRow } from "./api"
import {
  b32decode,
  b32encode,
  fromB64,
  newRequestKeys,
  normalizeCode,
  openRequestInfo,
  openRequestPrivate,
  openRequestSecret,
  randomBytes,
  randomId,
  requestLinkKeys,
  sealName,
  sealRequestInfo,
  sealRequestSecret,
  sha256,
  toB64,
  REQUEST_SECRET_BYTES,
  type RequestInfo,
} from "./crypto"
import { t } from "./i18n"
import { storeItem, type Progress } from "./transfer"

export function requestUrl(id: string, secret: string) {
  return `${location.origin}/r/${id}#${secret}`
}

/** A request as its owner sees it. */
export type DRequest = RequestRow & {
  title: string
  note: string
  url: string | null
  publicKey: Uint8Array<ArrayBuffer> | null
  privateKey: CryptoKey | null
  /** The token an upload through it must present. */
  access: Uint8Array<ArrayBuffer> | null
  /** Could not be opened with this account's key. */
  broken: boolean
}

export type RequestStatus = "open" | "full" | "expired" | "closed"

export function requestStatus(r: RequestRow): RequestStatus {
  if (r.revokedAt) return "closed"
  if (r.expiresAt && r.expiresAt * 1000 <= Date.now()) return "expired"
  if ((r.maxFiles !== null && r.uploads >= r.maxFiles) || (r.maxBytes !== null && r.bytes >= r.maxBytes)) return "full"
  return "open"
}

export async function decryptRequest(mk: CryptoKey, row: RequestRow): Promise<DRequest> {
  try {
    const secret = await openRequestSecret(mk, fromB64(row.encSecret), row.id)
    const link = await requestLinkKeys(b32decode(secret)!)
    const info = await openRequestInfo(link, fromB64(row.encInfo), row.id)
    return {
      ...row,
      title: info.title,
      note: info.note,
      access: link.access,
      url: requestUrl(row.id, secret),
      publicKey: fromB64(info.publicKey),
      privateKey: await openRequestPrivate(mk, fromB64(row.encPrivate), row.id),
      broken: false,
    }
  } catch {
    return { ...row, title: "Unreadable request", note: "", url: null, publicKey: null, privateKey: null, access: null, broken: true }
  }
}

export type NewRequest = {
  title: string
  note: string
  expiresIn: number | null
  maxFiles: number | null
  /** Plaintext bytes per file. */
  maxFileSize: number | null
  /** Bytes in all. */
  maxBytes: number | null
}

/** Everything a new request consists of: what the server stores, and what an uploader needs. */
async function requestMaterial(masterKey: CryptoKey, title: string, note: string) {
  const id = randomId(20)
  const secretBytes = randomBytes(REQUEST_SECRET_BYTES)
  const secret = b32encode(secretBytes)
  const link = await requestLinkKeys(secretBytes)
  const { publicKey, encPrivate } = await newRequestKeys(masterKey, id)
  const info: RequestInfo = { v: 1, title, note, publicKey: toB64(publicKey) }
  return {
    id,
    secret,
    access: link.access,
    publicKey,
    stored: {
      id,
      accessHash: toB64(await sha256(link.access)),
      encInfo: toB64(await sealRequestInfo(link, info, id)),
      encSecret: toB64(await sealRequestSecret(masterKey, secret, id)),
      encPrivate: toB64(encPrivate),
    },
  }
}

/** Creates a request, with a folder of its own in the drive for what comes in. */
export async function createRequest(masterKey: CryptoKey, opts: NewRequest): Promise<{ id: string; url: string }> {
  const m = await requestMaterial(masterKey, opts.title, opts.note)
  const folder = await api<{ id: string }>("/api/folders", {
    body: { encName: toB64(await sealName(masterKey, opts.title || t("Received files"))) },
  })
  try {
    await api("/api/requests", {
      body: {
        ...m.stored,
        folderId: folder.id,
        maxFiles: opts.maxFiles ?? undefined,
        maxBytes: opts.maxBytes ?? undefined,
        maxFileSize: opts.maxFileSize ?? undefined,
        expiresIn: opts.expiresIn ?? undefined,
      },
    })
  } catch (e) {
    void api(`/api/folders/${folder.id}`, { method: "DELETE" }).catch(() => {})
    throw e
  }
  return { id: m.id, url: requestUrl(m.id, m.secret) }
}

/** What a folder link's manifest tells its holders so that they can add files to the folder. */
export type LinkUpload = { requestId: string; access: string; publicKey: string }

/**
 * Prepares the request that stands behind a folder link whose holders may add
 * files. The link's manifest carries `upload`; once the link exists, `attach`
 * registers the request against it.
 */
export async function linkRequest(masterKey: CryptoKey, folderId: string, folderName: string) {
  const m = await requestMaterial(masterKey, folderName, "")
  const upload: LinkUpload = { requestId: m.id, access: toB64(m.access), publicKey: toB64(m.publicKey) }
  const attach = (shareId: string, expiresIn: number | null) =>
    api("/api/requests", { body: { ...m.stored, folderId, shareId, expiresIn: expiresIn ?? undefined } })
  return { upload, attach }
}

// ------------------------------------------------------------ uploader side

/** A request as someone holding its link sees it. */
export type OpenRequest = {
  id: string
  title: string
  note: string
  maxFileSize: number
  filesLeft?: number
  bytesLeft?: number
  expiresAt?: number
  access: Uint8Array<ArrayBuffer>
  publicKey: Uint8Array<ArrayBuffer>
}

export class BadRequestLink extends Error {}

/**
 * Looks a request up and opens its description with the secret from the link.
 * Throws BadRequestLink when the secret is missing or is not this request's.
 */
export async function openRequest(id: string, fragment: string): Promise<OpenRequest> {
  const pub = await api<RequestPublic>(`/api/r/${encodeURIComponent(id)}`)
  const secret = b32decode(fragment)
  if (!secret || secret.length !== REQUEST_SECRET_BYTES || normalizeCode(fragment).length !== 26) throw new BadRequestLink()
  const keys = await requestLinkKeys(secret)
  let info: RequestInfo
  try {
    info = await openRequestInfo(keys, fromB64(pub.encInfo), id)
  } catch {
    throw new BadRequestLink()
  }
  return {
    id,
    title: info.title,
    note: info.note,
    maxFileSize: pub.maxFileSize,
    filesLeft: pub.filesLeft,
    bytesLeft: pub.bytesLeft,
    expiresAt: pub.expiresAt,
    access: keys.access,
    publicKey: fromB64(info.publicKey),
  }
}

/** Encrypts a file in this browser and uploads it into the request owner's drive. */
export function uploadToRequest(
  req: OpenRequest,
  file: File,
  sender: { from?: string; note?: string },
  onProgress?: Progress,
  signal?: AbortSignal
) {
  return storeItem({
    kind: "file",
    name: file.name,
    type: file.type,
    blob: file,
    request: { id: req.id, access: req.access, publicKey: req.publicKey, from: sender.from, note: sender.note },
    onProgress,
    signal,
  })
}
