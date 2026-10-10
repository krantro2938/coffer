/**
 * Coffer's end-to-end encryption. Everything here runs in the browser; the
 * server only ever receives ciphertext, wrapped keys and one-way hashes.
 *
 *   password ──Argon2id──► stretched ──HKDF──► authKey (sent, peppered+hashed by server)
 *                                     └─HKDF──► KEK ──wraps──► master key (random, per account)
 *   master key ──wraps──► file key (random, per item) ──HKDF──► content key / meta key
 *   link secret (+ optional password) ──HKDF──► share wrap key / access token
 *
 * File requests run the other way: someone without an account encrypts for an
 * account. Each request has a P-256 key pair; the uploader does an ephemeral
 * ECDH against its public key and wraps the file key under the result (ECIES):
 *
 *   ephemeral key ──ECDH(request public key)──HKDF──► wraps ──► file key
 *   request private key ◄──wrapped by── master key
 *   request link secret ──HKDF──► info key (title, public key) / upload token
 *
 * Content is split into fixed-size chunks sealed with AES-256-GCM. Each chunk's
 * nonce encodes its index and a "last chunk" flag, so chunks cannot be
 * reordered, dropped or truncated without detection.
 */
import { argon2id } from "hash-wasm"
import { t } from "./i18n"

const te = new TextEncoder()
const td = new TextDecoder()

export type KdfParams = { alg: "argon2id"; m: number; t: number; p: number }
export const KDF_DEFAULT: KdfParams = { alg: "argon2id", m: 65536, t: 3, p: 1 }
export const CHUNK_SIZE = 4 * 1024 * 1024
export const GCM_TAG = 16

// ---------------------------------------------------------------- encodings

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function toB64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Crockford base32 (lowercase): no i, l, o, u — easy to read aloud and retype. */
const B32 = "0123456789abcdefghjkmnpqrstvwxyz"

export function b32encode(bytes: Uint8Array): string {
  let out = ""
  let buf = 0
  let bits = 0
  for (const b of bytes) {
    buf = (buf << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(buf >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(buf << (5 - bits)) & 31]
  return out
}

/** Normalises what people type: case, spaces, dashes and look-alike letters. */
export function normalizeCode(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/o/g, "0")
    .replace(/[il]/g, "1")
}

export function b32decode(input: string): Uint8Array<ArrayBuffer> | null {
  const s = normalizeCode(input)
  const out: number[] = []
  let buf = 0
  let bits = 0
  for (const ch of s) {
    const v = B32.indexOf(ch)
    if (v < 0) return null
    buf = (buf << 5) | v
    bits += 5
    if (bits >= 8) {
      out.push((buf >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export function randomId(len: number): string {
  return Array.from(randomBytes(len), (b) => B32[b & 31]).join("")
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

// --------------------------------------------------------------- primitives

async function hkdf(ikm: Uint8Array<ArrayBuffer>, info: string): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: te.encode(info) }, k, 256)
  return new Uint8Array(bits)
}

function aesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"])
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data))
}

/** AES-256-GCM with a random nonce. Output: nonce ‖ ciphertext ‖ tag. */
async function seal(key: CryptoKey, data: Uint8Array<ArrayBuffer>, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(aad) }, key, data)
  return concat(iv, new Uint8Array(ct))
}

async function unseal(key: CryptoKey, sealed: Uint8Array<ArrayBuffer>, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  if (sealed.length < 12 + GCM_TAG) throw new DecryptError()
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.subarray(0, 12), additionalData: te.encode(aad) },
      key,
      sealed.subarray(12)
    )
    return new Uint8Array(pt)
  } catch {
    throw new DecryptError()
  }
}

export class DecryptError extends Error {
  constructor() {
    super(t("Decryption failed — wrong key or tampered data"))
  }
}

/** Argon2id password stretching (runs in WebAssembly). */
export function stretch(password: string, salt: Uint8Array, kdf: KdfParams): Promise<Uint8Array<ArrayBuffer>> {
  return argon2id({
    password: password.normalize("NFKC"),
    salt,
    parallelism: kdf.p,
    iterations: kdf.t,
    memorySize: kdf.m,
    hashLength: 32,
    outputType: "binary",
  }) as Promise<Uint8Array<ArrayBuffer>>
}

