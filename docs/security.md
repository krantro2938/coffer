# Security model

What Coffer protects, how, and where the protection stops.

## The short version

- Files and notes are encrypted in the browser (AES-256-GCM, 4 MB chunks, per-file random keys). The
  server stores only ciphertext; names, types and sizes are encrypted too.
- Share links look like `/s/k7m3xq2#h4c9w2pz8rtf6mxn`. The fragment is an 80-bit secret the server never
  sees. Optional passwords are mixed in via Argon2id. The server keeps only a hash of a derived access token.
- Links can expire, burn after N views, and be revoked. Wrong passwords never consume a view.
- Folders are shared as an encrypted snapshot manifest; recipients can grab single files or a streamed `.zip`.
- Optional "short link only" mode (`/s/k7m3xq2`, no key in the URL): the server keeps the link key, so it is
  not end-to-end encrypted unless a password is also set.
- Accounts: the password is stretched with Argon2id on the device. It unwraps a random master key; the
  server gets a peppered hash of a derived auth key. A recovery key is issued at sign-up.
- Quick shares made without an account are remembered only in that browser, sealed with a key that never
  leaves it, so they can be cancelled later. The list holds no link secrets.
- Hardening: strict CSP with hashed inline scripts, HttpOnly SameSite=Strict cookies, CSRF header checks,
  rate limits, read-only non-root distroless container, janitor purging expired data every minute.

## Keys

Everything is encrypted in the browser with keys the server never receives in a usable form.

```
password ──Argon2id──► stretched ──HKDF──► auth key        (sent; the server stores a peppered hash)
                                  └─HKDF──► KEK ──wraps──► master key   (random, one per account)
master key ──wraps──► file key (random, one per item) ──HKDF──► content key, metadata key
link secret (+ optional password) ──HKDF──► share wrap key, access token
```

- **Content** is split into 4 MB chunks sealed with AES-256-GCM. Each chunk's nonce encodes its index and whether
  it is the last, so chunks cannot be reordered, dropped or cut short without the download failing.
- **Names, types and sizes** are sealed separately under a key derived from the same file key.
- **A share link** carries its secret after the `#`, which browsers do not send to servers. The file key is
  wrapped under a key derived from that secret; the server keeps the wrapped key and a hash of an access token
  derived from it, and hands the wrapped key only to someone who presents the token.

## File requests

A file request lets someone without an account encrypt for someone with one, so it uses public-key encryption.
The construction is ECIES over P-256, built only from WebCrypto primitives:

```
request key pair (P-256):  public half in the request's description, private half wrapped by the master key
uploader, per file:        ephemeral P-256 key ──ECDH(request public key)──HKDF-SHA-256──► wraps the file key
request link secret ──HKDF──► description key (title, note, public key), upload token
```

- The uploader's browser makes a fresh file key and a fresh ephemeral key pair for every file. Only the holder of
  the request's private key can recover the file key. That key is stored wrapped under the owner's master key and
  is never given to uploaders or, in usable form, to the server.
- The link is `/r/<id>#<secret>`. The secret opens the request's description, which is authenticated and carries
  the public key. A server that swapped in a public key of its own would have to forge that description, which
  it cannot do without the secret.
- An upload must present a token derived from the secret, so the id alone (from a log, say) uploads nothing.
- The link is upload-only. It cannot list, read or delete what came in, including what it uploaded itself: the
  token an upload gets is good for that upload's chunks and expires when the upload completes.
- Limits are enforced on the server and reserved when an upload starts: expiry, number of files, total size,
  size per file, and the space left in the owner's drive. Uploads racing for the last place cannot all get it.
  Uploads abandoned midway are deleted after a day.
- When the owner next opens their drive, their browser re-wraps each received file's key under the master key,
  after which the file is an ordinary drive item.

## Folder links

A folder link shares an encrypted manifest listing the folder's files and their keys. The server cannot write a
manifest, so a link follows its folder only while the owner's browser carries it: whenever the drive is open and a
shared folder has changed, the browser uploads a fresh manifest and points the link at it. Until then the link
shows the folder as it was. Password-protected folder links made before this existed stay snapshots.

A folder link can also let its holders **add files**. Such a link has a file request behind it, and its manifest
(readable only with the link) carries that request's public key and upload token. Someone adding a file encrypts
its key twice: to the request's public key, for the owner, and under the link's own key, so that everyone else
holding the link can open the file at once. Holders can add; they cannot change or delete what is there. Revoking
the link stops uploads through it.

## Signed-in browsers

An account can see the browsers it is signed in on and sign any of them out. For each session the server keeps the
browser's user-agent string and the times it was created and last used. It does not keep IP addresses.

## What it does not protect against

- **A malicious server serving altered code.** The cryptography runs in JavaScript delivered by the server. A
  compromised server could deliver code that leaks keys. This is true of every web application that encrypts in
  the browser; self-hosting, or checking that the code served matches this repository, is the remedy.
- **Short links.** A link without a key in it (`/s/k7m3xq2`) is opened by a secret the server keeps, so it is not
  end-to-end encrypted unless it also has a password.
- **Traffic analysis.** The server sees sizes, times, IP addresses, who owns what and how often a link is opened.
- **Untrusted uploads.** Files that arrive through a file request are whatever the uploader chose to send. Coffer
  cannot scan what it cannot read; treat them as you would an email attachment.
- **Sender identity.** The name an uploader gives with a file request is what they typed, nothing more.
- **A lost password and recovery key.** Nobody, including the operator, can recover that drive.
- **Rollback of a folder link.** A malicious server could keep serving an older manifest of a shared folder.
  It could not alter one or read it.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
