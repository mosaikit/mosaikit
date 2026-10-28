// Trash, Log and «Shared by me» (docs/refactoring-ui.md §3 and §9; mockup screens trash, activity, audit,
// home). The Log is one component for everyone: the Tenant Manager sees the tenant, the Administrator the
// platform with the tenant of each event; the activity of a person or a group is the same Log with a fixed
// filter.

import { useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Download, History, RotateCcw, Share2, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, appUrl, fmtBytes, fmtDate } from '../../api.ts'
import type { LogEvent, LogPage as LogPageData, Member, PersonRow, Revoked, SharedByMe, TenantInfo, TrashItem, TrashList } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAction, useApi, useConfirm, usePaged, useTenantCtx } from '../core.ts'
import { BulkBar, FilterColumn, ListPage } from '../listkit.tsx'
import { t } from '../i18n.ts'
import { about, describe } from '../logtext.ts'
import { Empty, ErrorBox, FillBody, FillPage, Loading, MoreRows, PageHeader, Pills } from '../kit.tsx'
import { Widget } from '../Overview.tsx'
import { go } from '../router.ts'
import ShareDialog from '../ShareDialog.tsx'

const enc = encodeURIComponent

/** The name of an app: its label in the tenant, otherwise the last part of its id. */
function useAppLabel(slug?: string): (id: string | null | undefined) => string {
  const ctx = useTenantCtx(slug ?? '')
  const plugins = ctx.data?.plugins ?? []
  return (id) => {
    if (!id) return ''
    return plugins.find((p) => p.id === id)?.label ?? id.split('.').pop() ?? id
  }
}

/* ── Trash ───────────────────────────────────────────────────────────── */