// ------------------------------------------------------------------ account

export type AccountKeys = { authKey: Uint8Array<ArrayBuffer>; kek: CryptoKey }

export async function accountKeys(password: string, salt: Uint8Array, kdf: KdfParams): Promise<AccountKeys> {
  const root = await stretch(password, salt, kdf)
  const [authKey, kekRaw] = await Promise.all([hkdf(root, "coffer/v1/account/auth"), hkdf(root, "coffer/v1/account/kek")])
  return { authKey, kek: await aesKey(kekRaw) }
}

/** Recovery keys are 256 random bits, so no stretching is needed. */
export async function recoveryKeys(recovery: Uint8Array<ArrayBuffer>): Promise<AccountKeys> {
  const [authKey, kekRaw] = await Promise.all([hkdf(recovery, "coffer/v1/recovery/auth"), hkdf(recovery, "coffer/v1/recovery/kek")])
  return { authKey, kek: await aesKey(kekRaw) }
}

export function formatRecoveryKey(bytes: Uint8Array): string {
  return (b32encode(bytes).match(/.{1,4}/g) ?? []).join("-").toUpperCase()
}

export function wrapMasterKey(kek: CryptoKey, raw: Uint8Array<ArrayBuffer>) {
  return seal(kek, raw, "coffer/v1/master-key")
}

export function unwrapMasterKeyRaw(kek: CryptoKey, wrapped: Uint8Array<ArrayBuffer>) {
  return unseal(kek, wrapped, "coffer/v1/master-key")
}

/** Imports the master key as non-extractable: page scripts can use it but never read it. */
export function importMasterKey(raw: Uint8Array<ArrayBuffer>) {
  return aesKey(raw)
}

export async function sealName(mk: CryptoKey, name: string) {
  return seal(mk, te.encode(name), "coffer/v1/folder-name")
}

export async function sealShareSecret(mk: CryptoKey, secret: string) {
  return seal(mk, te.encode(secret), "coffer/v1/share-secret")
}

export async function openShareSecret(mk: CryptoKey, sealed: Uint8Array<ArrayBuffer>) {
  return td.decode(await unseal(mk, sealed, "coffer/v1/share-secret"))
}

export async function openName(mk: CryptoKey, sealed: Uint8Array<ArrayBuffer>) {
  return td.decode(await unseal(mk, sealed, "coffer/v1/folder-name"))
}

// -------------------------------------------------------------------- items

export type ItemKind = "file" | "text" | "bundle"

/** `folderId` ties a folder-share manifest ("bundle") back to the folder it snapshots. */
export type ItemMeta = {
  name: string
  type: string
  size: number
  v: 1
  folderId?: string
  /** On a folder-share manifest: a digest of what it lists, to tell when it is out of date. */
  digest?: string
  /** On a file that came in through a request: what the uploader chose to say. */
  from?: string
  note?: string
}

export type ItemKeys = { content: CryptoKey; meta: CryptoKey }

export async function itemKeys(fileKey: Uint8Array<ArrayBuffer>): Promise<ItemKeys> {
  const [c, m] = await Promise.all([hkdf(fileKey, "coffer/v1/item/content"), hkdf(fileKey, "coffer/v1/item/meta")])
  return { content: await aesKey(c), meta: await aesKey(m) }
}

export function wrapFileKey(mk: CryptoKey, fileKey: Uint8Array<ArrayBuffer>, itemId: string) {
  return seal(mk, fileKey, `coffer/v1/item-key/${itemId}`)
}

export function unwrapFileKey(mk: CryptoKey, wrapped: Uint8Array<ArrayBuffer>, itemId: string) {
  return unseal(mk, wrapped, `coffer/v1/item-key/${itemId}`)
}

export function sealMeta(keys: ItemKeys, meta: ItemMeta, itemId: string) {
  return seal(keys.meta, te.encode(JSON.stringify(meta)), `coffer/v1/meta/${itemId}`)
}

