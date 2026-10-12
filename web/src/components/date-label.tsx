import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { exactTime, relativeTime } from "@/lib/format"

/** A moment in time as "2 hours ago"; the exact time, in 24 hours, shows on hover. */
export function DateLabel({ at, className }: { at: number; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={new Date(at * 1000).toISOString()} className={className}>
          {relativeTime(at)}
        </time>
      </TooltipTrigger>
      <TooltipContent sideOffset={-3}>{exactTime(at)}</TooltipContent>
    </Tooltip>
  )
}
