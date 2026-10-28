// Small charts of the overviews, drawn in SVG/HTML without a library: bars, a donut and a stacked bar.
// Rules: one fixed colour order (--chart-1…), a 2px gap of the surface between segments, values and
// names always written (a legend or the row itself), a text alternative for the screen readers.

import { fmtNumber } from './i18n.ts'

export interface Datum {
  label: string
  value: number
  /** the value as text (default: the number) */
  text?: string
}

/** The colour of the n-th series (fixed order, after the fifth they fold into the last). */
const seriesColor = (i: number) => `var(--chart-${Math.min(i, 4) + 1})`

/** Horizontal bars of one measure: the name, the bar and the value on one row. */
export function HBars({ data, label }: { data: Datum[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <ul aria-label={label} className="grid gap-1.5">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2 text-xs">
          <span className="truncate" title={d.label}>
            {d.label}
          </span>
          <span className="h-2 overflow-hidden rounded-r-full bg-muted" aria-hidden="true">
            <span
              className="block h-full rounded-r-[4px]"
              style={{
                width: `${Math.max(d.value > 0 ? 3 : 0, (d.value / max) * 100)}%`,
                background: seriesColor(0),
              }}
            />
          </span>
          <span className="text-muted-foreground tabular-nums">{d.text ?? fmtNumber(d.value)}</span>
        </li>
      ))}
    </ul>
  )
}

/** A donut with the legend beside it (a legend is always present: colour never carries the meaning alone). */
export function Donut({ data, label, centre }: { data: Datum[]; label: string; centre?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = 15.9155
  let acc = 0
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 42 42" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${d.text ?? d.value}`).join(', ')}`} className="size-24 shrink-0 -rotate-90">
        <circle cx="21" cy="21" r={r} fill="none" stroke="var(--muted)" strokeWidth="5" />
        {total > 0 &&
          data.map((d, i) => {
            const len = (d.value / total) * 100
            const el = (
              <circle
                key={d.label}
                cx="21"
                cy="21"
                r={r}
                fill="none"
                stroke={seriesColor(i)}
                strokeWidth="5"
                strokeDasharray={`${Math.max(0, len - 1)} ${100 - Math.max(0, len - 1)}`}
                strokeDashoffset={-acc}
              />
            )
            acc += len
            return el
          })}
        {centre && (
          <text x="21" y="21" textAnchor="middle" dominantBaseline="central" transform="rotate(90 21 21)" className="fill-foreground text-[7px] font-semibold">
            {centre}
          </text>
        )}
      </svg>
      <Legend data={data} />
    </div>
  )
}

/** The legend: a swatch, the name and the value (text in ink, the swatch carries the colour). */
export function Legend({ data }: { data: Datum[] }) {
  return (
    <ul className="grid min-w-0 flex-1 gap-1 text-xs">
      {data.map((d, i) => (
        <li key={d.label} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(i) }} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{d.label}</span>
          <span className="text-muted-foreground tabular-nums">{d.text ?? fmtNumber(d.value)}</span>
        </li>
      ))}
    </ul>
  )
}
