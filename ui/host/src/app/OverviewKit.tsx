// The look of the overviews (mockup: hero strip, KPI cards with a sparkline, week strip, shortcuts to the apps).
// Pure presentation: the pages feed them with figures they already read. The accent colours are the `--ov-*`
// tokens of index.css (they keep the same hue in light and dark); everything else follows the theme tokens.

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import AppIcon from './AppIcon.tsx'
import { Empty } from './kit.tsx'
import { fmtDay, t } from './i18n.ts'
import { to } from './router.ts'
import type { HomeItem, PluginView } from '../types.ts'
import { dayKey } from './overviewdata.ts'

export type Accent = 'indigo' | 'sun' | 'violet' | 'sky' | 'leaf' | 'rose'
const hue = (a: Accent) => (a === 'indigo' ? 'var(--primary-strong)' : `var(--ov-${a})`)

/** The strip at the top of an overview: a gradient, the greeting, one line and the actions. The colours are the
 *  same in light and dark (white on a deep gradient, 4.5:1 or more everywhere). */
export function Hero({ id, eyebrow, title, sub, actions }: { id: string; eyebrow?: string; title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <section aria-labelledby={id} data-testid="ov-hero" className="ov-hero relative overflow-hidden rounded-lg px-6 py-5 text-white shadow-sm max-[620px]:px-4">
      <svg aria-hidden="true" viewBox="0 0 400 120" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full opacity-20">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={`M-10 ${30 + i * 16} C 90 ${5 + i * 20}, 180 ${70 + i * 8}, 270 ${40 + i * 12} S 380 ${20 + i * 14}, 420 ${50 + i * 10}`} fill="none" stroke="#fff" strokeWidth="1" />
        ))}
      </svg>
      <div className="relative flex flex-col items-start justify-between gap-y-4">
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-xs font-semibold tracking-wider text-white/85 uppercase">{eyebrow}</p>}
          <h2 id={id} className="text-2xl leading-tight font-extrabold">
            {title}
          </h2>
          {sub && <p className="mt-1 max-w-[60ch] text-sm text-white/90">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </section>
  )
}

/** A button on the hero: white, or outlined. */
export function HeroLink({ href, children, ghost, icon }: { href: string; children: ReactNode; ghost?: boolean; icon?: ReactNode }) {
  return (
    <a
      href={href}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white/80',
        ghost ? 'border-white/60 text-white hover:bg-white/15' : 'border-white bg-white text-[#2b2c6e] hover:bg-white/90',
      )}
    >
      {icon}
      {children}
    </a>
  )
}

