// Widgets of the overviews (mockup: Home of the User, overview of the Tenant Manager and of the
// Administrator): a panel with a title and a link, a small trend, the compact strip of the apps, the
// decisions waiting for the Tenant Manager, the latest activity and the lists of the Administrator.
// Every widget reads a cheap source: counters from the overview, a snapshot, or a page of five rows.

import type { ReactNode } from 'react'
import { CircleAlert, History, Lock, Mail, Share2 } from 'lucide-react'
import { fmtBytes, fmtDate } from '../api.ts'
import type { AccessRequest, GlobalKpi, Invitation, LogEvent, LogPage, PluginKpi, PluginView, ResourceStat, TenantInfo } from '../types.ts'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import AppIcon from './AppIcon.tsx'
import { Donut, HBars } from './Charts.tsx'
import { isApp, useApi, usePaged, type PageOf } from './core.ts'
import { fmtNumber, t } from './i18n.ts'
import { Loading } from './kit.tsx'
import { go, to } from './router.ts'
import { about, describe } from './logtext.ts'
import { useNoteList } from './notes.ts'
import { NoteRow } from './notifications.tsx'

const enc = encodeURIComponent

/** A panel of the overview: title, an optional link at the right and the content. `span` takes two columns
 *  (from the width of a tablet), `full` the whole row. A panel fills the height of its row. */
export function Widget({
  id,
  title,
  link,
  span,
  full,
  icon,
  children,
}: {
  id: string
  title: string
  link?: { href: string; label: string }
  span?: boolean
  full?: boolean
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2 rounded-xl border bg-card p-4', span && '@xl:col-span-2', full && '@xl:col-span-2 @4xl:col-span-4')}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        {link && (
          <a href={link.href} className="text-sm text-primary-strong underline-offset-4 hover:underline">
            {link.label}
          </a>
        )}
      </div>
      {children}
    </section>
  )
}

/** The grid of the widgets: four columns, two on the tablet, one on the phone (by the width of the page, not of
 *  the window). The flow is dense, so a short widget fills the hole a wide one left, and the widgets of a
 *  row have the same height. */
export function WidgetGrid({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-flow-dense grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-4">{children}</div>
    </div>
  )
}

/** A row of counters that takes the whole row of the grid and fills it. */
export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 @xl:col-span-2 @4xl:col-span-4">{children}</div>
}

