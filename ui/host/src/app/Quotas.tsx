// Quotas of the tenants (docs/refactoring-ui.md §6): the Administrator sets them (System › Quotas, the
// Details of a tenant), the Tenant Manager reads them in Usage with the trend, who uses the most and the
// alerts, every member sees their own usage in Account › Usage and an alert in the sidebar above 80 %.

import { useState } from 'react'
import { AlertTriangle, Gauge, Pencil, RotateCcw, X } from 'lucide-react'
import { api, fmtBytes } from '../api.ts'
import type { Group, Member, MyUsage, PlatformQuotas, QuotaAlerts, QuotaConsumer, QuotaConsumers, QuotaDay, QuotaLimits, QuotaMetric, QuotaRow, TenantQuotas } from '../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useAction, useApi } from './core.ts'
import { t } from './i18n.ts'
import { Empty, ErrorBox, Loading, Locked, SaveBar } from './kit.tsx'
import { to } from './router.ts'

const enc = encodeURIComponent
const GB = 1024 ** 3
const METRICS: QuotaMetric[] = ['storage', 'people', 'items']

function metricLabel(m: QuotaMetric): string {
  return { storage: t('Storage'), people: t('People'), items: t('Items') }[m]
}

/** A value of a quota as people read it: bytes for storage, a number for the others. */
function fmtQuota(m: QuotaMetric, v: number | null): string {
  if (v === null) return t('no limit')
  return m === 'storage' ? fmtBytes(v) : v.toLocaleString()
}

function atLimit(m: QuotaMetric): string {
  return {
    storage: t('No new files are uploaded; the ones there stay.'),
    people: t('No new people are invited or created.'),
    items: t('No new items are created; the ones there stay.'),
  }[m]
}

function tone(p: number | null): '' | 'warn' | 'bad' {
  if (p === null) return ''
  return p >= 100 ? 'bad' : p >= 80 ? 'warn' : ''
}

/** The bar of a quota (a meter for assistive technologies). */
function Meter({ row }: { row: QuotaRow }) {
  const p = row.percent
  const k = tone(p)
  return (
    <div
      role="meter"
      aria-label={t('{quota}: {used} of {limit}', { quota: metricLabel(row.metric), used: fmtQuota(row.metric, row.used), limit: fmtQuota(row.metric, row.limit) })}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, p ?? 0)}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <span className={cn('block h-full rounded-full bg-primary', k === 'warn' && 'bg-amber-600', k === 'bad' && 'bg-destructive')} style={{ width: `${p === null ? 3 : Math.max(2, Math.min(100, p))}%` }} />
    </div>
  )
}

function usedText(row: QuotaRow): string {
  if (row.limit === null) return t('{used} · no limit', { used: fmtQuota(row.metric, row.used) })
  return t('{used} of {limit} · {p}%', { used: fmtQuota(row.metric, row.used), limit: fmtQuota(row.metric, row.limit), p: String(row.percent ?? 0) })
}

