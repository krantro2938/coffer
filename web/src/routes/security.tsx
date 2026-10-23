import { createFileRoute } from "@tanstack/react-router"
import {
  CreditCardIcon,
  FileLockIcon,
  FolderLockIcon,
  InboxIcon,
  InfoIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  Link2Icon,
  LinkIcon,
  MonitorSmartphoneIcon,
  ServerIcon,
  type LucideIcon,
} from "lucide-react"
import { FileGlyph } from "@/components/file-glyph"
import { SiteFooter, SiteHeader } from "@/components/site-header"
import { usePlans, usePlansOpen } from "@/components/plans"
import { useI18n } from "@/lib/i18n"

// The server sends the same title and description with the page (server/internal/app/seo.go).
export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security model — Coffer" },
      {
        name: "description",
        content:
          "How Coffer keeps your files unreadable to its own server: what is encrypted, how links carry their keys, and where the protection stops.",
      },
    ],
  }),
  component: Security,
})

const sections: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: FileLockIcon,
    title: "Everything is encrypted before upload",
    body: "Each file or note gets its own random 256-bit key. Content is split into 4 MB chunks and sealed with AES-256-GCM in your browser. Chunk nonces encode position and a final-chunk flag, so the server can't reorder, drop or truncate data without detection. File names and types are encrypted separately. The server still sees how large each file is.",
  },
  {
    icon: LinkIcon,
    title: "Share links carry the key",
    body: "A link looks like /s/k7m3xq2#h4c9w2pz8rtf6mxn. The part after # is an 80-bit secret that browsers never send to servers. From it we derive two things: a key that unwraps the file key, and an access token. The server only stores a SHA-256 hash of that token, so it can check a recipient without being able to decrypt anything.",
  },
  {
    icon: FolderLockIcon,
    title: "Folders are shared as sealed snapshots",
    body: "Sharing a folder encrypts a manifest of its files — names, paths and each file's key — under a fresh link key. The server only learns which encrypted items that link is allowed to serve, so a folder link can never be used to fetch anything else.",
  },
  {
    icon: InboxIcon,
    title: "Upload links can add files, and nothing else",
    body: "A file request has its own key pair. The uploader's browser encrypts each file under a fresh key and seals that key to the request's public key (ECDH on P-256, then AES-256-GCM), so only the request's owner can open what arrives. The link cannot list, read or delete anything, not even what it sent, and the server holds the private key only in a form sealed by your master key.",
  },
  {
    icon: Link2Icon,
    title: "Short links trade secrecy for convenience — only if you choose",
    body: 'A "short link only" share is just /s/k7m3xq2 with no key in it, which is easy to read out or type. To make that work the server keeps the link key, so it isn\'t end-to-end encrypted. Add a password and the content stays unreadable to the server. Short ids are rate limited against guessing.',
  },
  {
    icon: KeyRoundIcon,
    title: "Passwords add a second factor",
    body: "Password-protected links mix an Argon2id-stretched password (64 MiB, 3 passes) into the key derivation. Someone who intercepts the link still can't open it, and wrong guesses are rate limited and never burn a view.",
  },
  {
    icon: MonitorSmartphoneIcon,
    title: "Your account password never leaves your device",
    body: "Signing in stretches your password with Argon2id locally and splits the result: an authentication key (which the server peppers and hashes) and a key-encryption key that unwraps your random master key. The server never learns your password or your master key. Changing your password only re-seals the master key.",
  },
  {
    icon: LifeBuoyIcon,
    title: "Recovery without a back door",
    body: "At sign-up you receive a 256-bit recovery key. It independently wraps your master key, so you can reset a forgotten password. Lose both, and your data is gone — no one, including the operator, can recover it.",
  },
  {
    icon: ServerIcon,
    title: "Hardened server",
    body: "Strict Content-Security-Policy with hashed inline scripts, no third-party requests, HttpOnly SameSite=Strict session cookies, CSRF headers, no-referrer policy, rate limits on sign-in and link access, and a janitor that deletes expired and burned data every minute.",
  },
]

