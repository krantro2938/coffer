import { cn } from "@/lib/utils"

/**
 * An empty page, told with one of the landing page's 3D renders rather than a
 * small icon tile: the render settles onto a soft glow (once, it doesn't keep
 * moving), with a heading, a line of explanation and what to do next beneath it.
 */
export function EmptyState({
  image,
  title,
  children,
  actions,
  dashed,
  className,
}: {
  /** A render under /public/3d, by name. */
  image: string
  title: string
  children?: React.ReactNode
  actions?: React.ReactNode
  /** For a page that takes dropped files: the dashed edge says so. */
  dashed?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative grid place-items-center overflow-hidden rounded-[2rem] border px-6 pt-10 pb-14 text-center",
        dashed ? "border-dashed bg-card/40" : "bg-card shadow-soft",
        className
      )}
    >
      <div className="relative size-36 sm:size-40">
        <div
          aria-hidden
          className="absolute inset-[-35%] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--lime)_20%,transparent),color-mix(in_oklch,var(--mint)_16%,transparent)_55%,transparent)]"
        />
        <img src={`/3d/${image}.webp`} alt="" className="relative size-full animate-settle object-contain" />
        <div aria-hidden className="absolute -bottom-1 left-1/2 h-3 w-20 -translate-x-1/2 rounded-full bg-foreground/10 blur-lg" />
      </div>
      <h2 className="mt-6 animate-rise text-2xl font-semibold tracking-tight text-balance [animation-delay:80ms] sm:text-3xl">{title}</h2>
      {children && (
        <p className="mt-2 max-w-md animate-rise text-sm text-pretty text-muted-foreground [animation-delay:120ms]">{children}</p>
      )}
      {actions && <div className="mt-7 flex animate-rise flex-wrap justify-center gap-2 [animation-delay:160ms]">{actions}</div>}
    </div>
  )
}
