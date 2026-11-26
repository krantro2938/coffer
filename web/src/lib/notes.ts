import { api } from "./api"
import { CHUNK_SIZE, itemKeys, randomBytes, sealChunk, sealMeta, toB64, wrapFileKey, wrapForShare } from "./crypto"
import { linkWrapKey } from "./bundle"
import type { DItem, DShare } from "./drive"

/** The most a note may hold; the server takes it as a single chunk. */
export const MAX_NOTE_BYTES = 1 << 20

/** Whether a note's share link can be carried over to its edited text. */
export const canCarryOver = (s: DShare) => !!s.secret && (!!s.encWrap || !s.hasPassword)

/**
 * Replaces what a note holds, keeping its entry: same id, folder and date. The
 * text is sealed under a fresh key (a key is never used for two different
 * texts) and that key is re-wrapped for each of the note's links. Returns how
 * many links could not be carried over and were revoked.
 */
export async function replaceNote(opts: {
  item: DItem
  name: string
  text: string
  masterKey: CryptoKey
  shares: DShare[]
}): Promise<{ revoked: number }> {
  const { item, masterKey } = opts
  const plain = new TextEncoder().encode(opts.text)
  if (plain.length > Math.min(MAX_NOTE_BYTES, CHUNK_SIZE)) throw new Error("That note is too long to edit here")
  const fileKey = randomBytes(32)
  const keys = await itemKeys(fileKey)
  const links: Record<string, string> = {}
  for (const share of opts.shares) {
    const wrap = await linkWrapKey(share, masterKey)
    if (wrap) links[share.id] = toB64(await wrapForShare(wrap, fileKey, item.id))
  }
  const res = await api<{ revoked: number }>(`/api/items/${item.id}/content`, {
    method: "PUT",
    body: {
      encMeta: toB64(await sealMeta(keys, { name: opts.name, type: "text/plain", size: plain.length, v: 1 }, item.id)),
      wrappedKey: toB64(await wrapFileKey(masterKey, fileKey, item.id)),
      data: toB64(await sealChunk(keys.content, 0, true, plain)),
      links,
    },
  })
  return { revoked: res.revoked }
}
