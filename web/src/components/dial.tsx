import { cn } from "@/lib/utils"

const C = 200 // centre of the 400-unit drawing

/** Graduations around a ring: a long mark every `major`, a medium one every `mid`, hairlines between. */
function Ticks({ count, r, major, mid }: { count: number; r: number; major: number; mid?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        if (i === 0) return null // the index mark sits here
        const a = (i / count) * Math.PI * 2 - Math.PI / 2
        const big = i % major === 0
        const medium = !big && !!mid && i % mid === 0
        const len = big ? 11 : medium ? 7.5 : 4.5
        const cos = Math.cos(a)
        const sin = Math.sin(a)
        return (
          <line
            key={i}
            x1={C + cos * (r - 1.5)}
            y1={C + sin * (r - 1.5)}
            x2={C + cos * (r - 1.5 - len)}
            y2={C + sin * (r - 1.5 - len)}
            strokeWidth={big ? 1.6 : 1}
            opacity={big ? 0.75 : medium ? 0.5 : 0.3}
          />
        )
      })}
    </>
  )
}

/** One turning ring: a machined double edge, its graduations and an index mark at the top. */
function Ring({
  r,
  count,
  major,
  mid,
  className,
  numerals,
}: {
  r: number
  count: number
  major: number
  mid?: number
  className: string
  numerals?: boolean
}) {
  return (
    <g className={cn("dial-ring", className)}>
      <circle cx={C} cy={C} r={r} opacity="0.4" />
      <circle cx={C} cy={C} r={r - 17} opacity="0.12" />
      <Ticks count={count} r={r} major={major} mid={mid} />
      {/* Index mark: a wedge that points in at the ring from just outside it. */}
      <path d={`M${C} ${C - r + 1.5} l4.2 -8.5 h-8.4 z`} fill="currentColor" stroke="none" opacity="0.8" />
      <line x1={C} y1={C - r + 1.5} x2={C} y2={C - r + 14} strokeWidth="1.6" opacity="0.8" />
      {numerals &&
        Array.from({ length: count / major }, (_, i) => {
          if (i === 0) return null // the index mark is there
          const deg = (i * major * 360) / count
          return (
            <text
              key={i}
              x={C}
              y={C - r + 27}
              transform={`rotate(${deg} ${C} ${C})`}
              textAnchor="middle"
              fontSize="8.5"
              fill="currentColor"
              stroke="none"
              opacity="0.55"
              style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
            >
              {i * major}
            </text>
          )
        })}
    </g>
  )
}

/**
 * The lock dial that runs through Coffer's pages, drawn large. "turning"
 * spins the rings like a combination being entered; "open" lines them up and
 * lets light out of the middle. `numerals` adds the figures of a real dial,
 * worth it only where the dial is big enough to read them.
 */
export function Dial({
  state = "idle",
  numerals = false,
  className,
}: {
  state?: "idle" | "turning" | "open"
  numerals?: boolean
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 400 400"
      aria-hidden
      data-state={state}
      className={cn("dial", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      shapeRendering="geometricPrecision"
    >
      <defs>
        <radialGradient id="dial-light">
          <stop offset="0" stopColor="var(--mint)" />
          <stop offset="0.55" stopColor="var(--mint)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--mint)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={C} cy={C} r="150" className="dial-glow" fill="url(#dial-light)" stroke="none" />
      <Ring r={190} count={100} major={10} mid={5} className="dial-ring-a" numerals={numerals} />
      <Ring r={141} count={60} major={5} className="dial-ring-b" />
      <Ring r={94} count={36} major={3} className="dial-ring-c" />
      {/* The hub and its keyhole, drawn as one shape so nothing overlaps. */}
      <circle cx={C} cy={C} r="40" opacity="0.35" />
      <circle cx={C} cy={C} r="35.5" opacity="0.12" />
      <path
        className="dial-keyhole"
        d="M200 178 a12 12 0 0 1 6.5 22.1 L211 223.7 a2.2 2.2 0 0 1 -2.2 2.6 h-17.6 a2.2 2.2 0 0 1 -2.2 -2.6 L193.5 200.1 A12 12 0 0 1 200 178 z"
        fill="currentColor"
        stroke="none"
        opacity="0.85"
      />
    </svg>
  )
}
