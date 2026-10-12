import { useId, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * The sidebar's pictures: small objects with a lit top, a shaded underside and
 * a soft shadow, drawn for this app rather than taken from an icon set.
 * Colours are fixed, so they read the same in light and dark themes. A 3D render
 * saved as /nav/<name>.webp takes the drawing's place when it exists.
 */

type Tone = { light: string; mid: string; dark: string }

const tones = {
  drive: { light: "#8EE0B0", mid: "#34A56D", dark: "#17603F" },
  share: { light: "#E4FA9E", mid: "#A8E43A", dark: "#5F9A12" },
  links: { light: "#CDBEFF", mid: "#8E64F2", dark: "#5428B8" },
  requests: { light: "#FFC48A", mid: "#FA7B2C", dark: "#B93D0B" },
  settings: { light: "#DCE3EC", mid: "#9AA8BA", dark: "#4B5A6E" },
} satisfies Record<string, Tone>

/** Two vertical gradients (lit face, shaded face) with ids unique to the instance. */
function Paint({ id, tone }: { id: string; tone: Tone }) {
  return (
    <defs>
      <linearGradient id={`${id}-lit`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={tone.light} />
        <stop offset="1" stopColor={tone.mid} />
      </linearGradient>
      <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={tone.mid} />
        <stop offset="1" stopColor={tone.dark} />
      </linearGradient>
    </defs>
  )
}

function Frame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-6 shrink-0", className)} aria-hidden>
      {children}
    </svg>
  )
}

const Ground = ({ rx = 10 }: { rx?: number }) => <ellipse cx="16" cy="28.4" rx={rx} ry="1.7" fill="#000" opacity="0.16" />

function DriveSvg({ className }: { className?: string }) {
  const id = useId()
  return (
    <Frame className={className}>
      <Paint id={id} tone={tones.drive} />
      <Ground />
      {/* lid, then the body in front of it */}
      <path d="M8 6.5h16a3 3 0 0 1 2.8 1.9L29 14H3l2.2-5.6A3 3 0 0 1 8 6.5Z" fill={`url(#${id}-lit)`} />
      <rect x="3" y="13" width="26" height="14" rx="4.5" fill={`url(#${id}-shade)`} />
      <path d="M7.5 13.8h17" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8 21h8" stroke="#000" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round" />
      <circle cx="23.5" cy="21" r="1.7" fill="#fff" fillOpacity="0.92" />
    </Frame>
  )
}

function QuickShareSvg({ className }: { className?: string }) {
  const id = useId()
  return (
    <Frame className={className}>
      <Paint id={id} tone={tones.share} />
      <Ground rx={8} />
      <path d="M3.5 14.2 28 4.5 14.6 18Z" fill={`url(#${id}-lit)`} />
      <path d="M14.6 18 28 4.5 19.2 27.6Z" fill={`url(#${id}-shade)`} />
      <path d="M14.6 18 13.4 25.2 17.2 21.6Z" fill={tones.share.dark} />
      <path d="M5.8 14.1 26 6" stroke="#fff" strokeOpacity="0.55" strokeWidth="1" strokeLinecap="round" />
    </Frame>
  )
}

function LinksSvg({ className }: { className?: string }) {
  const id = useId()
  return (
    <Frame className={className}>
      <Paint id={id} tone={tones.links} />
      <Ground rx={9} />
      {/* two chain links, the near one a little darker */}
      <g transform="rotate(-45 16 15)">
        <rect x="2.5" y="10.5" width="17" height="9" rx="4.5" fill="none" stroke={`url(#${id}-shade)`} strokeWidth="3.6" />
        <rect x="12.5" y="10.5" width="17" height="9" rx="4.5" fill="none" stroke={`url(#${id}-lit)`} strokeWidth="3.6" />
        <path d="M7 11.4h8M17 11.4h8" stroke="#fff" strokeOpacity="0.5" strokeWidth="1" strokeLinecap="round" />
      </g>
    </Frame>
  )
}

function RequestsSvg({ className }: { className?: string }) {
  const id = useId()
  return (
    <Frame className={className}>
      <Paint id={id} tone={tones.requests} />
      <Ground />
      {/* a sheet dropping into a tray */}
      <rect x="10.5" y="3" width="11" height="13" rx="2.2" fill="#fff" />
      <path d="M13.5 7.5h5M13.5 10.5h3" stroke={tones.requests.mid} strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M3 17.5h7.6c.7 2.4 2.7 3.4 5.4 3.4s4.7-1 5.4-3.4H29v5.2a4.8 4.8 0 0 1-4.8 4.8H7.8A4.8 4.8 0 0 1 3 22.7Z"
        fill={`url(#${id}-shade)`}
      />
      <path d="M3 17.5h7.6c.7 2.4 2.7 3.4 5.4 3.4s4.7-1 5.4-3.4H29" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="1.2" />
    </Frame>
  )
}

function SettingsSvg({ className }: { className?: string }) {
  const id = useId()
  return (
    <Frame className={className}>
      <Paint id={id} tone={tones.settings} />
      <Ground rx={8} />
      <g fill={`url(#${id}-shade)`}>
        {[0, 45, 90, 135].map((a) => (
          <rect key={a} x="13" y="2.5" width="6" height="25" rx="2" transform={`rotate(${a} 16 15)`} />
        ))}
      </g>
      <circle cx="16" cy="15" r="9" fill={`url(#${id}-lit)`} />
      <circle cx="16" cy="15" r="3.6" fill={tones.settings.dark} />
      <path d="M16 12.2a2.8 2.8 0 0 1 2.7 2" stroke="#fff" strokeOpacity="0.45" strokeWidth="1" strokeLinecap="round" fill="none" />
    </Frame>
  )
}

type IconProps = { className?: string }

function withArt(name: string, Drawing: (props: IconProps) => React.ReactNode) {
  return function NavIcon({ className }: IconProps) {
    const [missing, setMissing] = useState(false)
    if (missing) return <Drawing className={className} />
    return (
      <img
        src={`/nav/${name}.webp`}
        alt=""
        draggable={false}
        onError={() => setMissing(true)}
        className={cn("size-6 shrink-0 object-contain", className)}
      />
    )
  }
}

export const DriveIcon = withArt("drive", DriveSvg)
export const QuickShareIcon = withArt("share", QuickShareSvg)
export const LinksIcon = withArt("links", LinksSvg)
export const RequestsIcon = withArt("requests", RequestsSvg)
export const SettingsIcon = withArt("settings", SettingsSvg)