export async function openMeta(keys: ItemKeys, sealed: Uint8Array<ArrayBuffer>, itemId: string): Promise<ItemMeta> {
  return JSON.parse(td.decode(await unseal(keys.meta, sealed, `coffer/v1/meta/${itemId}`)))
}

function chunkNonce(index: number, last: boolean): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12)
  new DataView(iv.buffer).setBigUint64(0, BigInt(index))
  iv[11] = last ? 1 : 0
  return iv
}

export async function sealChunk(key: CryptoKey, index: number, last: boolean, data: Uint8Array<ArrayBuffer>) {
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: chunkNonce(index, last) }, key, data)
  return new Uint8Array(ct)
}

export async function openChunk(key: CryptoKey, index: number, last: boolean, data: Uint8Array<ArrayBuffer>) {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: chunkNonce(index, last) }, key, data)
    return new Uint8Array(pt)
  } catch {
    throw new DecryptError()
  }
}

// ------------------------------------------------------------------- shares

export const SHARE_SECRET_BYTES = 10 // 80 bits → 16 base32 characters

/** `wrapRaw` is the wrap key's bytes, which a link's owner keeps (sealed) to re-wrap for it later. */
export type ShareKeys = { wrap: CryptoKey; access: Uint8Array<ArrayBuffer>; wrapRaw: Uint8Array<ArrayBuffer> }

export async function shareKeys(secret: Uint8Array<ArrayBuffer>, passwordKey?: Uint8Array<ArrayBuffer>): Promise<ShareKeys> {
  const ikm = passwordKey ? concat(secret, passwordKey) : secret
  const [wrap, access] = await Promise.all([hkdf(ikm, "coffer/v1/share/wrap"), hkdf(ikm, "coffer/v1/share/access")])
  return { wrap: await aesKey(wrap), access, wrapRaw: wrap }
}

export function sealShareWrap(mk: CryptoKey, wrapRaw: Uint8Array<ArrayBuffer>, shareSecret: string) {
  return seal(mk, wrapRaw, `coffer/v1/share-wrap/${shareSecret}`)
}

/** The key a link wraps with, for its owner: enough to point the link at something new, not to open it. */
export async function openShareWrap(mk: CryptoKey, sealed: Uint8Array<ArrayBuffer>, shareSecret: string) {
  return aesKey(await unseal(mk, sealed, `coffer/v1/share-wrap/${shareSecret}`))
}

export function wrapForShare(wrap: CryptoKey, fileKey: Uint8Array<ArrayBuffer>, itemId: string) {
  return seal(wrap, fileKey, `coffer/v1/share-key/${itemId}`)
}

export function unwrapFromShare(wrap: CryptoKey, wrapped: Uint8Array<ArrayBuffer>, itemId: string) {
  return unseal(wrap, wrapped, `coffer/v1/share-key/${itemId}`)
}

export function wrapShareKey(keys: ShareKeys, fileKey: Uint8Array<ArrayBuffer>, itemId: string) {
  return seal(keys.wrap, fileKey, `coffer/v1/share-key/${itemId}`)
}

export function unwrapShareKey(keys: ShareKeys, wrapped: Uint8Array<ArrayBuffer>, itemId: string) {
  return unseal(keys.wrap, wrapped, `coffer/v1/share-key/${itemId}`)
}

export function formatSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join("-")
}

// ------------------------------------------------------------ file requests

export const REQUEST_SECRET_BYTES = 16 // 128 bits → 26 base32 characters

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const
const P256_PUBLIC_BYTES = 65 // uncompressed point

/** What the request's link shows an uploader. Sealed under the link secret, so the server can neither read nor replace it. */
export type RequestInfo = { v: 1; title: string; note: string; publicKey: string }

export type RequestLinkKeys = { info: CryptoKey; access: Uint8Array<ArrayBuffer> }

