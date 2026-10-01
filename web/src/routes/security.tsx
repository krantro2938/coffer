import { createFileRoute } from "@tanstack/react-router"
import { SiteFooter, SiteHeader } from "@/components/site-header"
import { useI18n } from "@/lib/i18n"

export const Route = createFileRoute("/security")({ component: Security })

const sections = [
  {
    title: "Everything is encrypted before upload",
    body: "Each file or note gets its own random 256-bit key. Content is split into 4 MB chunks and sealed with AES-256-GCM in your browser. Chunk nonces encode position and a final-chunk flag, so the server can't reorder, drop or truncate data without detection. File names, types and sizes are encrypted separately.",
  },
  {
    title: "Share links carry the key",
    body: "A link looks like /s/k7m3xq2#h4c9w2pz8rtf6mxn. The part after # is an 80-bit secret that browsers never send to servers. From it we derive two things: a key that unwraps the file key, and an access token. The server only stores a SHA-256 hash of that token, so it can check a recipient without being able to decrypt anything.",
  },
  {
    title: "Folders are shared as sealed snapshots",
    body: "Sharing a folder encrypts a manifest of its files — names, paths and each file's key — under a fresh link key. The server only learns which encrypted items that link is allowed to serve, so a folder link can never be used to fetch anything else.",
  },
  {
    title: "Short links trade secrecy for convenience — only if you choose",
    body: "A \"short link only\" share is just /s/k7m3xq2 with no key in it, which is easy to read out or type. To make that work the server keeps the link key, so it isn't end-to-end encrypted. Add a password and the content stays unreadable to the server. Short ids are rate limited against guessing.",
  },
  {
    title: "Passwords add a second factor",
    body: "Password-protected links mix an Argon2id-stretched password (64 MiB, 3 passes) into the key derivation. Someone who intercepts the link still can't open it, and wrong guesses are rate limited and never burn a view.",
  },
  {
    title: "Your account password never leaves your device",
    body: "Signing in stretches your password with Argon2id locally and splits the result: an authentication key (which the server peppers and hashes) and a key-encryption key that unwraps your random master key. The server never learns your password or your master key. Changing your password only re-seals the master key.",
  },
  {
    title: "Recovery without a back door",
    body: "At sign-up you receive a 256-bit recovery key. It independently wraps your master key, so you can reset a forgotten password. Lose both, and your data is gone — no one, including the operator, can recover it.",
  },
  {
    title: "Hardened server",
    body: "Strict Content-Security-Policy with hashed inline scripts, no third-party requests, HttpOnly SameSite=Strict session cookies, CSRF headers, no-referrer policy, rate limits on sign-in and link access, and a janitor that deletes expired and burned data every minute.",
  },
]

function Security() {
  const { t } = useI18n()
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <p className="eyebrow">{t("Security model")}</p>
        <h1 className="mt-3 text-4xl font-medium sm:text-5xl">{t("How Coffer keeps your data unreadable.")}</h1>
        <p className="mt-5 text-lg text-muted-foreground">
          {t("Coffer is designed so that a complete compromise of the server — database, disks and code on disk — reveals nothing about what you've stored or shared.")}
        </p>
        <ol className="mt-12 grid gap-4">
          {sections.map((s, i) => (
            <li key={s.title} className="grid gap-3 rounded-2xl border bg-card p-6 sm:grid-cols-[3rem_1fr]">
              <span className="font-mono text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h2 className="text-lg font-medium">{t(s.title)}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(s.body)}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-10 rounded-2xl bg-secondary p-5 text-sm text-secondary-foreground">
          <strong className="font-medium">{t("One honest caveat:")}</strong>{" "}
          {t("end-to-end encryption in a web app relies on the server delivering honest JavaScript. Self-host Coffer, pin your image version and serve it over HTTPS.")}
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}
