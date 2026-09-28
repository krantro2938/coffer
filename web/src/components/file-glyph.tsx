import {
  FileArchiveIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  FolderIcon,
  StickyNoteIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Tone = "mint" | "lavender" | "coral" | "muted"

function classify(kind: "file" | "text" | "folder", type = ""): { Icon: typeof FileIcon; tone: Tone } {
  if (kind === "folder") return { Icon: FolderIcon, tone: "mint" }
  if (kind === "text") return { Icon: StickyNoteIcon, tone: "lavender" }
  if (type.startsWith("image/")) return { Icon: FileImageIcon, tone: "coral" }
  if (type.startsWith("video/")) return { Icon: FileVideoIcon, tone: "lavender" }
  if (type.startsWith("audio/")) return { Icon: FileAudioIcon, tone: "lavender" }
  if (/zip|tar|gzip|7z|rar|compressed/.test(type)) return { Icon: FileArchiveIcon, tone: "muted" }
  if (/sheet|excel|csv/.test(type)) return { Icon: FileSpreadsheetIcon, tone: "mint" }
  if (/json|javascript|typescript|xml|html|x-sh|x-python/.test(type)) return { Icon: FileCodeIcon, tone: "muted" }
  if (type.startsWith("text/") || /pdf|word|document/.test(type)) return { Icon: FileTextIcon, tone: "coral" }
  return { Icon: FileIcon, tone: "muted" }
}

const tones: Record<Tone, string> = {
  mint: "bg-secondary text-secondary-foreground",
  lavender: "bg-lavender-soft text-accent-foreground",
  coral: "bg-coral-soft text-[color-mix(in_oklch,var(--coral),var(--foreground)_35%)]",
  muted: "bg-muted text-muted-foreground",
}

export function FileGlyph({
  kind,
  type,
  className,
}: {
  kind: "file" | "text" | "folder"
  type?: string
  className?: string
}) {
  const { Icon, tone } = classify(kind, type)
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", tones[tone], className)}>
      <Icon className="size-[45%]" strokeWidth={1.75} />
    </span>
  )
}