/** A small trend: the figure, its caption and a line (the caption says what the values are). */
export function TrendWidget({ id, title, figure, caption, values, link }: { id: string; title: string; figure: ReactNode; caption: string; values: number[]; link?: { href: string; label: string } }) {
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? 100 / (values.length - 1) : 0
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(30 - (v / max) * 28).toFixed(1)}`).join(' ')
  return (
    <Widget id={id} title={title} link={link}>
      <div className="flex items-baseline gap-2">
        <b className="text-2xl font-semibold tabular-nums">{figure}</b>
        <span className="text-xs text-muted-foreground">{caption}</span>
      </div>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label={`${title}: ${caption}`} className="h-10 w-full text-primary-strong">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </Widget>
  )
}

/** The apps as a compact strip of chips (the first thing of a Home). */
export function AppsStrip({ slug, plugins }: { slug: string; plugins: PluginView[] }) {
  const apps = plugins.filter(isApp)
  if (!apps.length) return null
  return (
    <nav aria-label={t('Your apps')} className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{t('Your apps')}</span>
      {apps.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => go(to.plugin(slug, p.id))}
          title={p.description}
          className="flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-sm outline-none hover:border-primary/50 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AppIcon id={p.id} name={p.icon_name} className="size-4 fill-current text-primary [fill-opacity:0.12]" />
          <b className="font-medium">{p.label}</b>
        </button>
      ))}
    </nav>
  )
}

/** One row of a list of widgets: an icon, a text with a second line and an action at the right. */
function Row({ icon, title, sub, action }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 py-1 text-sm">
      <span className="text-muted-foreground" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate font-medium">{title}</b>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      {action}
    </li>
  )
}

/** The notifications of the person, the latest four. */
export function NotesWidget({ href }: { href: string }) {
  const notes = useNoteList({ limit: 4 })
  const items = notes.data?.items ?? []
  return (
    <Widget id="ov-notes" title={t('For you')} link={{ href, label: t('All notifications') }} span>
      {notes.isLoading ? (
        <Loading />
      ) : items.length ? (
        <ul className="grid gap-1">
          {items.map((n) => (
            <NoteRow key={n.id} n={n} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('No notifications')}</p>
      )}
    </Widget>
  )
}

/** The latest events of the tenant: one page of five from the Log. */
export function ActivityWidget({ slug }: { slug: string }) {
  const q = useApi<LogPage>(['ov-activity', slug], `/api/t/${enc(slug)}/manage/log?limit=5`)
  const events: LogEvent[] = q.data?.events ?? []
  return (
    <Widget id="ov-activity" title={t('Recent activity')} link={{ href: to.tenant(slug, 'log'), label: t('Log') }} span>
      {q.isLoading ? (
        <Loading />
      ) : events.length ? (
        <ul className="grid">
          {events.map((e) => (
            <Row
              key={e.id}
              icon={e.ok ? <History className="size-4" /> : <CircleAlert className="size-4 text-destructive" />}
              title={[describe(e), about(e)].filter(Boolean).join(' · ')}
              sub={`${e.user_name || e.username || ''} · ${fmtDate(e.ts)}`}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('Nothing yet.')}</p>
      )}
    </Widget>
  )
}

/** What waits for the Tenant Manager: access requests to decide, invitations not accepted, public shares. */
export function WaitingWidget({ slug, publicLinks }: { slug: string; publicLinks: number }) {
  const requests = useApi<AccessRequest[]>(['requests', slug], `/api/t/${enc(slug)}/requests`)
  const invites = usePaged<Invitation, PageOf<Invitation> & { pending: number }>(['invites', slug], `/api/t/${enc(slug)}/manage/invitations`, {}, 1)
  const nReq = requests.data?.length ?? 0
  const nInv = invites.first?.pending ?? 0
  const loading = requests.isLoading || invites.isLoading
  const open = (href: string, label: string) => (
    <Button variant="outline" size="sm" asChild>
      <a href={href}>{label}</a>
    </Button>
  )
  return (
    <Widget id="ov-waiting" title={t('Waiting for you')}>
      {loading ? (
        <Loading />
      ) : nReq + nInv + publicLinks === 0 ? (
        <p className="text-sm text-muted-foreground">{t('Nothing waiting for you.')}</p>
      ) : (
        <ul className="grid">
          {nReq > 0 && (
            <Row icon={<Lock className="size-4" />} title={t('{count} access requests', { count: nReq })} sub={t('To decide')} action={open(to.tenant(slug, 'manage', 'pending'), t('Decide'))} />
          )}
          {nInv > 0 && <Row icon={<Mail className="size-4" />} title={t('{count} invitations not accepted yet', { count: nInv })} action={open(to.tenant(slug, 'manage', 'pending'), t('See'))} />}
          {publicLinks > 0 && <Row icon={<Share2 className="size-4" />} title={t('{count} active public links', { count: publicLinks })} action={open(to.tenant(slug, 'shares'), t('Review'))} />}
        </ul>
      )}
    </Widget>
  )
}

interface ErrorsData {
  points: { ts: string; requests: number }[]
  requests: number
  errors: number
  latest: {
    ts: string
    action: string
    tenant: string | null
    user: string | null
  }[]
}

const colName = (k: PluginKpi, c: string) => k.columns?.[c] ?? c.replace(/_/g, ' ')

/** What a view of KPIs of a plugin says best: rows with a name and a count are bars (the first ones), one row
 *  of counts is a few figures. Anything else is left to the tables of the page. */
function KpiChart({ k }: { k: PluginKpi }) {
  const rows = k.rows
  if (!rows.length) return null
  const cols = Object.keys(rows[0])
  const num = (c: string) => rows.every((r) => typeof r[c] === 'number')
  const nums = cols.filter(num)
  const name = cols.find((c) => !num(c))
  if (name && nums.length) {
    const data = rows.slice(0, 6).map((r) => ({
      label: String(r[name] ?? '—'),
      value: Number(r[nums[0]]),
    }))
    return (
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">
          {k.label} · {colName(k, nums[0])}
        </span>
        <HBars data={data} label={k.label} />
      </div>
    )
  }
  if (rows.length === 1 && nums.length) {
    return (
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">{k.label}</span>
        <dl className="flex flex-wrap gap-x-5 gap-y-1">
          {nums.map((c) => (
            <div key={c} className="flex flex-col-reverse">
              <dd className="text-lg leading-tight font-semibold tabular-nums">{c === 'bytes' ? fmtBytes(Number(rows[0][c])) : fmtNumber(Number(rows[0][c]))}</dd>
              <dt className="text-xs text-muted-foreground">{colName(k, c)}</dt>
            </div>
          ))}
        </dl>
      </div>
    )
  }
  return null
}

/** One card per app: its items and space in every tenant, the kinds of item as bars and what the plugin
 *  declares as KPIs, as charts. */
function AppCard({ plugin, stats, kpis }: { plugin: string; stats: ResourceStat[]; kpis: PluginKpi[] }) {
  const items = stats.reduce((s, r) => s + r.count - (r.trash_count ?? 0), 0)
  const bytes = stats.reduce((s, r) => s + r.bytes, 0)
  const name = stats[0]?.plugin ?? kpis[0]?.plugin ?? plugin
  const kinds = stats.filter((r) => r.count > 0).sort((a, b) => b.count - a.count)
  const id = `ov-app-${plugin.replace(/[^a-z0-9]/gi, '-')}`
  return (
    <Widget id={id} title={name} icon={<AppIcon id={plugin} name={null} className="size-4 shrink-0 text-primary" />}>
      <div className="flex items-baseline gap-2">
        <b className="text-2xl font-semibold tabular-nums">{fmtNumber(items)}</b>
        <span className="text-xs text-muted-foreground">
          {t('items')} · {fmtBytes(bytes)}
        </span>
      </div>
      {kinds.length > 1 && (
        <HBars
          data={kinds.map((r) => ({
            label: r.kind,
            value: r.count - (r.trash_count ?? 0),
          }))}
          label={t('Items by kind')}
        />
      )}
      {kpis.map((k) => (
        <KpiChart key={k.view} k={k} />
      ))}
    </Widget>
  )
}

/** The widgets of the Administrator. `lead` (the counters, the services) comes first in the same grid; then the
 *  storage of the tenants and of the apps, requests, notifications, recent errors and one card per app. */
export function AdminWidgets({ lead }: { lead?: ReactNode }) {
  const errors = useApi<ErrorsData>(['mon-errors', '12h'], '/api/admin/monitoring/errors?period=12h')
  const kpi = useApi<GlobalKpi>(['admin-kpi'], '/api/admin/kpi')
  const top: TenantInfo[] = [...(kpi.data?.tenants ?? [])]
    .filter((x) => !x.is_system)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5)
  const biggest = Math.max(1, ...top.map((x) => x.bytes))
  // the space by app: the biggest four and the rest together
  const byApp = new Map<string, { label: string; bytes: number }>()
  for (const r of kpi.data?.resources ?? [])
    byApp.set(r.plugin_id, {
      label: r.plugin,
      bytes: (byApp.get(r.plugin_id)?.bytes ?? 0) + r.bytes,
    })
  const sorted = [...byApp.values()].filter((x) => x.bytes > 0).sort((a, b) => b.bytes - a.bytes)
  const donut = sorted.slice(0, 4).map((x) => ({ label: x.label, value: x.bytes, text: fmtBytes(x.bytes) }))
  const rest = sorted.slice(4).reduce((s, x) => s + x.bytes, 0)
  if (rest > 0) donut.push({ label: t('Other apps'), value: rest, text: fmtBytes(rest) })
  const ids = [...new Set([...(kpi.data?.resources ?? []).map((r) => r.plugin_id), ...(kpi.data?.plugins ?? []).map((k) => k.plugin_id)])]
  return (
    <WidgetGrid>
      {lead}
      <Widget id="ov-storage" title={t('Tenants by storage used')} link={{ href: to.admin('tenants'), label: t('All') }} span>
        {kpi.isLoading ? (
          <Loading />
        ) : top.length ? (
          <ul className="grid gap-1.5">
            {top.map((x) => (
              <li key={x.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-3 text-sm">
                <a href={to.adminTenant(x.id)} className="truncate font-medium hover:underline">
                  {x.name}
                </a>
                <span className="h-2 overflow-hidden rounded-r-full bg-muted" role="img" aria-label={fmtBytes(x.bytes)}>
                  <span
                    className="block h-full rounded-r-[4px] bg-primary"
                    style={{
                      width: `${Math.max(2, (x.bytes / biggest) * 100)}%`,
                    }}
                  />
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{fmtBytes(x.bytes)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('No data.')}</p>
        )}
      </Widget>
      <Widget id="ov-space-apps" title={t('Space by app')}>
        {kpi.isLoading ? <Loading /> : donut.length ? <Donut data={donut} label={t('Space by app')} /> : <p className="text-sm text-muted-foreground">{t('No data.')}</p>}
      </Widget>
      <TrendWidget
        id="ov-requests"
        title={t('Requests')}
        figure={fmtNumber(errors.data?.requests ?? 0)}
        caption={t('in the last 12 hours, {n} errors', {
          n: fmtNumber(errors.data?.errors ?? 0),
        })}
        values={(errors.data?.points ?? []).map((p) => p.requests)}
        link={{ href: to.admin('monitoring'), label: t('Monitoring') }}
      />
      <NotesWidget href={to.admin('notifications')} />
      <Widget id="ov-errors" title={t('Recent errors')} link={{ href: to.admin('log'), label: t('Log') }} span>
        {errors.isLoading ? (
          <Loading />
        ) : (errors.data?.latest ?? []).length ? (
          <ul className="grid">
            {errors.data!.latest.slice(0, 3).map((e, i) => (
              <Row key={i} icon={<CircleAlert className="size-4 text-destructive" />} title={describe(e)} sub={[e.tenant, e.user, fmtDate(e.ts)].filter(Boolean).join(' · ')} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('No errors.')}</p>
        )}
      </Widget>
      {ids.length > 0 && <h2 className="-mb-1 text-sm font-semibold @xl:col-span-2 @4xl:col-span-4">{t('Apps, in every tenant')}</h2>}
      {ids.map((id) => (
        <AppCard key={id} plugin={id} stats={(kpi.data?.resources ?? []).filter((r) => r.plugin_id === id)} kpis={(kpi.data?.plugins ?? []).filter((k) => k.plugin_id === id)} />
      ))}
    </WidgetGrid>
  )
}