/** A small area and line: the values left to right. Flat when there is nothing to draw. */
export function Spark({ values, accent = 'indigo', label, className }: { values: number[]; accent?: Accent; label: string; className?: string }) {
  const n = values.length
  const max = Math.max(1, ...values)
  const pts = values.map((v, i) => [n > 1 ? (i * 100) / (n - 1) : 50, 30 - (v / max) * 26] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const color = hue(accent)
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label={label} className={cn('h-10 w-24 shrink-0', className)} style={{ color }}>
      {n > 1 ? (
        <>
          <path d={`${line} L100 32 L0 32 Z`} fill="currentColor" opacity="0.14" />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </>
      ) : (
        <path d="M0 29 L100 29" stroke="currentColor" strokeWidth="1.5" opacity="0.4" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  )
}

/** A card with one figure: an icon tile in the accent colour, the figure, the caption and, when there is a series, a
 *  sparkline. With `onClick` the card is a button. */
export function KpiCard({
  label,
  value,
  hint,
  values,
  trend,
  accent = 'indigo',
  icon,
  onClick,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  values?: number[]
  trend?: string
  accent?: Accent
  icon?: ReactNode
  onClick?: () => void
}) {
  const body = (
    <>
      {icon && (
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg [&>svg]:size-5" style={{ color: hue(accent), background: `color-mix(in srgb, ${hue(accent)} 14%, transparent)` }}>
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <b className="text-2xl leading-none font-extrabold tabular-nums">{value}</b>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {values && values.length > 0 && <Spark values={values} accent={accent} label={`${label}: ${trend ?? t('trend')}`} />}
    </>
  )
  const cls = 'ov-card flex items-center gap-3 rounded-lg border bg-card p-4 text-left shadow-sm'
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'cursor-pointer outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}


/** The next seven days, today first, with the number of items due on each. Items already late are counted apart. */
export function WeekStrip({ slug, due, now }: { slug: string; due: HomeItem[]; now: Date }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const key = dayKey(d)
    return { d, key, items: due.filter((x) => x.at.slice(0, 10) === key) }
  })
  const late = due.filter((x) => x.at.slice(0, 10) < days[0].key)
  const total = due.length
  if (total === 0)
    return (
      <Empty compact art="tasks" title={t('Nothing due this week')}>
        {t('Items with a due date show here, day by day.')}
      </Empty>
    )
  return (
    <div className="grid gap-3">
      <ol className="grid grid-cols-7 gap-1.5" aria-label={t('The next seven days')}>
        {days.map(({ d, key, items }, i) => (
          <li
            key={key}
            aria-current={i === 0 ? 'date' : undefined}
            className={cn('flex min-w-0 flex-col items-center gap-0.5 rounded-lg border bg-muted/40 px-1 py-2 text-center', i === 0 && 'border-primary bg-primary/10')}
          >
            <span className="text-[11px] text-muted-foreground uppercase">{fmtDay(d.toISOString(), { weekday: 'short' })}</span>
            <b className="text-base font-bold tabular-nums">{d.getDate()}</b>
            <span className="flex h-2 items-center gap-0.5" aria-hidden="true">
              {items.slice(0, 3).map((x) => (
                <i key={x.resource_id} className="size-1.5 rounded-full" style={{ background: hue('sun') }} />
              ))}
            </span>
            <span className={cn('text-[11px] tabular-nums', items.length ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{items.length || '—'}</span>
          </li>
        ))}
      </ol>
      {late.length > 0 && (
        <p className="text-xs font-medium text-destructive">{t('{count} items late', { count: late.length })}</p>
      )}
      <ul className="grid gap-0.5">
        {[...late, ...days.flatMap((x) => x.items)].slice(0, 5).map((x) => (
          <li key={x.resource_id}>
            <a href={to.item(slug, x.resource_id)} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
              <AppIcon id={x.plugin_id} className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{x.title || t('(untitled)')}</span>
              <span className={cn('shrink-0 text-xs', x.at.slice(0, 10) < days[0].key ? 'font-medium text-destructive' : 'text-muted-foreground')}>{fmtDay(x.at)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Shortcuts to the apps: the ones the person uses most first (by their items), then the others. */
export function AppShortcuts({ slug, apps, counts }: { slug: string; apps: PluginView[]; counts: Record<string, number> }) {
  const sorted = [...apps].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
  const accents: Accent[] = ['indigo', 'violet', 'sky', 'leaf', 'sun', 'rose']
  if (!sorted.length) return null
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
      {sorted.slice(0, 8).map((p, i) => (
        <li key={p.id}>
          <a href={to.plugin(slug, p.id)} className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5 text-sm outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-md [&>svg]:size-4" style={{ color: hue(accents[i % accents.length]), background: `color-mix(in srgb, ${hue(accents[i % accents.length])} 14%, transparent)` }}>
              <AppIcon id={p.id} name={p.icon_name} />
            </span>
            <span className="min-w-0">
              <b className="block truncate font-medium">{p.label}</b>
              {(counts[p.id] ?? 0) > 0 && <span className="text-xs text-muted-foreground">{t('{count} items', { count: counts[p.id] })}</span>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/** An area with a line, dashed guides, the first and last label and a dot on the last value (the trend of a card). */
export function AreaChart({ values, labels, label, className }: { values: number[]; labels?: [string, string]; label: string; className?: string }) {
  const max = Math.max(1, ...values)
  const n = values.length
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 100)
  const y = (v: number) => 4 + (1 - v / max) * 40
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ')
  const gid = `ov-area-${label.replace(/[^a-z0-9]/gi, '')}`
  return (
    <div className={cn('grid gap-1', className)}>
      <svg viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label={label} className="h-28 w-full text-primary-strong">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[4, 24, 44].map((g) => (
          <line key={g} x1="0" x2="100" y1={g} y2={g} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="2 2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        ))}
        {n > 1 && <path d={`${line} L100 44 L0 44 Z`} fill={`url(#${gid})`} />}
        {n > 1 && <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      </svg>
      {labels && (
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      )}
    </div>
  )
}

/** Columns for the last days, the latest one in the strong colour; a label under every third. */
export function DayBars({ days, label }: { days: { label: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...days.map((d) => d.value))
  return (
    <div role="img" aria-label={label} className="grid gap-1">
      <div className="flex h-16 items-end gap-[3px]">
        {days.map((d, i) => (
          <span
            key={i}
            title={`${d.label}: ${d.value}`}
            className={cn('min-h-[3px] flex-1 rounded-t-[3px]', i === days.length - 1 ? 'bg-primary-strong' : 'bg-primary-strong/30')}
            style={{ height: `${Math.max(4, (d.value / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex gap-[3px] text-[11px] text-muted-foreground">
        {days.map((d, i) => (
          <span key={i} className="flex-1 overflow-visible whitespace-nowrap">
            {i % 3 === 0 ? d.label : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The actions of the person, day by day, in weeks (columns) and week days (rows, Monday first). */
export function Heatmap({ days, label, tip }: { days: { day: string; events: number }[]; label: string; tip: (day: string, n: number) => string }) {
  if (!days.length) return null
  const first = new Date(days[0].day + 'T00:00:00')
  const offset = (first.getDay() + 6) % 7
  const cells: ({ day: string; events: number } | null)[] = [...Array<null>(offset).fill(null), ...days]
  while (cells.length % 7) cells.push(null)
  const weeks = cells.length / 7
  const max = Math.max(1, ...days.map((d) => d.events))
  const level = (n: number) => (n === 0 ? 0.12 : 0.3 + 0.7 * (n / max))
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const months = Array.from({ length: weeks }, (_, w) => {
    const d = cells.slice(w * 7, w * 7 + 7).find(Boolean)
    const m = d ? new Date(d.day + 'T00:00:00') : null
    return m && (w === 0 || m.getMonth() !== new Date((cells.slice((w - 1) * 7, w * 7).find(Boolean) as { day: string }).day + 'T00:00:00').getMonth()) ? m.toLocaleString(undefined, { month: 'short' }) : ''
  })
  return (
    <div role="img" aria-label={label} className="grid gap-1 text-[11px] text-muted-foreground">
      <div className="grid gap-1" style={{ gridTemplateColumns: `14px repeat(${weeks}, minmax(0, 1fr))` }}>
        <span />
        {months.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
        {letters.map((l, r) => (
          <>
            <span key={`l${r}`} className="leading-4">{l}</span>
            {Array.from({ length: weeks }, (_, w) => {
              const c = cells[w * 7 + r]
              return c ? (
                <span key={`${r}-${w}`} title={tip(c.day, c.events)} className="h-4 rounded-[3px] bg-primary-strong" style={{ opacity: level(c.events) }} />
              ) : (
                <span key={`${r}-${w}`} className="h-4" />
              )
            })}
          </>
        ))}
      </div>
    </div>
  )
}

/** Parts of a total side by side, each with its number. */
export function SegmentBar({ parts }: { parts: { n: number; className: string }[] }) {
  const shown = parts.filter((p) => p.n > 0)
  return (
    <div className="flex h-6 gap-[3px] overflow-hidden rounded-[6px] text-xs font-semibold text-white" aria-hidden="true" data-testid="ov-waiting-bar">
      {shown.map((p, i) => (
        <span key={i} className={cn('flex items-center justify-center', p.className)} style={{ flex: p.n }}>
          {p.n}
        </span>
      ))}
    </div>
  )
}