/** The quotas of a tenant with their usage, read only. */
export function QuotaList({ rows, forecast = true }: { rows: QuotaRow[]; forecast?: boolean }) {
  return (
    <ul className="grid gap-5">
      {rows.map((r) => (
        <li key={r.metric} className="grid gap-1.5" data-quota={r.metric}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <b className="text-sm">{metricLabel(r.metric)}</b>
            <span className={cn('text-sm tabular-nums', tone(r.percent) === 'bad' ? 'text-destructive' : tone(r.percent) === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{usedText(r)}</span>
          </div>
          <Meter row={r} />
          {r.limit !== null && <span className="text-xs text-muted-foreground">{t('At the limit: {what}', { what: atLimit(r.metric) })}</span>}
          {forecast && r.limit !== null && r.forecast_days !== null && (r.percent ?? 0) < 100 && (
            <span className={cn('text-xs', r.forecast_days <= 30 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
              {t('At the pace of the last 30 days the limit arrives in about {n} days.', { n: String(r.forecast_days) })}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/* ── Administrator: System › Quotas ───────────────────────────────────── */

function toInput(m: QuotaMetric, v: number | null): string {
  if (v === null) return ''
  return m === 'storage' ? String(Math.round((v / GB) * 100) / 100) : String(v)
}

function fromInput(m: QuotaMetric, s: string): number | null {
  if (s.trim() === '') return null
  const n = Number(s.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  return m === 'storage' ? Math.round(n * GB) : Math.round(n)
}

function unitOf(m: QuotaMetric): string {
  return m === 'storage' ? t('GB') : m === 'people' ? t('people') : t('items')
}

/** A number field of a quota: empty means no limit. */
function QuotaInput({ m, value, onChange, label, disabled }: { m: QuotaMetric; value: string; onChange: (v: string) => void; label: string; disabled?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Input type="number" min={0} step={m === 'storage' ? 0.1 : 1} inputMode="decimal" className="w-32" value={value} placeholder={t('no limit')} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      <span className="text-xs text-muted-foreground">{unitOf(m)}</span>
    </span>
  )
}

type LimitsDraft = Record<QuotaMetric, string>

function draftOf(m: QuotaLimits): LimitsDraft {
  return { storage: toInput('storage', m.storage), people: toInput('people', m.people), items: toInput('items', m.items) }
}

function limitsOf(d: LimitsDraft): QuotaLimits {
  return { storage: fromInput('storage', d.storage), people: fromInput('people', d.people), items: fromInput('items', d.items) }
}

export function PlatformQuotasPanel() {
  const q = useApi<PlatformQuotas>(['admin-quotas'], '/api/admin/quotas')
  const [d, setD] = useState<{ defaults: LimitsDraft; capacity: LimitsDraft } | null>(null)
  const save = useAction((x: { defaults: QuotaLimits; capacity: QuotaLimits }) => api('PUT', '/api/admin/quotas', x), {
    ok: t('Quotas of the platform saved'),
    invalidate: [['admin-quotas'], ['admin-tenant-quotas']],
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const data = q.data!
  const saved = {
    defaults: draftOf({ storage: row(data, 'storage').default, people: row(data, 'people').default, items: row(data, 'items').default }),
    capacity: draftOf({ storage: row(data, 'storage').capacity, people: row(data, 'people').capacity, items: row(data, 'items').capacity }),
  }
  const cur = d ?? saved
  const dirty = !!d && JSON.stringify(d) !== JSON.stringify(saved)
  const over = data.rows.filter((r) => r.over)
  const set = (part: 'defaults' | 'capacity', m: QuotaMetric, v: string) => setD({ ...cur, [part]: { ...cur[part], [m]: v } })
  return (
    <div className="grid max-w-4xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Quotas of new tenants')}</CardTitle>
          <CardDescription>{t('Every tenant takes these, unless it has its own on its page (Tenants › the tenant › Details). Tenant Managers read them in Usage, people in Account › Usage: nobody else changes them. Empty: no limit.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {METRICS.map((m) => (
            <div key={m} className="grid gap-1.5">
              <Label className="text-sm font-semibold">{metricLabel(m)}</Label>
              <QuotaInput m={m} value={cur.defaults[m]} onChange={(v) => set('defaults', m, v)} label={t('Quota of new tenants: {quota}', { quota: metricLabel(m) })} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Capacity of the platform')}</CardTitle>
          <CardDescription>{t('How much the platform has in all, and how much is given to the tenants that are not suspended.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {over.length > 0 && (
            <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <span>
                <b>{t('More is given than the platform has: {list}.', { list: over.map((r) => metricLabel(r.metric).toLowerCase()).join(', ') })}</b> {t('It works while the tenants do not all use their whole quota.')}
              </span>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Quota')}</TableHead>
                  <TableHead>{t('Capacity')}</TableHead>
                  <TableHead className="text-right">{t('Given to the tenants')}</TableHead>
                  <TableHead className="text-right">{t('Used')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.metric}>
                    <TableCell className="font-medium">{metricLabel(r.metric)}</TableCell>
                    <TableCell>
                      <QuotaInput m={r.metric} value={cur.capacity[r.metric]} onChange={(v) => set('capacity', r.metric, v)} label={t('Capacity: {quota}', { quota: metricLabel(r.metric) })} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtQuota(r.metric, r.given)}
                      {r.unlimited > 0 && <span className="block text-xs text-muted-foreground">{t('+ {n} without a limit', { n: String(r.unlimited) })}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtQuota(r.metric, r.used)}</TableCell>
                    <TableCell>{r.capacity === null ? null : r.over ? <Badge variant="destructive">{t('Over the capacity')}</Badge> : <Badge variant="secondary">{t('Within')}</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Tenants')}</CardTitle>
          <CardDescription>{t('The quotas in use for each tenant and what it uses.')}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.tenants.length === 0 ? (
            <Empty title={t('No tenant')} />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Tenant')}</TableHead>
                    {METRICS.map((m) => (
                      <TableHead key={m} className="text-right">
                        {metricLabel(m)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.tenants.map((tn) => (
                    <TableRow key={tn.id}>
                      <TableCell>
                        <a className="font-medium underline-offset-4 hover:underline" href={to.adminTenant(tn.id)}>
                          {tn.name}
                        </a>
                        {tn.status === 'suspended' && <span className="block text-xs text-muted-foreground">{t('Suspended')}</span>}
                      </TableCell>
                      {METRICS.map((m) => (
                        <TableCell key={m} className="text-right tabular-nums">
                          {fmtQuota(m, tn.usage[m])} / {fmtQuota(m, tn.limits[m])}
                          {tn.own.includes(m) && <span className="block text-xs text-muted-foreground">{t('of this tenant')}</span>}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => save.mutate({ defaults: limitsOf(cur.defaults), capacity: limitsOf(cur.capacity) }, { onSuccess: () => setD(null) })} onCancel={() => setD(null)} />
    </div>
  )
}

function row(p: PlatformQuotas, m: QuotaMetric) {
  return p.rows.find((r) => r.metric === m)!
}

/* ── Administrator: the quotas of a tenant ────────────────────────────── */

type OwnDraft = Record<QuotaMetric, { customized: boolean; value: string }>

export function TenantQuotasPanel({ id }: { id: string }) {
  const q = useApi<TenantQuotas>(['admin-tenant-quotas', id], `/api/admin/tenants/${enc(id)}/quotas`)
  const [d, setD] = useState<OwnDraft | null>(null)
  const save = useAction((x: Record<string, { customized: boolean; limit: number | null }>) => api('PUT', `/api/admin/tenants/${enc(id)}/quotas`, x), {
    ok: t('Quotas of the tenant saved'),
    invalidate: [['admin-tenant-quotas', id], ['admin-quotas']],
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const rows = q.data!.rows
  const saved = Object.fromEntries(rows.map((r) => [r.metric, { customized: r.customized, value: toInput(r.metric, r.customized ? r.limit : r.platform) }])) as OwnDraft
  const cur = d ?? saved
  const dirty = !!d && JSON.stringify(d) !== JSON.stringify(saved)
  const set = (m: QuotaMetric, v: Partial<OwnDraft[QuotaMetric]>) => setD({ ...cur, [m]: { ...cur[m], ...v } })
  return (
    <div className="max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>{t('Quotas')}</CardTitle>
          <CardDescription>{t('A tenant takes the quotas of the platform (System › Quotas) unless it has its own. At the limit nothing is deleted: additions stop. The Tenant Manager reads them in Usage.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {rows.map((r) => {
            const own = cur[r.metric].customized
            return (
              <div key={r.metric} className="grid gap-1.5 border-b pb-5 last:border-0 last:pb-0" data-quota={r.metric}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b className="text-sm">{metricLabel(r.metric)}</b>
                  <span className="flex items-center gap-2">
                    <Badge variant={own ? 'default' : 'secondary'}>{own ? t('Of this tenant') : t('Of the platform: {v}', { v: fmtQuota(r.metric, r.platform) })}</Badge>
                    {own ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => set(r.metric, { customized: false, value: toInput(r.metric, r.platform) })}>
                        <RotateCcw />
                        {t('Restore')}
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => set(r.metric, { customized: true })}>
                        <Pencil />
                        {t('Customize')}
                      </Button>
                    )}
                  </span>
                </div>
                <QuotaInput m={r.metric} value={cur[r.metric].value} disabled={!own} onChange={(v) => set(r.metric, { value: v })} label={t('Quota of the tenant: {quota}', { quota: metricLabel(r.metric) })} />
                <span className="text-xs text-muted-foreground">{t('Used: {used}', { used: usedText(r) })}</span>
              </div>
            )
          })}
        </CardContent>
      </Card>
      <SaveBar
        dirty={dirty}
        busy={save.isPending}
        onSave={() =>
          save.mutate(Object.fromEntries(METRICS.map((m) => [m, { customized: cur[m].customized, limit: cur[m].customized ? fromInput(m, cur[m].value) : null }])), {
            onSuccess: () => setD(null),
          })
        }
        onCancel={() => setD(null)}
      />
    </div>
  )
}

/* ── Tenant Manager: Usage ─────────────────────────────────────────────── */

export function UsageQuotas({ slug }: { slug: string }) {
  const q = useApi<TenantQuotas>(['quotas', slug], `/api/t/${enc(slug)}/manage/quotas`)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t('Quotas of the tenant')}
          <Badge variant="secondary">{t('Managed by the Administrator')}</Badge>
        </CardTitle>
        <CardDescription>{t('Set by the Administrator of the platform: here they are read, not changed.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <QuotaList rows={q.data!.rows} />
      </CardContent>
    </Card>
  )
}

/** Bars of one quota over the days, with the same values as a table. */
function TrendChart({ m, days, limit }: { m: QuotaMetric; days: QuotaDay[]; limit: number | null }) {
  const vals = days.map((d) => d[m])
  const max = Math.max(1, limit ?? 0, ...vals)
  const last = vals[vals.length - 1] ?? 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>{metricLabel(m)}</CardTitle>
        <CardDescription>{limit === null ? t('{now} today · no limit', { now: fmtQuota(m, last) }) : t('{now} today · limit {limit}', { now: fmtQuota(m, last), limit: fmtQuota(m, limit) })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div
          className="relative flex h-32 items-end gap-0.5 rounded-lg border bg-muted/30 p-2"
          role="img"
          aria-label={t('{quota} in the last {n} days, from {first} to {last}', { quota: metricLabel(m), n: String(days.length), first: fmtQuota(m, vals[0] ?? 0), last: fmtQuota(m, last) })}
        >
          {limit !== null && <span aria-hidden="true" className="absolute inset-x-2 border-t border-dashed border-destructive/60" style={{ bottom: `calc(${(limit / max) * 100}% - 0px)` }} />}
          {days.map((d) => (
            <span key={d.day} title={`${d.day}: ${fmtQuota(m, d[m])}`} className="min-w-0.5 flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(2, (d[m] / max) * 100)}%` }} />
          ))}
        </div>
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">{t('Show as a table')}</summary>
          <div className="mt-2 max-h-56 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Day')}</TableHead>
                  <TableHead className="text-right">{metricLabel(m)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell className="tabular-nums">{d.day}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtQuota(m, d[m])}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}

export function UsageTrend({ slug }: { slug: string }) {
  const trend = useApi<QuotaDay[]>(['quota-trend', slug], `/api/t/${enc(slug)}/manage/usage/trend?days=180`)
  const q = useApi<TenantQuotas>(['quotas', slug], `/api/t/${enc(slug)}/manage/quotas`)
  if (trend.isLoading || q.isLoading) return <Loading />
  if (trend.error) return <ErrorBox error={trend.error} />
  const days = trend.data!
  if (days.length === 0) return <Empty icon={<Gauge />} title={t('No history yet')} />
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('The usage at the end of each day; the history grows by one day a day.')}</p>
      {METRICS.map((m) => (
        <TrendChart key={m} m={m} days={days} limit={q.data?.rows.find((r) => r.metric === m)?.limit ?? null} />
      ))}
    </div>
  )
}

function ConsumerTable({ title, rows, nameLabel }: { title: string; rows: QuotaConsumer[]; nameLabel: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('Nothing yet.')}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{nameLabel}</TableHead>
                  <TableHead className="text-right">{t('Items')}</TableHead>
                  <TableHead className="text-right">{t('Storage')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.items}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBytes(r.bytes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function UsageConsumers({ slug }: { slug: string }) {
  const q = useApi<QuotaConsumers>(['quota-consumers', slug], `/api/t/${enc(slug)}/manage/usage/consumers`)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const c = q.data!
  return (
    <div className="grid gap-4">
      <ConsumerTable title={t('By person')} rows={c.people} nameLabel={t('Person')} />
      <ConsumerTable title={t('By group')} rows={c.groups} nameLabel={t('Group')} />
      <p className="-mt-2 text-xs text-muted-foreground">{t('A person in two groups counts in both.')}</p>
      <ConsumerTable title={t('By app')} rows={c.plugins} nameLabel={t('Apps')} />
    </div>
  )
}

export function UsageAlerts({ slug }: { slug: string }) {
  const base = `/api/t/${enc(slug)}/manage`
  const q = useApi<QuotaAlerts>(['quota-alerts', slug], `${base}/usage/alerts`)
  const members = useApi<Member[]>(['members', slug], `${base}/members`)
  const groups = useApi<Group[]>(['groups', slug], `${base}/groups`)
  const [d, setD] = useState<QuotaAlerts | null>(null)
  const save = useAction((a: QuotaAlerts) => api('PUT', `${base}/usage/alerts`, a), { ok: t('Alerts saved'), invalidate: [['quota-alerts', slug]] })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const cur = d ?? q.data!
  const dirty = !!d && JSON.stringify(d) !== JSON.stringify(q.data)
  const set = (v: Partial<QuotaAlerts>) => setD({ ...cur, ...v })
  const name = (id: string) => {
    const m = members.data?.find((x) => x.user_id === id)
    return m ? m.display_name || m.username : id
  }
  const gname = (id: string) => groups.data?.find((x) => x.id === id)?.name ?? id
  const toggles: [keyof QuotaAlerts, string, string][] = [
    ['at_80', t('At 80%'), t('There is still time to act')],
    ['at_100', t('At 100%'), t('The quota is used up: additions stop')],
    ['forecast', t('Forecast'), t('If at the current pace the limit arrives within 30 days')],
  ]
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('When to warn')}</CardTitle>
          <CardDescription>{t('One alert for every quota that crosses the threshold, once: it warns again only after the usage went back below it.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1">
          {toggles.map(([k, label, hint]) => (
            <label key={k} className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
              <span>
                <b className="block text-sm">{label}</b>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
              <Switch checked={cur[k] as boolean} onCheckedChange={(on) => set({ [k]: on })} aria-label={label} />
            </label>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Who gets them')}</CardTitle>
          <CardDescription>{t('A notification in the app; by email according to the preferences of each person.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="flex items-center justify-between gap-4">
            <b className="text-sm">{t('The Tenant Managers of the tenant')}</b>
            <Switch checked={cur.managers} onCheckedChange={(on) => set({ managers: on })} aria-label={t('The Tenant Managers of the tenant')} />
          </label>
          <Chips label={t('People')} items={cur.people.map((p) => ({ id: p, name: name(p) }))} onRemove={(id) => set({ people: cur.people.filter((x) => x !== id) })} />
          <AddSelect
            label={t('Add a person')}
            options={(members.data ?? []).filter((m) => m.membership === 'active' && !cur.people.includes(m.user_id)).map((m) => ({ id: m.user_id, name: m.display_name || m.username }))}
            onAdd={(id) => set({ people: [...cur.people, id] })}
          />
          <Chips label={t('Groups')} items={cur.groups.map((g) => ({ id: g, name: gname(g) }))} onRemove={(id) => set({ groups: cur.groups.filter((x) => x !== id) })} />
          <AddSelect label={t('Add a group')} options={(groups.data ?? []).filter((g) => !cur.groups.includes(g.id)).map((g) => ({ id: g.id, name: g.name }))} onAdd={(id) => set({ groups: [...cur.groups, id] })} />
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => save.mutate(cur, { onSuccess: () => setD(null) })} onCancel={() => setD(null)} />
    </div>
  )
}

function Chips({ label, items, onRemove }: { label: string; items: { id: string; name: string }[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {items.map((x) => (
        <li key={x.id} className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-3 text-sm">
          {x.name}
          <Button type="button" variant="ghost" size="icon" className="size-6" aria-label={t('Remove {name}', { name: x.name })} onClick={() => onRemove(x.id)}>
            <X className="size-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  )
}

function AddSelect({ label, options, onAdd }: { label: string; options: { id: string; name: string }[]; onAdd: (id: string) => void }) {
  if (options.length === 0) return null
  return (
    <Select value="" onValueChange={(v) => v && onAdd(v)}>
      <SelectTrigger className="w-64" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/* ── Every member ─────────────────────────────────────────────────────── */

/** Account › Usage: what is left in the tenant. */
export function TenantLeft({ slug }: { slug: string }) {
  const q = useApi<MyUsage>(['my-usage', slug], `/api/t/${enc(slug)}/usage/mine`)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const rows = q.data!.tenant.filter((r) => r.metric !== 'people')
  if (rows.every((r) => r.limit === null)) return <p className="text-xs text-muted-foreground">{t('The tenant has no quotas: there is no limit to what you add.')}</p>
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('What is left in the tenant')}</CardTitle>
        <CardDescription>{t('The quotas of the tenant, set by the Administrator: everybody in the tenant shares them.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <QuotaList rows={rows} forecast={false} />
      </CardContent>
    </Card>
  )
}

/** The alert in the sidebar when a quota passes 80 % (nothing otherwise). */
export function QuotaAlert({ slug, manager, compact }: { slug: string; manager: boolean; compact?: boolean }) {
  const q = useApi<QuotaRow[]>(['quota-near', slug], `/api/t/${enc(slug)}/usage/near`)
  const near = q.data ?? []
  if (near.length === 0) return null
  const worst = near.reduce((a, b) => ((b.percent ?? 0) > (a.percent ?? 0) ? b : a))
  const full = (worst.percent ?? 0) >= 100
  const text = full ? t('{quota}: quota used up', { quota: metricLabel(worst.metric) }) : t('{quota}: {p}% of the quota', { quota: metricLabel(worst.metric), p: String(worst.percent) })
  const href = manager ? to.tenant(slug, 'usage') : to.tenant(slug, 'account', 'usage')
  return (
    <a
      href={href}
      data-quota-alert={worst.metric}
      title={text}
      aria-label={text}
      className={cn(
        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs font-medium',
        full ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
        compact && 'flex-col justify-center gap-0.5 px-0 py-1 text-[10px]',
      )}
    >
      <AlertTriangle className="size-4 shrink-0" />
      {/* with the sidebar closed the icon keeps a visible figure, like the labels of the rail */}
      {compact ? <span aria-hidden="true" className="tabular-nums">{full ? '100%' : `${worst.percent}%`}</span> : <span className="min-w-0 truncate">{text}</span>}
    </a>
  )
}

/** The Usage panel of the overview of the tenant (Tenant Manager). */
export function UsagePanel({ slug }: { slug: string }) {
  const q = useApi<TenantQuotas>(['quotas', slug], `/api/t/${enc(slug)}/manage/quotas`)
  if (!q.data) return null
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('Usage')}</h2>
        <a className="text-sm text-primary underline-offset-4 hover:underline" href={to.tenant(slug, 'usage')}>
          {t('Details')}
        </a>
      </div>
      <QuotaList rows={q.data.rows} forecast={false} />
    </section>
  )
}

/** The quotas in Tenant settings › Managed by the platform: read only, with a link to Usage. */
export function QuotasLocked({ slug }: { slug: string }) {
  const q = useApi<TenantQuotas>(['quotas', slug], `/api/t/${enc(slug)}/manage/quotas`)
  if (!q.data) return null
  const value = q.data.rows.map((r) => `${metricLabel(r.metric)} ${fmtQuota(r.metric, r.limit)}`).join(' · ')
  return (
    <Locked
      label={t('Quotas')}
      value={value}
      hint={
        <a className="underline-offset-4 hover:underline" href={to.tenant(slug, 'usage')}>
          {t('The usage is in Usage')}
        </a>
      }
    />
  )
}