const payments = {
  icon: CreditCardIcon,
  title: "Payments stay away from your files",
  body: "A drive is paid for through Paddle, on a bare checkout page kept apart from the app. Paddle learns the email and card you type there and nothing else: no keys, no file names, no contents. The app itself still makes no third-party requests, and storage is rented from a provider that only ever holds ciphertext.",
}

/** The same few things twice: as their owner sees them, and as the server holds them. */
const views = [
  { kind: "file", type: "application/pdf", name: "passport.pdf", sub: "2.4 MB", id: "itm_7Qk2vX9", noise: "9f3a0c71e4b8d25a6f1c" },
  { kind: "folder", name: "Taxes 2024", sub: "12 files", id: "fld_m3R8tZp", noise: "c41d7e0b9a2f86e35d10" },
  { kind: "text", name: "Door code for the new flat", sub: "Note", id: "itm_Wd5nH2c", noise: "07be92f4c1a6d83e5b7f" },
] as const

function Security() {
  const { t } = useI18n()
  const plans = usePlans()
  const open = usePlansOpen()
  const shown = plans && open ? [...sections, payments] : sections
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-16 sm:px-6">
        <div className="grid items-center gap-10 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div>
            <p className="eyebrow">{t("Security model")}</p>
            <h1 className="mt-3 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl">
              {t("How Coffer keeps your data unreadable.")}
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
              {t(
                "Coffer is built so that someone who takes over the server, with its database and disks, still can't read your files, their names or your notes. Here is how, and where that protection stops."
              )}
            </p>
          </div>
          <div aria-hidden className="relative mx-auto hidden size-64 md:block">
            <div className="absolute inset-[-25%] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--lime)_22%,transparent),color-mix(in_oklch,var(--mint)_18%,transparent)_55%,transparent)]" />
            <img src="/3d/lock.webp" alt="" className="relative size-full animate-float object-contain" />
          </div>
        </div>

        {/* The whole idea in one picture, before any of the detail. */}
        <section className="mt-14">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[1.75rem] border bg-card p-5 shadow-soft sm:p-6">
              <h2 className="text-lg font-semibold tracking-tight">{t("What you see")}</h2>
              <ul className="mt-4 grid gap-1">
                {views.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 rounded-xl px-1 py-2">
                    <FileGlyph kind={v.kind} type={"type" in v ? v.type : undefined} name={v.name} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{v.kind === "file" ? v.name : t(v.name)}</span>
                      <span className="block text-xs text-muted-foreground">{t(v.sub)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[1.75rem] border border-dashed bg-muted/40 p-5 sm:p-6">
              <h2 className="text-lg font-semibold tracking-tight">{t("What our server stores")}</h2>
              <ul className="mt-4 grid gap-1">
                {views.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 rounded-xl px-1 py-2">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground/[0.06] text-muted-foreground">
                      <FileLockIcon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-sm text-muted-foreground">{v.noise}…</span>
                      <span className="block text-xs text-muted-foreground/80">
                        {v.id} · {t("Encrypted name and contents")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">{t("The same drive, twice. Only one side holds the key.")}</p>
        </section>

        <ol className="mt-14 grid gap-3 md:grid-cols-2">
          {shown.map((s) => (
            <li key={s.title} className="rounded-[1.75rem] border bg-card p-6">
              <span className="grid size-10 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                <s.icon className="size-5" />
              </span>
              <h2 className="mt-4 text-lg font-semibold tracking-tight text-balance">{t(s.title)}</h2>
              <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">{t(s.body)}</p>
            </li>
          ))}
        </ol>
        <p className="mt-10 flex gap-3 rounded-[1.75rem] bg-secondary p-5 text-sm text-secondary-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-medium">{t("One honest caveat:")}</strong>{" "}
            {t(
              "end-to-end encryption in a web app relies on the server delivering honest JavaScript. Self-host Coffer, pin your image version and serve it over HTTPS."
            )}
          </span>
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}