export async function requestLinkKeys(secret: Uint8Array<ArrayBuffer>): Promise<RequestLinkKeys> {
  const [info, access] = await Promise.all([hkdf(secret, "coffer/v1/request/info"), hkdf(secret, "coffer/v1/request/access")])
  return { info: await aesKey(info), access }
}

export function sealRequestInfo(keys: RequestLinkKeys, info: RequestInfo, requestId: string) {
  return seal(keys.info, te.encode(JSON.stringify(info)), `coffer/v1/request-info/${requestId}`)
}

export async function openRequestInfo(keys: RequestLinkKeys, sealed: Uint8Array<ArrayBuffer>, requestId: string): Promise<RequestInfo> {
  return JSON.parse(td.decode(await unseal(keys.info, sealed, `coffer/v1/request-info/${requestId}`)))
}

export function sealRequestSecret(mk: CryptoKey, secret: string, requestId: string) {
  return seal(mk, te.encode(secret), `coffer/v1/request-secret/${requestId}`)
}

export async function openRequestSecret(mk: CryptoKey, sealed: Uint8Array<ArrayBuffer>, requestId: string) {
  return td.decode(await unseal(mk, sealed, `coffer/v1/request-secret/${requestId}`))
}

/** A fresh key pair for a request: the public half raw, the private half sealed to the owner. */
export async function newRequestKeys(mk: CryptoKey, requestId: string) {
  const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))
  const encPrivate = await seal(mk, pkcs8, `coffer/v1/request-private/${requestId}`)
  pkcs8.fill(0)
  return { publicKey, encPrivate }
}

/** Imports a request's private key as non-extractable. */
export async function openRequestPrivate(mk: CryptoKey, sealed: Uint8Array<ArrayBuffer>, requestId: string) {
  const pkcs8 = await unseal(mk, sealed, `coffer/v1/request-private/${requestId}`)
  try {
    return await crypto.subtle.importKey("pkcs8", pkcs8, ECDH, false, ["deriveBits"])
  } finally {
    pkcs8.fill(0)
  }
}

/** The key both ends of the ECDH arrive at, bound to the request, the item and both public keys. */
async function requestWrapKey(
  priv: CryptoKey,
  pub: Uint8Array<ArrayBuffer>,
  ephemeral: Uint8Array<ArrayBuffer>,
  recipient: Uint8Array<ArrayBuffer>,
  requestId: string,
  itemId: string
) {
  let shared: Uint8Array<ArrayBuffer>
  try {
    const peer = await crypto.subtle.importKey("raw", pub, ECDH, false, [])
    shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, priv, 256))
  } catch {
    throw new DecryptError()
  }
  const raw = await hkdf(shared, `coffer/v1/request/key/${requestId}/${itemId}/${toB64(ephemeral)}/${toB64(recipient)}`)
  shared.fill(0)
  return aesKey(raw)
}

/** Seals a file key so that only the request's owner can open it. Output: ephemeral public key ‖ nonce ‖ ciphertext ‖ tag. */
export async function sealToRequest(
  publicKey: Uint8Array<ArrayBuffer>,
  fileKey: Uint8Array<ArrayBuffer>,
  requestId: string,
  itemId: string
) {
  const eph = await crypto.subtle.generateKey(ECDH, false, ["deriveBits"])
  const ephPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey))
  const key = await requestWrapKey(eph.privateKey, publicKey, ephPublic, publicKey, requestId, itemId)
  return concat(ephPublic, await seal(key, fileKey, `coffer/v1/request-key/${itemId}`))
}

export async function openFromRequest(
  privateKey: CryptoKey,
  publicKey: Uint8Array<ArrayBuffer>,
  sealed: Uint8Array<ArrayBuffer>,
  requestId: string,
  itemId: string
) {
  if (sealed.length <= P256_PUBLIC_BYTES) throw new DecryptError()
  const ephPublic = sealed.slice(0, P256_PUBLIC_BYTES)
  const key = await requestWrapKey(privateKey, ephPublic, ephPublic, publicKey, requestId, itemId)
  return unseal(key, sealed.slice(P256_PUBLIC_BYTES), `coffer/v1/request-key/${itemId}`)
}
