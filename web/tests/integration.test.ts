/**
 * End-to-end test against a running Coffer server:
 *   COFFER_URL=http://127.0.0.1:8080 npx vitest run tests/integration.test.ts
 * Exercises the real browser crypto code (WebCrypto + Argon2id) and the API.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { api, type DriveData, type ShareOpen, type ShareInfo } from "@/lib/api"
import {
  accountKeys, b32decode, fromB64, itemKeys, KDF_DEFAULT, openMeta, randomBytes, shareKeys, stretch, toB64,
  unwrapFileKey, unwrapMasterKeyRaw, importMasterKey, wrapMasterKey, recoveryKeys, CHUNK_SIZE,
} from "@/lib/crypto"
import { createShare, downloadToBlob, storeItem } from "@/lib/transfer"

const BASE = process.env.COFFER_URL
const run = BASE ? describe : describe.skip

let cookie = ""
beforeAll(() => {
  if (!BASE) return
  ;(globalThis as any).location = { origin: BASE }
  const real = globalThis.fetch
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === "string" && input.startsWith("/") ? BASE + input : input
    const headers = new Headers(init.headers)
    if (cookie) headers.set("Cookie", cookie)
    const res = await real(url, { ...init, headers })
    const set = res.headers.get("set-cookie")
    if (set) cookie = set.split(";")[0]
    return res
  }) as typeof fetch
})

async function openShare(url: string, password?: string, item?: { id: string; key: string; chunkSize: number; chunkCount: number; cipherSize: number }) {
  const [, id, frag] = url.match(/\/s\/(\w+)(?:#(\w+))?/)!
  const info = await api<ShareInfo>(`/api/s/${id}`)
  const secret = frag ?? info.secret!
  const pwKey = info.hasPassword ? await stretch(password!, fromB64(info.pwSalt!), info.pwKdf!) : undefined
  const keys = await shareKeys(b32decode(secret)!, pwKey)
  const open = await api<ShareOpen>(`/api/s/${id}/open`, { body: { access: toB64(keys.access) } })
  const { unwrapShareKey } = await import("@/lib/crypto")
  const fileKey = await unwrapShareKey(keys, fromB64(open.wrappedKey), open.itemId)
  const meta = await openMeta(await itemKeys(fileKey), fromB64(open.encMeta), open.itemId)
  const blob = await downloadToBlob({
    url: `/api/s/${id}/blob`, headers: { "X-Ticket": open.ticket }, fileKey,
    chunkSize: open.chunkSize, chunkCount: open.chunkCount, size: open.size, type: meta.type,
  })
  let file: Blob | undefined
  if (item) {
    file = await downloadToBlob({
      url: `/api/s/${id}/blob?item=${item.id}`, headers: { "X-Ticket": open.ticket }, fileKey: fromB64(item.key),
      chunkSize: item.chunkSize, chunkCount: item.chunkCount, size: item.cipherSize, type: "",
    })
  }
  return { meta, blob, open, file }
}

run("coffer end-to-end", () => {
  it("anonymous text drop with burn-after-read and password", async () => {
    cookie = ""
    const secretText = "hunter2 — the launch codes 🚀"
    const stored = await storeItem({ kind: "text", name: "note", type: "text/plain", blob: new Blob([secretText]), expiresIn: 3600 })
    const share = await createShare(stored.id, stored.fileKey, { password: "correct horse", maxViews: 1 }, { manageToken: stored.manageToken })
    expect(share.id).toMatch(/^[0-9a-z]{7}$/)

    await expect(openShare(share.url, "wrong")).rejects.toThrow(/wrong password/)
    const { blob, open } = await openShare(share.url, "correct horse")
    expect(await blob.text()).toBe(secretText)
    expect(open.burned).toBe(true)
    await expect(openShare(share.url, "correct horse")).rejects.toThrow(/does not exist/)
  }, 60_000)

  it("account: register, multi-chunk upload, share, download, password change", async () => {
    cookie = ""
    const email = `t${Date.now()}@example.com`
    const salt = randomBytes(16)
    const keys = await accountKeys("pw-one-1234567", salt, KDF_DEFAULT)
    const mkRaw = randomBytes(32)
    const rk = await recoveryKeys(randomBytes(32))
    await api("/api/auth/register", { body: {
      email, salt: toB64(salt), kdf: KDF_DEFAULT, authKey: toB64(keys.authKey),
      wrappedMasterKey: toB64(await wrapMasterKey(keys.kek, mkRaw.slice())),
      recoveryAuthKey: toB64(rk.authKey), recoveryWrappedMasterKey: toB64(await wrapMasterKey(rk.kek, mkRaw.slice())),
    } })
    const mk = await importMasterKey(mkRaw.slice())

    // 2.5 chunks of pseudo-random data
    const data = new Uint8Array(CHUNK_SIZE * 2 + 12345)
    for (let i = 0; i < data.length; i += 65536) crypto.getRandomValues(data.subarray(i, i + 65536))
    const stored = await storeItem({ kind: "file", name: "big.bin", type: "application/octet-stream", blob: new Blob([data]), masterKey: mk })

    const drive = await api<DriveData>("/api/drive")
    const row = drive.items.find((i) => i.id === stored.id)!
    expect(row.chunkCount).toBe(3)
    const fk = await unwrapFileKey(mk, fromB64(row.wrappedKey), row.id)
    const meta = await openMeta(await itemKeys(fk), fromB64(row.encMeta), row.id)
    expect(meta.name).toBe("big.bin")

    const own = await downloadToBlob({ url: `/api/items/${row.id}/blob`, fileKey: fk, chunkSize: row.chunkSize, chunkCount: row.chunkCount, size: row.size, type: "" })
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(data)

    const share = await createShare(stored.id, fk, { maxViews: 5, expiresIn: 3600 }, { masterKey: mk })
    const shareCookie = cookie
    cookie = ""
    const got = await openShare(share.url)
    expect(new Uint8Array(await got.blob.arrayBuffer())).toEqual(data)
    expect(got.open.viewsLeft).toBe(4)
    cookie = shareCookie

    // Folder link: an encrypted manifest plus the files it may serve.
    const manifest = { v: 1, name: "Folder", createdAt: 0, files: [{
      id: row.id, path: "sub/big.bin", name: "big.bin", type: "", size: data.length, key: toB64(fk),
      chunkSize: row.chunkSize, chunkCount: row.chunkCount, cipherSize: row.size,
    }] }
    const bundle = await storeItem({ kind: "bundle", name: "Folder", type: "application/x-coffer-bundle", blob: new Blob([JSON.stringify(manifest)]), masterKey: mk })
    const folderShare = await createShare(bundle.id, bundle.fileKey, { shortLink: true }, { masterKey: mk, itemIds: [row.id] })
    expect(folderShare.url).not.toContain("#")
    cookie = ""
    const fo = await openShare(folderShare.url, undefined, manifest.files[0])
    expect(JSON.parse(await fo.blob.text()).files[0].path).toBe("sub/big.bin")
    expect(new Uint8Array(await fo.file!.arrayBuffer())).toEqual(data)
    // A folder link must not serve files outside its manifest.
    const other = await storeItem({ kind: "text", name: "x", type: "text/plain", blob: new Blob(["nope"]), expiresIn: 3600 })
    const res = await fetch(`/api/s/${folderShare.id}/blob?item=${other.id}`, { headers: { "X-Ticket": fo.open.ticket } })
    expect(res.status).toBe(404)
    cookie = shareCookie

    // Server must never hold plaintext: the name should not appear in the drive JSON.
    expect(JSON.stringify(drive)).not.toContain("big.bin")

    // Change password, then log in with the new one and unwrap the same master key.
    const salt2 = randomBytes(16)
    const k2 = await accountKeys("pw-two-7654321", salt2, KDF_DEFAULT)
    await api("/api/auth/password", { body: {
      authKey: toB64(keys.authKey), salt: toB64(salt2), kdf: KDF_DEFAULT, newAuthKey: toB64(k2.authKey),
      wrappedMasterKey: toB64(await wrapMasterKey(k2.kek, mkRaw.slice())),
    } })
    cookie = ""
    await expect(api("/api/auth/login", { body: { email, authKey: toB64(keys.authKey) } })).rejects.toThrow(/incorrect/)
    const me = await api<{ wrappedMasterKey: string }>("/api/auth/login", { body: { email, authKey: toB64(k2.authKey) } })
    expect(await unwrapMasterKeyRaw(k2.kek, fromB64(me.wrappedMasterKey))).toEqual(mkRaw)
  }, 120_000)
})