/** The trash: what one deleted or owns (the whole tenant for the Tenant Manager), restored with one click. */
export function TrashPage({ slug }: { slug: string }) {
  const ctx = useTenantCtx(slug)
  const confirm = useConfirm()
  const label = useAppLabel(slug)
  const [plugin, setPlugin] = useState('')
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const words = useDeferredValue(search.trim())
  // a page at a time, filtered on the server
  const q = usePaged<TrashItem, TrashList>(['trash', slug, 'page'], `/api/t/${enc(slug)}/trash`, { plugin: plugin || undefined, q: words || undefined })
  const inval = [
    ['trash', slug],
    ['overview', slug],
    ['m-resources', slug],
  ]
  const restore = useAction((ids: string[]) => Promise.all(ids.map((id) => api('POST', `/api/t/${enc(slug)}/trash/${id}/restore`))), {
    ok: (ids) => (ids.length === 1 ? t('Restored') : t('{count} items restored', { count: ids.length })),
    invalidate: inval,
  })
  const purge = useAction((ids: string[]) => Promise.all(ids.map((id) => api('DELETE', `/api/t/${enc(slug)}/trash/${id}`))), {
    ok: (ids) => (ids.length === 1 ? t('Deleted for good') : t('{count} items deleted for good', { count: ids.length })),
    invalidate: inval,
  })
  const empty = useAction(() => api<{ deleted: number }>('POST', `/api/t/${enc(slug)}/trash/empty`), { invalidate: inval })
  const manager = ctx.data?.tenant.role === 'tenant_manager'
  const rows = q.items
  const ids = [...sel].filter((id) => rows.some((r) => r.id === id))
  const restorable = ids.filter((id) => !rows.find((r) => r.id === id)?.inside_deleted)
  const all = rows.length > 0 && ids.length === rows.length
  const days = q.first?.retention_days ?? 30
  const askPurge = async (list: string[]) => {
    if (await confirm(list.length === 1 ? t('Delete it for good? It cannot be restored any more.') : t('Delete {count} items for good? They cannot be restored any more.', { count: list.length }), true)) {
      purge.mutate(list, { onSuccess: () => setSel(new Set()) })
    }
  }
  return (
    <>
      <ListPage
        title={t('Trash')}
        sub={manager ? t('What was deleted in the tenant, kept {days} days before it is deleted for good', { days }) : t('What you deleted, kept {days} days before it is deleted for good', { days })}
        bar={
          <BulkBar
            selected={ids.length}
            total={rows.length}
            all={all}
            onAll={(on) => setSel(on ? new Set(rows.map((r) => r.id)) : new Set())}
            actions={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!restorable.length}
                  onClick={() =>
                    restore.mutate(restorable, {
                      onSuccess: () => setSel(new Set()),
                    })
                  }
                >
                  <RotateCcw />
                  {t('Restore')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => void askPurge(ids)}>
                  <Trash2 />
                  {t('Delete for good')}
                </Button>
              </>
            }
          />
        }
        actions={
          <Button
            variant="outline"
            disabled={!rows.length || empty.isPending}
            onClick={async () => {
              if (await confirm(t('Empty the trash? What you own or deleted is deleted for good.'), true))
                empty.mutate(undefined, {
                  onSuccess: (r) =>
                    toast.success(
                      t('{count} items deleted for good', {
                        count: (r as { deleted: number }).deleted,
                      }),
                    ),
                })
            }}
          >
            <Trash2 />
            {t('Empty the trash')}
          </Button>
        }
        filters={
          <FilterColumn
            search={search}
            onSearch={setSearch}
            searchLabel={t('Search in the trash')}
            onReset={() => {
              setSearch('')
              setPlugin('')
            }}
            groups={[
              {
                id: 'app',
                label: t('Apps'),
                value: plugin || 'all',
                onChange: (v) => setPlugin(v === 'all' ? '' : v),
                options: [
                  { id: 'all', label: t('All apps') },
                  ...(ctx.data?.plugins ?? []).map((p) => ({
                    id: p.id,
                    label: p.label,
                  })),
                ],
              },
            ]}
          />
        }
      >
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : rows.length === 0 ? (
          <Empty icon={<Trash2 />} title={t('The trash is empty')}>
            {t('What you delete stays here {days} days, then it is deleted for good.', { days })}
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox aria-label={t('Select all')} checked={all ? true : ids.length ? 'indeterminate' : false} onCheckedChange={(v) => setSel(v ? new Set(rows.map((r) => r.id)) : new Set())} />
                  </TableHead>
                  <TableHead>{t('Item')}</TableHead>
                  {manager && <TableHead>{t('Owner')}</TableHead>}
                  <TableHead>{t('Deleted')}</TableHead>
                  <TableHead className="text-right">{t('Size')}</TableHead>
                  <TableHead>{t('Deleted for good on')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-state={sel.has(r.id) ? 'selected' : undefined}>
                    <TableCell>
                      <Checkbox
                        aria-label={t('Select {name}', {
                          name: r.title || r.kind,
                        })}
                        checked={sel.has(r.id)}
                        onCheckedChange={(v) => {
                          const n = new Set(sel)
                          if (v) n.add(r.id)
                          else n.delete(r.id)
                          setSel(n)
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <b className="block font-medium">{r.title || <span className="font-normal text-muted-foreground italic">{t('title hidden')}</span>}</b>
                      <span className="text-xs text-muted-foreground">
                        {label(r.plugin_id)} · {r.kind}
                        {r.inside_deleted && ` · ${t('inside another deleted item')}`}
                      </span>
                    </TableCell>
                    {manager && <TableCell>{r.owner_name}</TableCell>}
                    <TableCell>
                      <span className="block">{fmtDate(r.deleted_at)}</span>
                      {r.deleted_by_name && <span className="text-xs text-muted-foreground">{t('by {name}', { name: r.deleted_by_name })}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBytes(r.size_bytes)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(r.purge_at)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" disabled={r.inside_deleted} title={r.inside_deleted ? t('Restore the item that contains it') : undefined} onClick={() => restore.mutate([r.id])}>
                        <RotateCcw />
                        {t('Restore')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('Delete {name} for good', {
                          name: r.title || r.kind,
                        })}
                        onClick={() => void askPurge([r.id])}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <MoreRows shown={rows.length} total={q.total} more={q.more} loading={q.loadingMore} onMore={q.loadMore} />
      </ListPage>
    </>
  )
}

/* ── Shared by me (Home) ─────────────────────────────────────────────── */

/** The items one shared, with whom and with how many links; revoke all or open the Share dialog. */
export function SharedByMeSection({ slug, full }: { slug: string; full?: boolean }) {
  const ctx = useTenantCtx(slug)
  const label = useAppLabel(slug)
  const confirm = useConfirm()
  const qc = useQueryClient()
  const q = usePaged<SharedByMe>(['shared-by-me', slug, 'page'], `/api/t/${enc(slug)}/me/shared`, {}, 5)
  const [sharing, setSharing] = useState<string | null>(null)
  const revoke = useAction((id: string) => api<Revoked>('POST', `/api/t/${enc(slug)}/resources/${id}/revoke-all`), {
    ok: t('Shares and links revoked'),
    invalidate: [['shared-by-me', slug], ['overview', slug]],
  })
  const rows = q.items
  return (
    <Widget id="shared-by-me" title={q.total > 0 ? `${t('Shared by me')} · ${q.total}` : t('Shared by me')} span={!full} full={full}>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('You have not shared anything yet.')}</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
              <Share2 className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <b className="block truncate font-medium">{r.title || r.kind}</b>
                <span className="text-xs text-muted-foreground">
                  {label(r.plugin_id)}
                  {r.shares > 0 && ` · ${t('with {names}', { names: r.with.join(', ') + (r.shares > r.with.length ? ` +${r.shares - r.with.length}` : '') })}`}
                  {r.public_links > 0 && ` · ${t('{count} public links', { count: r.public_links })}`}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSharing(r.id)}>
                {t('Share')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  if (
                    await confirm(
                      t('Revoke every share and public link of «{name}»?', {
                        name: r.title || r.kind,
                      }),
                      true,
                    )
                  )
                    revoke.mutate(r.id)
                }}
              >
                {t('Revoke all')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <MoreRows shown={rows.length} total={q.total} more={q.more} loading={q.loadingMore} onMore={q.loadMore} />
      {ctx.data && (
        <ShareDialog
          ctx={ctx.data}
          resourceId={sharing}
          onClose={() => {
            setSharing(null)
            void qc.invalidateQueries({ queryKey: ['shared-by-me', slug] })
          }}
        />
      )}
    </Widget>
  )
}

/* ── Log ─────────────────────────────────────────────────────────────── */

const WHAT = ['sign_in', 'items', 'sharing', 'people', 'plugins', 'settings'] as const
const WHAT_LABEL: Record<(typeof WHAT)[number], string> = {
  sign_in: 'Sign-in',
  items: 'Items',
  sharing: 'Sharing',
  people: 'People and groups',
  plugins: 'Plugins',
  settings: 'Settings',
}
const PERIODS: { id: string; label: string; hours: number }[] = [
  { id: '24h', label: 'Last 24 hours', hours: 24 },
  { id: '7d', label: 'Last 7 days', hours: 24 * 7 },
  { id: '30d', label: 'Last 30 days', hours: 24 * 30 },
  { id: 'all', label: 'All the period kept', hours: 0 },
]

export interface LogScope {
  /** `/api/t/<t>/manage/log` or `/api/admin/log` */
  api: string
  slug?: string
  admin?: boolean
}

interface Filters {
  failed: boolean
  q: string
  user: string
  what: string
  plugin: string
  period: string
  tenant: string
  resource: string
  group: string
}

const NO_FILTERS: Filters = {
  failed: false,
  q: '',
  user: '',
  what: '',
  plugin: '',
  period: '30d',
  tenant: '',
  resource: '',
  group: '',
}

function query(f: Filters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  if (f.failed) p.set('failed', 'true')
  for (const k of ['q', 'user', 'what', 'plugin', 'tenant', 'resource', 'group'] as const) if (f[k].trim()) p.set(k, f[k].trim())
  const hours = PERIODS.find((x) => x.id === f.period)?.hours ?? 0
  if (hours) p.set('from', new Date(Date.now() - hours * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z'))
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  return p.toString()
}

/** The Log: filters, table with selection and CSV, detail of an event. `fixed` filters are not shown
 *  (the activity of a person or a group). */
export function LogView({ scope, fixed = {}, compact = false }: { scope: LogScope; fixed?: Partial<Filters>; compact?: boolean }) {
  const label = useAppLabel(scope.slug)
  const ctx = useTenantCtx(scope.slug ?? '')
  const [f, setF] = useState<Filters>({ ...NO_FILTERS, ...fixed })
  const deferredQ = useDeferredValue(f.q)
  const active = { ...f, q: deferredQ, ...fixed }
  const qs = query(active)
  const pages = useInfiniteQuery({
    queryKey: ['log', scope.api, qs],
    queryFn: ({ pageParam }) => api<LogPageData>('GET', `${scope.api}?${qs}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
  })
  const events = useMemo(() => pages.data?.pages.flatMap((p) => p.events) ?? [], [pages.data])
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [open, setOpen] = useState<LogEvent | null>(null)
  const people = useApi<(Member | PersonRow)[]>(['log-people', scope.api], compact ? null : scope.admin ? '/api/admin/people' : `/api/t/${enc(scope.slug ?? '')}/manage/members`)
  const tenants = useApi<TenantInfo[]>(['tenants'], scope.admin && !compact ? '/api/admin/tenants' : null)
  const ids = [...sel].filter((id) => events.some((e) => e.id === id))
  const all = events.length > 0 && ids.length === events.length
  const set = (patch: Partial<Filters>) => {
    setF({ ...f, ...patch })
    setSel(new Set())
  }
  const csv = (extra: Record<string, string> = {}) => appUrl(`${scope.api}.csv?${query(active, extra)}`)
  const chip = (text: string, clear: () => void) => (
    <Badge variant="secondary" className="gap-1 py-1 pr-1 font-normal">
      {text}
      <button type="button" className="rounded-sm p-0.5 hover:bg-foreground/10" aria-label={t('Remove the filter {name}', { name: text })} onClick={clear}>
        <X className="size-3" />
      </button>
    </Badge>
  )
  const personName = (id: string) => {
    const p = (people.data ?? []).find((x) => x.user_id === id)
    return p ? p.display_name || p.username : events.find((e) => e.user_id === id)?.user_name || id.slice(0, 8)
  }
  const bar = compact ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <Pills
            items={[
              { id: 'all', label: t('Everything') },
              { id: 'failed', label: t('Only failures') },
            ]}
            value={f.failed ? 'failed' : 'all'}
            onChange={(v) => set({ failed: v === 'failed' })}
          />
          <Input type="search" className="h-8 w-56 max-w-full" placeholder={t('Search in the log')} aria-label={t('Search in the log')} value={f.q} onChange={(e) => set({ q: e.target.value })} />
          <Select value={f.user || 'all'} onValueChange={(v) => set({ user: v === 'all' ? '' : v })}>
            <SelectTrigger size="sm" className="w-44" aria-label={t('Who')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{t('Everybody')}</SelectItem>
              {(people.data ?? []).map((p) => (
                <SelectItem key={p.user_id} value={p.user_id}>
                  {p.display_name || p.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={f.what || 'all'} onValueChange={(v) => set({ what: v === 'all' ? '' : v })}>
            <SelectTrigger size="sm" className="w-44" aria-label={t('What')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('Every kind of event')}</SelectItem>
              {WHAT.map((w) => (
                <SelectItem key={w} value={w}>
                  {t(WHAT_LABEL[w])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!scope.admin && (
            <Select value={f.plugin || 'all'} onValueChange={(v) => set({ plugin: v === 'all' ? '' : v })}>
              <SelectTrigger size="sm" className="w-40" aria-label={t('On what')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('All apps')}</SelectItem>
                {(ctx.data?.plugins ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {scope.admin && (
            <Select value={f.tenant || 'all'} onValueChange={(v) => set({ tenant: v === 'all' ? '' : v })}>
              <SelectTrigger size="sm" className="w-44" aria-label={t('Tenant')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">{t('All tenants')}</SelectItem>
                {(tenants.data ?? []).map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={f.period} onValueChange={(v) => set({ period: v })}>
            <SelectTrigger size="sm" className="w-48" aria-label={t('Period')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {t(p.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {f.resource && chip(t('Only this item'), () => set({ resource: '' }))}
          {ids.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/10 py-1 pr-1 pl-3" role="group" aria-label={t('Actions on the selection')}>
              <span className="text-sm font-medium tabular-nums">{t('{count} selected', { count: ids.length })}</span>
              <Button variant="outline" size="sm" asChild>
                <a href={csv({ ids: ids.join(',') })} download>
                  <Download />
                  {t('Export the selected')}
                </a>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>
                {t('Deselect')}
              </Button>
            </div>
          )}
        </div>
  )
  const list = (
    <>
      {pages.isLoading ? (
        <Loading />
      ) : pages.error ? (
        <ErrorBox error={pages.error} />
      ) : events.length === 0 ? (
        <Empty icon={<History />} title={compact ? t('No activity yet') : t('No event with these filters')} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {!compact && (
                  <TableHead className="w-10">
                    <Checkbox aria-label={t('Select all')} checked={all ? true : ids.length ? 'indeterminate' : false} onCheckedChange={(v) => setSel(v ? new Set(events.map((e) => e.id)) : new Set())} />
                  </TableHead>
                )}
                <TableHead>{t('When')}</TableHead>
                {!compact && <TableHead>{t('Who')}</TableHead>}
                <TableHead>{t('What')}</TableHead>
                <TableHead>{t('On what')}</TableHead>
                {scope.admin && <TableHead>{t('Tenant')}</TableHead>}
                <TableHead>{t('Result')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id} className="cursor-pointer" data-state={sel.has(e.id) ? 'selected' : undefined} onClick={() => setOpen(e)}>
                  {!compact && (
                    <TableCell onClick={(ev) => ev.stopPropagation()}>
                      <Checkbox
                        aria-label={t('Select the event of {when}', {
                          when: fmtDate(e.ts),
                        })}
                        checked={sel.has(e.id)}
                        onCheckedChange={(v) => {
                          const n = new Set(sel)
                          if (v) n.add(e.id)
                          else n.delete(e.id)
                          setSel(n)
                        }}
                      />
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(e.ts)}</TableCell>
                  {!compact && <TableCell>{e.user_name ?? <span className="text-muted-foreground">{t('nobody (system)')}</span>}</TableCell>}
                  <TableCell>
                    <button type="button" className="text-left font-medium hover:underline" onClick={(ev) => (ev.stopPropagation(), setOpen(e))}>
                      {describe(e)}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-72 truncate">
                    {about(e)}
                    {e.plugin_id && <span className="text-xs text-muted-foreground">{about(e) ? ' · ' : ''}{label(e.plugin_id)}</span>}
                  </TableCell>
                  {scope.admin && <TableCell>{e.tenant_name ?? '—'}</TableCell>}
                  <TableCell>
                    {e.ok ? (
                      <span className="text-sm text-muted-foreground">{t('Done')}</span>
                    ) : (
                      <Badge variant="secondary" className="gap-1 bg-destructive/10 font-normal text-destructive dark:text-red-300">
                        <CircleAlert className="size-3" />
                        {t('Failed')}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {events.length > 0 && <MoreRows shown={events.length} total={null} more={!!pages.hasNextPage} loading={pages.isFetchingNextPage} onMore={() => void pages.fetchNextPage()} label={t('Older events')} />}
      {!compact && events.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <a className="underline-offset-4 hover:underline" href={csv()} download>
            {t('Export everything as CSV')}
          </a>
        </p>
      )}
      <EventSheet
        e={open}
        label={label}
        admin={scope.admin}
        onClose={() => setOpen(null)}
        onPerson={
          compact
            ? undefined
            : (id) => {
                set({ user: id })
                setOpen(null)
              }
        }
        onItem={
          compact
            ? undefined
            : (id) => {
                set({ resource: id })
                setOpen(null)
              }
        }
        personName={personName}
      />
    </>
  )
  // the filters stay on top of the Log; the list scrolls under them
  if (!compact)
    return (
      <>
        <div className="shrink-0 border-b px-6 py-3 max-[620px]:px-4">{bar}</div>
        <FillBody className="grid content-start gap-3 p-6 max-[620px]:p-4">{list}</FillBody>
      </>
    )
  return <div className="grid gap-3">{list}</div>
}

function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

/** The detail of an event, in a side pane: everything it says, and the filters on its person or item. */
function EventSheet({
  e,
  label,
  admin,
  onClose,
  onPerson,
  onItem,
  personName,
}: {
  e: LogEvent | null
  label: (id: string | null | undefined) => string
  admin?: boolean
  onClose: () => void
  onPerson?: (id: string) => void
  onItem?: (id: string) => void
  personName: (id: string) => string
}) {
  const detail = e && Object.keys(e.detail ?? {}).length ? JSON.stringify(e.detail, null, 2) : ''
  return (
    <Sheet open={!!e} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[min(30rem,100vw)] sm:max-w-none">
        {e && (
          <>
            <SheetHeader>
              <SheetTitle>{describe(e)}</SheetTitle>
              <SheetDescription>{fmtDate(e.ts)}</SheetDescription>
            </SheetHeader>
            <div className="grid gap-4 overflow-y-auto px-4 pb-6">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
                <Field k={t('Who')}>{e.user_id ? `${e.user_name ?? personName(e.user_id)} (${e.username ?? ''})` : t('nobody (system)')}</Field>
                {admin && <Field k={t('Tenant')}>{e.tenant_name ?? '—'}</Field>}
                <Field k={t('Result')}>{e.ok ? t('Done') : t('Failed')}</Field>
                {e.plugin_id && <Field k={t('App')}>{label(e.plugin_id)}</Field>}
                {e.resource_id && <Field k={t('Item')}>{e.resource_title || (typeof e.detail?.title === 'string' && e.detail.title) || <span className="font-mono text-xs">{e.resource_id}</span>}</Field>}
                <Field k={t('Event')}>
                  <span className="font-mono text-xs">{e.action}</span>
                </Field>
                {e.ip && (
                  <Field k={t('Address')}>
                    <span className="font-mono text-xs">{e.ip}</span>
                  </Field>
                )}
                {e.agent && (
                  <Field k={t('Browser')}>
                    <span className="text-xs">{e.agent}</span>
                  </Field>
                )}
              </dl>
              {detail && (
                <div className="grid gap-1">
                  <span className="text-sm text-muted-foreground">{t('Details')}</span>
                  <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{detail}</pre>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {onPerson && e.user_id && (
                  <Button variant="outline" size="sm" onClick={() => onPerson(e.user_id!)}>
                    {t('Only {name}', {
                      name: e.user_name ?? personName(e.user_id),
                    })}
                  </Button>
                )}
                {onItem && e.resource_id && (
                  <Button variant="outline" size="sm" onClick={() => onItem(e.resource_id!)}>
                    {t('Only this item')}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** The Log page of the Tenant Manager or of the Administrator. */
export function LogPage({ slug }: { slug?: string }) {
  const ctx = useTenantCtx(slug ?? '')
  if (slug && ctx.isLoading) return <Loading />
  if (slug && ctx.data?.tenant.role !== 'tenant_manager') return <Empty title={t('Reserved to Tenant Managers')} />
  const scope: LogScope = slug ? { api: `/api/t/${enc(slug)}/manage/log`, slug } : { api: '/api/admin/log', admin: true }
  return (
    <FillPage>
      <PageHeader
        title={t('Log')}
        crumbs={[{ label: slug ? t('Tenant management') : t('Platform') }]}
        sub={
          slug
            ? t('What happened in {name}: who, what, on what, when', {
                name: ctx.data?.tenant.name ?? '',
              })
            : t('What happened on the platform, in every tenant')
        }
      />
      <LogView scope={scope} />
    </FillPage>
  )
}

/** The activity of a person or a group: the Log with a fixed filter, and the way to the whole Log. */
export function ActivityLog({ scope, fixed, more }: { scope: LogScope; fixed: Partial<Filters>; more?: string }) {
  return (
    <div className="grid gap-3">
      <LogView scope={scope} fixed={{ ...fixed, period: 'all' }} compact />
      {more && (
        <p className="text-sm">
          <a className="text-primary underline-offset-4 hover:underline" href={more} onClick={(e) => (e.preventDefault(), go(more))}>
            {t('See everything in the log')}
          </a>
        </p>
      )}
    </div>
  )
}
