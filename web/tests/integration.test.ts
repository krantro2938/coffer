/**
 * End-to-end test against a running Coffer server:
 *   COFFER_URL=http://127.0.0.1:8080 npx vitest run tests/integration.test.ts
 * Exercises the real browser crypto code (WebCrypto + Argon2id) and the API.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { api, type AddedItem, type DriveData, type ShareOpen, type ShareInfo } from "@/lib/api"
import {
  accountKeys,
  b32decode,
  fromB64,
  itemKeys,
  KDF_DEFAULT,
  openMeta,
  randomBytes,
  shareKeys,
  stretch,
  toB64,
  sealName,
  unwrapFileKey,
  unwrapFromShare,
  wrapFileKey,
  unwrapMasterKeyRaw,
  importMasterKey,
  wrapMasterKey,
  recoveryKeys,
  CHUNK_SIZE,
} from "@/lib/crypto"
import { createShare, downloadToBlob, storeItem } from "@/lib/transfer"
import { refreshFolderLink, shareFiles, shareFolder, staleFolderLinks, type Manifest } from "@/lib/bundle"
import { decryptDrive } from "@/lib/drive"
import { BadRequestLink, createRequest, openRequest, uploadToRequest } from "@/lib/requests"

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

async function openShare(
  url: string,
  password?: string,
  item?: { id: string; key: string; chunkSize: number; chunkCount: number; cipherSize: number }
) {
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
    url: `/api/s/${id}/blob`,
    headers: { "X-Ticket": open.ticket },
    fileKey,
    chunkSize: open.chunkSize,
    chunkCount: open.chunkCount,
    size: open.size,
    type: meta.type,
  })
  let file: Blob | undefined
  if (item) {
    file = await downloadToBlob({
      url: `/api/s/${id}/blob?item=${item.id}`,
      headers: { "X-Ticket": open.ticket },
      fileKey: fromB64(item.key),
      chunkSize: item.chunkSize,
      chunkCount: item.chunkCount,
      size: item.cipherSize,
      type: "",
    })
  }
  return { meta, blob, open, file }
}

run("coffer end-to-end", () => {
  it("anonymous text drop with burn-after-read and password", async () => {
    cookie = ""
    const secretText = "hunter2 — the launch codes 🚀"
    const stored = await storeItem({ kind: "text", name: "note", type: "text/plain", blob: new Blob([secretText]), expiresIn: 3600 })
    const share = await createShare(
      stored.id,
      stored.fileKey,
      { password: "correct horse", maxViews: 1 },
      { manageToken: stored.manageToken }
    )
    expect(share.id).toMatch(/^[0-9a-z]{7}$/)

    await expect(openShare(share.url, "wrong")).rejects.toThrow(/wrong password/)
    const { blob, open } = await openShare(share.url, "correct horse")
    expect(await blob.text()).toBe(secretText)
    expect(open.burned).toBe(true)
    await expect(openShare(share.url, "correct horse")).rejects.toThrow(/does not exist/)
  }, 60_000)

  it("quick share of several files: one link, shared limits, cancelled as a whole", async () => {
    cookie = ""
    const config = await api<{ anonMaxFiles: number; anonMaxShareSize: number }>("/api/config")
    const files = ["alpha", "beta", "gamma"].map((n) => new File([`contents of ${n}`], `${n}.txt`, { type: "text/plain" }))
    const made = await shareFiles(files, { maxViews: 3 }, 3600)
    const manage = { "X-Manage-Token": made.manageToken }

    const first = await openShare(made.share.url)
    const manifest = JSON.parse(await first.blob.text()) as Manifest
    expect(manifest.files.map((f) => f.name)).toEqual(["alpha.txt", "beta.txt", "gamma.txt"])
    const got = await openShare(made.share.url, undefined, manifest.files[1])
    expect(await got.file!.text()).toBe("contents of beta")

    const status = await api<{ active: boolean; views: number; maxViews: number }>(`/api/items/${made.itemId}/status`, { headers: manage })
    expect(status).toMatchObject({ active: true, views: 2, maxViews: 3 })

    // The share keeps counting files and bytes for anything added under its token.
    for (let i = files.length; i < config.anonMaxFiles; i++) {
      await storeItem({ kind: "file", name: `extra${i}`, type: "", blob: new Blob(["x"]), manageToken: made.manageToken })
    }
    await expect(
      storeItem({ kind: "file", name: "one too many", type: "", blob: new Blob(["x"]), manageToken: made.manageToken })
    ).rejects.toThrow(/too many files/)
    // One byte over the limit is refused before anything is uploaded.
    const chunks = Math.ceil((config.anonMaxShareSize + 1) / (CHUNK_SIZE * 4))
    await expect(
      api("/api/items", {
        body: {
          id: "0".repeat(26),
          kind: "file",
          encMeta: toB64(randomBytes(40)),
          expiresIn: 3600,
          size: config.anonMaxShareSize + 1 + chunks * 16,
          chunkSize: CHUNK_SIZE * 4,
          chunkCount: chunks,
        },
      })
    ).rejects.toThrow(/more than a quick share can hold/)
    await expect(
      storeItem({ kind: "file", name: "stranger", type: "", blob: new Blob(["x"]), manageToken: "not-a-token" })
    ).rejects.toThrow(/not found/)

    // Cancelling removes every file, not just the manifest.
    await api(`/api/items/${made.itemId}`, { method: "DELETE", headers: manage })
    await expect(openShare(made.share.url)).rejects.toThrow(/does not exist/)
    await expect(api(`/api/items/${manifest.files[0].id}/status`, { headers: manage })).rejects.toThrow(/not found/)
  }, 60_000)

  it("account: register, multi-chunk upload, share, download, password change", async () => {
    cookie = ""
    const email = `t${Date.now()}@example.com`
    const salt = randomBytes(16)
    const keys = await accountKeys("pw-one-1234567", salt, KDF_DEFAULT)
    const mkRaw = randomBytes(32)
    const rk = await recoveryKeys(randomBytes(32))
    await api("/api/auth/register", {
      body: {
        email,
        salt: toB64(salt),
        kdf: KDF_DEFAULT,
        authKey: toB64(keys.authKey),
        wrappedMasterKey: toB64(await wrapMasterKey(keys.kek, mkRaw.slice())),
        recoveryAuthKey: toB64(rk.authKey),
        recoveryWrappedMasterKey: toB64(await wrapMasterKey(rk.kek, mkRaw.slice())),
      },
    })
    const mk = await importMasterKey(mkRaw.slice())

    // 2.5 chunks of pseudo-random data
    const data = new Uint8Array(CHUNK_SIZE * 2 + 12345)
    for (let i = 0; i < data.length; i += 65536) crypto.getRandomValues(data.subarray(i, i + 65536))
    const stored = await storeItem({
      kind: "file",
      name: "big.bin",
      type: "application/octet-stream",
      blob: new Blob([data]),
      masterKey: mk,
    })

    const drive = await api<DriveData>("/api/drive")
    const row = drive.items.find((i) => i.id === stored.id)!
    expect(row.chunkCount).toBe(3)
    const fk = await unwrapFileKey(mk, fromB64(row.wrappedKey!), row.id)
    const meta = await openMeta(await itemKeys(fk), fromB64(row.encMeta), row.id)
    expect(meta.name).toBe("big.bin")

    const own = await downloadToBlob({
      url: `/api/items/${row.id}/blob`,
      fileKey: fk,
      chunkSize: row.chunkSize,
      chunkCount: row.chunkCount,
      size: row.size,
      type: "",
    })
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(data)

    const share = await createShare(stored.id, fk, { maxViews: 5, expiresIn: 3600 }, { masterKey: mk })
    const shareCookie = cookie
    cookie = ""
    const got = await openShare(share.url)
    expect(new Uint8Array(await got.blob.arrayBuffer())).toEqual(data)
    expect(got.open.viewsLeft).toBe(4)
    cookie = shareCookie

    // Folder link: an encrypted manifest plus the files it may serve.
    const manifest = {
      v: 1,
      name: "Folder",
      createdAt: 0,
      files: [
        {
          id: row.id,
          path: "sub/big.bin",
          name: "big.bin",
          type: "",
          size: data.length,
          key: toB64(fk),
          chunkSize: row.chunkSize,
          chunkCount: row.chunkCount,
          cipherSize: row.size,
        },
      ],
    }
    const bundle = await storeItem({
      kind: "bundle",
      name: "Folder",
      type: "application/x-coffer-bundle",
      blob: new Blob([JSON.stringify(manifest)]),
      masterKey: mk,
    })
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
    await api("/api/auth/password", {
      body: {
        authKey: toB64(keys.authKey),
        salt: toB64(salt2),
        kdf: KDF_DEFAULT,
        newAuthKey: toB64(k2.authKey),
        wrappedMasterKey: toB64(await wrapMasterKey(k2.kek, mkRaw.slice())),
      },
    })
    cookie = ""
    await expect(api("/api/auth/login", { body: { email, authKey: toB64(keys.authKey) } })).rejects.toThrow(/incorrect/)
    const me = await api<{ wrappedMasterKey: string }>("/api/auth/login", { body: { email, authKey: toB64(k2.authKey) } })
    expect(await unwrapMasterKeyRaw(k2.kek, fromB64(me.wrappedMasterKey))).toEqual(mkRaw)
  }, 120_000)

  it("file request: anyone can upload, only the owner can read; a folder link follows its folder", async () => {
    cookie = ""
    const salt = randomBytes(16)
    const keys = await accountKeys("pw-requests-123", salt, KDF_DEFAULT)
    const mkRaw = randomBytes(32)
    const rk = await recoveryKeys(randomBytes(32))
    await api("/api/auth/register", {
      body: {
        email: `r${Date.now()}@example.com`,
        salt: toB64(salt),
        kdf: KDF_DEFAULT,
        authKey: toB64(keys.authKey),
        wrappedMasterKey: toB64(await wrapMasterKey(keys.kek, mkRaw.slice())),
        recoveryAuthKey: toB64(rk.authKey),
        recoveryWrappedMasterKey: toB64(await wrapMasterKey(rk.kek, mkRaw.slice())),
      },
    })
    const mk = await importMasterKey(mkRaw.slice())
    const loadDrive = async () => decryptDrive(mk, await api<DriveData>("/api/drive"))

    const made = await createRequest(mk, {
      title: "Papers",
      note: "By Friday, please",
      expiresIn: 3600,
      maxFiles: 2,
      maxFileSize: null,
      maxBytes: null,
    })
    const owner = cookie

    // Someone with the link and no account.
    cookie = ""
    const [, id, frag] = made.url.match(/\/r\/(\w+)#(\w+)/)!
    const req = await openRequest(id, frag)
    expect(req.title).toBe("Papers")
    expect(req.note).toBe("By Friday, please")
    expect(req.filesLeft).toBe(2)
    // The id without the right secret opens nothing.
    await expect(openRequest(id, "0".repeat(26))).rejects.toBeInstanceOf(BadRequestLink)
    await expect(openRequest(id, "")).rejects.toBeInstanceOf(BadRequestLink)

    const data = randomBytes(5000)
    const sent = await uploadToRequest(req, new File([data], "scan.pdf", { type: "application/pdf" }), { from: "Bob", note: "Here you go" })
    // The upload gave the uploader nothing to read with.
    await expect(api(`/api/items/${sent.id}/blob`)).rejects.toMatchObject({ status: 401 })
    await expect(api("/api/drive")).rejects.toMatchObject({ status: 401 })

    cookie = owner
    let drive = await loadDrive()
    expect(drive.requests[0]).toMatchObject({ title: "Papers", received: 1, broken: false })
    let got = drive.items.find((i) => i.id === sent.id)!
    expect(got).toMatchObject({ name: "scan.pdf", from: "Bob", note: "Here you go", sealed: true, broken: false })
    expect(got.folderId).toBe(drive.requests[0].folderId)
    const blob = await downloadToBlob({
      url: `/api/items/${got.id}/blob`,
      fileKey: got.fileKey!,
      chunkSize: got.row.chunkSize,
      chunkCount: got.row.chunkCount,
      size: got.row.size,
      type: "",
    })
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data)

    // Re-wrapped under the master key, it is an ordinary drive item.
    await api(`/api/items/${got.id}/adopt`, { body: { wrappedKey: toB64(await wrapFileKey(mk, got.fileKey!, got.id)) } })
    drive = await loadDrive()
    got = drive.items.find((i) => i.id === sent.id)!
    expect(got).toMatchObject({ name: "scan.pdf", sealed: false, broken: false })

    // A link to the folder shows what is in it now...
    const folder = drive.folders.find((f) => f.id === got.folderId)!
    const link = await shareFolder(drive, folder, { expiresIn: 3600 }, mk)
    expect(await staleFolderLinks(await loadDrive())).toEqual([])

    // ...and, once another file arrives and the owner's browser has seen it, that one too.
    cookie = ""
    await uploadToRequest(req, new File([randomBytes(100)], "second.txt"), {})
    await expect(uploadToRequest(req, new File([randomBytes(100)], "third.txt"), {})).rejects.toMatchObject({ status: 413 })
    cookie = owner
    const stale = await staleFolderLinks(await loadDrive())
    expect(stale.length).toBe(1)
    expect(await refreshFolderLink(stale[0], mk)).toBe(true)
    expect(await staleFolderLinks(await loadDrive())).toEqual([])

    cookie = ""
    const opened = await openShare(link.url)
    const manifest = JSON.parse(await opened.blob.text()) as Manifest
    expect(manifest.files.map((f) => f.name).sort()).toEqual(["scan.pdf", "second.txt"])

    // Closed, the link takes nothing more.
    cookie = owner
    await api(`/api/requests/${id}/revoke`, { method: "POST" })
    cookie = ""
    await expect(openRequest(id, frag)).rejects.toMatchObject({ status: 410 })
  })

  it("a folder link that takes files: a guest adds one, another guest and the owner can open it", async () => {
    cookie = ""
    const salt = randomBytes(16)
    const keys = await accountKeys("pw-add-files-123", salt, KDF_DEFAULT)
    const mkRaw = randomBytes(32)
    const rk = await recoveryKeys(randomBytes(32))
    await api("/api/auth/register", {
      body: {
        email: `a${Date.now()}@example.com`,
        salt: toB64(salt),
        kdf: KDF_DEFAULT,
        authKey: toB64(keys.authKey),
        wrappedMasterKey: toB64(await wrapMasterKey(keys.kek, mkRaw.slice())),
        recoveryAuthKey: toB64(rk.authKey),
        recoveryWrappedMasterKey: toB64(await wrapMasterKey(rk.kek, mkRaw.slice())),
      },
    })
    const mk = await importMasterKey(mkRaw.slice())
    const loadDrive = async () => decryptDrive(mk, await api<DriveData>("/api/drive"))
    const made = await api<{ id: string }>("/api/folders", { body: { encName: toB64(await sealName(mk, "Shared")) } })
    let drive = await loadDrive()
    const folder = drive.folders.find((f) => f.id === made.id)!

    // An empty folder can be shared when the link takes files.
    await expect(shareFolder(drive, folder, { expiresIn: 3600 }, mk)).rejects.toThrow()
    const link = await shareFolder(drive, folder, { expiresIn: 3600 }, mk, true)
    const owner = cookie

    // A guest opens the link and adds a file.
    cookie = ""
    const [, id, frag] = link.url.match(/\/s\/(\w+)#(\w+)/)!
    const linkKeys = await shareKeys(b32decode(frag)!)
    const first = await openShare(link.url)
    const manifest = JSON.parse(await first.blob.text()) as Manifest
    expect(manifest.files).toEqual([])
    const up = manifest.upload!
    const data = randomBytes(7000)
    const sent = await storeItem({
      kind: "file",
      name: "from-guest.bin",
      type: "application/octet-stream",
      blob: new Blob([data]),
      request: { id: up.requestId, access: fromB64(up.access), publicKey: fromB64(up.publicKey), linkWrap: linkKeys.wrap },
    })

    // Someone else with the link sees it straight away and can open it.
    const second = await openShare(link.url)
    const added = await api<AddedItem[]>(`/api/s/${id}/added`, { headers: { "X-Ticket": second.open.ticket } })
    expect(added.map((a) => a.id)).toEqual([sent.id])
    const key = await unwrapFromShare(linkKeys.wrap, fromB64(added[0].linkKey), added[0].id)
    expect((await openMeta(await itemKeys(key), fromB64(added[0].encMeta), added[0].id)).name).toBe("from-guest.bin")
    const blob = await downloadToBlob({
      url: `/api/s/${id}/blob?item=${sent.id}`,
      headers: { "X-Ticket": second.open.ticket },
      fileKey: key,
      chunkSize: added[0].chunkSize,
      chunkCount: added[0].chunkCount,
      size: added[0].size,
      type: "",
    })
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data)

    // The owner finds it in the folder, readable, and the link's next manifest lists it and still takes files.
    cookie = owner
    drive = await loadDrive()
    expect(drive.items.find((i) => i.id === sent.id)).toMatchObject({ name: "from-guest.bin", folderId: folder.id, broken: false })
    const stale = await staleFolderLinks(drive)
    expect(stale.length).toBe(1)
    expect(await refreshFolderLink(stale[0], mk)).toBe(true)
    cookie = ""
    const third = await openShare(link.url)
    const refreshed = JSON.parse(await third.blob.text()) as Manifest
    expect(refreshed.files.map((f) => f.name)).toEqual(["from-guest.bin"])
    expect(refreshed.upload).toEqual(up)
    // Now that the manifest lists it, it is no longer reported as an addition.
    expect(await api<AddedItem[]>(`/api/s/${id}/added`, { headers: { "X-Ticket": third.open.ticket } })).toEqual([])
  })
})
