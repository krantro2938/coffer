import type { ReactNode } from "react"
import type { ItemKind } from "@/lib/crypto"
import { cn } from "@/lib/utils"

type Look = { fill: string; fold: string; mark: ReactNode }

const line = { stroke: "#fff", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const

function label(text: string) {
  const size = text.length > 3 ? 7.2 : text.length > 2 ? 8 : 9
  return (
    <text x="18.5" y="30" textAnchor="middle" fill="#fff" fontSize={size} fontWeight={700} fontFamily="inherit">
      {text}
    </text>
  )
}

const lines = <path d="M10 19h17M10 23h17M10 27h12" {...line} />

const looks = {
  pdf: { fill: "#EF4444", fold: "#F87171", mark: label("PDF") },
  doc: { fill: "#2563EB", fold: "#60A5FA", mark: label("DOC") },
  sheet: { fill: "#16A34A", fold: "#4ADE80", mark: label("XLS") },
  csv: { fill: "#16A34A", fold: "#4ADE80", mark: label("CSV") },
  slides: { fill: "#F97316", fold: "#FB923C", mark: label("PPT") },
  archive: { fill: "#78716C", fold: "#A8A29E", mark: label("ZIP") },
  markdown: { fill: "#334155", fold: "#64748B", mark: label("MD") },
  json: { fill: "#F59E0B", fold: "#FBBF24", mark: label("{ }") },
  code: { fill: "#334155", fold: "#64748B", mark: <path d="m15 19-4 4 4 4m7-8 4 4-4 4" {...line} /> },
  image: {
    fill: "#8B5CF6",
    fold: "#A78BFA",
    mark: (
      <>
        <rect x="9" y="16" width="19" height="13" rx="2" {...line} strokeWidth={1.6} />
        <circle cx="23.5" cy="20.5" r="1.6" fill="#fff" />
        <path d="m11.5 27 4.5-4.5 3 2.7 2.2-2.2 4.8 4" {...line} strokeWidth={1.6} />
      </>
    ),
  },
  video: {
    fill: "#E11D48",
    fold: "#FB7185",
    mark: <path d="M15 18.2v9.6a.8.8 0 0 0 1.2.7l8-4.8a.8.8 0 0 0 0-1.4l-8-4.8a.8.8 0 0 0-1.2.7Z" fill="#fff" />,
  },
  audio: { fill: "#0891B2", fold: "#22D3EE", mark: <path d="M10.5 21.5v3M14.5 18.5v9M18.5 20.5v5M22.5 17.5v11M26.5 21.5v3" {...line} /> },
  note: { fill: "#1F4D36", fold: "#4B7F63", mark: lines },
  text: { fill: "#64748B", fold: "#94A3B8", mark: lines },
  generic: { fill: "#A1A1AA", fold: "#D4D4D8", mark: lines },
} satisfies Record<string, Look>

type LookName = keyof typeof looks

// What the name says wins over what the browser guessed: a file from another
// office suite (WPS, say) often arrives with a type nobody knows.
const BY_EXTENSION: Record<string, LookName> = {
  pdf: "pdf",
  doc: "doc",
  docx: "doc",
  docm: "doc",
  dot: "doc",
  dotx: "doc",
  odt: "doc",
  rtf: "doc",
  wps: "doc",
  pages: "doc",
  xls: "sheet",
  xlsx: "sheet",
  xlsm: "sheet",
  ods: "sheet",
  csv: "csv",
  tsv: "sheet",
  et: "sheet",
  numbers: "sheet",
  ppt: "slides",
  pptx: "slides",
  pps: "slides",
  ppsx: "slides",
  odp: "slides",
  dps: "slides",
  key: "slides",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",
  xz: "archive",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  log: "text",
  json: "json",
  js: "code",
  mjs: "code",
  ts: "code",
  tsx: "code",
  jsx: "code",
  py: "code",
  go: "code",
  rs: "code",
  java: "code",
  c: "code",
  h: "code",
  cpp: "code",
  cs: "code",
  php: "code",
  rb: "code",
  sh: "code",
  html: "code",
  css: "code",
  xml: "code",
  yml: "code",
  yaml: "code",
  sql: "code",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  heic: "image",
  svg: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  mp4: "video",
  mov: "video",
  mkv: "video",
  webm: "video",
  avi: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  ogg: "audio",
  m4a: "audio",
  aac: "audio",
  opus: "audio",
}

function extension(name = ""): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ""
}

function classify(kind: ItemKind, type = "", name = ""): Look {
  if (kind === "text") return looks.note
  const byName = BY_EXTENSION[extension(name)]
  if (byName) return looks[byName]
  if (type.startsWith("image/")) return looks.image
  if (type.startsWith("video/")) return looks.video
  if (type.startsWith("audio/")) return looks.audio
  if (/pdf/.test(type)) return looks.pdf
  if (/csv/.test(type)) return looks.csv
  if (/sheet|excel/.test(type)) return looks.sheet
  if (/presentation|powerpoint/.test(type)) return looks.slides
  if (/wordprocessing|msword|opendocument\.text|rtf|wps/.test(type)) return looks.doc
  if (/zip|tar|gzip|7z|rar|compressed/.test(type)) return looks.archive
  if (/markdown/.test(type)) return looks.markdown
  if (/json/.test(type)) return looks.json
  if (/javascript|typescript|xml|html|x-sh|x-python/.test(type)) return looks.code
  if (type.startsWith("text/")) return looks.text
  return looks.generic
}

/**
 * The picture a file or folder wears in lists. Pass the file's name when there
 * is one: its extension decides the look, and the type is only the fallback.
 */
export function FileGlyph({
  kind,
  type,
  name,
  className,
}: {
  kind: ItemKind | "folder"
  type?: string
  name?: string
  className?: string
}) {
  const cls = cn("size-10 shrink-0", className)
  if (kind === "folder" || kind === "bundle") {
    return (
      <svg viewBox="0 0 40 40" className={cls} aria-hidden>
        <path d="M5 10a4 4 0 0 1 4-4h7.2c1 0 1.95.45 2.58 1.23L20.6 9.5H31a4 4 0 0 1 4 4V15H5v-5Z" fill="#F6C453" />
        <path d="M5 13h30v18a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V13Z" fill="#FBBF24" />
        <path d="M5 15h30" stroke="#FDE68A" strokeWidth={1.2} strokeLinecap="round" />
      </svg>
    )
  }
  const look = classify(kind, type, name)
  return (
    <svg viewBox="0 0 40 40" className={cls} aria-hidden>
      <path d="M8 3h16l9 9v22a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z" fill={look.fill} />
      <path d="M24 3l9 9h-5a4 4 0 0 1-4-4V3Z" fill={look.fold} />
      {look.mark}
    </svg>
  )
}
