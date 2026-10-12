import { Link } from "@tanstack/react-router"
import { ArrowRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * The frame around the pages a link opens (/s and /r). The person looking has
 * usually never heard of Coffer, so it is one calm panel with one card in it.
 */
export function RecipientStage({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 px-3 pb-3 sm:px-4">
      <div className="relative mx-auto flex w-full max-w-[88rem] flex-1 items-start justify-center overflow-hidden rounded-[2rem] bg-hero px-4 py-10 text-hero-foreground sm:items-center sm:rounded-[2.5rem] sm:py-14">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute top-1/2 left-1/2 size-[56rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
          <div className="absolute top-1/2 left-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
          <div className="absolute top-1/2 left-1/2 size-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--lime)_30%,transparent),transparent)]" />
        </div>
        <div className="relative w-full max-w-lg min-w-0">{children}</div>
      </div>
    </main>
  )
}

/** Shown once the person has what they came for: they can do this too. */
export function GrowthNote({ text, label, to }: { text: string; label: string; to: "/" | "/register" }) {
  return (
    <div className="mt-5 flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
      <p className="text-sm text-hero-foreground/85">{text}</p>
      <Button asChild className="shrink-0 bg-lime text-hero hover:bg-lime/85">
        <Link to={to}>
          {label} <ArrowRightIcon data-icon="inline-end" />
        </Link>
      </Button>
    </div>
  )
}
