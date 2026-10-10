import { Link } from "@tanstack/react-router"
import { cn } from "@/lib/utils"

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <circle cx="16" cy="13.5" r="4.25" className="fill-primary-foreground" />
      <path d="M14.1 16.5h3.8l1.1 7.5h-6z" className="fill-primary-foreground" />
      <circle cx="16" cy="13.5" r="1.6" className="fill-primary" />
    </svg>
  )
}

export function Brand({ className, to = "/" }: { className?: string; to?: string }) {
  return (
    <Link to={to} className={cn("flex items-center gap-2 font-medium tracking-tight", className)}>
      <LogoMark />
      <span className="text-[1.0625rem]">Coffer</span>
    </Link>
  )
}
