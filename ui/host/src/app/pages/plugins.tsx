// Plugins (docs/refactoring-ui.md §3-4): one name for every role, with three kinds — App (pages of its
// own, in the sidebar), Service (behind the scenes), Extension (adds fields and actions to another
// plugin). The Administrator installs, updates and configures them and makes them AVAILABLE to the
// tenants; the Tenant Manager turns ON the available ones and decides their permissions.

import { useRef, useState, type ReactNode } from 'react'
import { ArrowUpCircle, ExternalLink, KeySquare, Power, Puzzle, RotateCcw, Trash2, Upload } from 'lucide-react'
import { api, fmtDate } from '../../api.ts'
import type { AdminPlugin, CatalogItem, ConfigDecl, PluginConfig, PluginKind, PluginTenant, TenantPlugin, UninstallImpact } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAction, useApi, useConfirm } from '../core.ts'
import AppIcon from '../AppIcon.tsx'
import { Empty, ErrorBox, Loading, PageHeader, Pills, SaveBar, StatusBadge, Tabs } from '../kit.tsx'
import { go, to } from '../router.ts'
import { t } from '../i18n.ts'

const enc = encodeURIComponent

const KINDS: PluginKind[] = ['app', 'service', 'extension']

function kindLabel(k: PluginKind | null | undefined): string {
  return k === 'extension' ? t('Extension') : k === 'service' ? t('Service') : t('App')
}

function kindOf(p: { kind?: PluginKind | null; has_ui?: boolean }): PluginKind {
  return p.kind ?? (p.has_ui ? 'app' : 'service')
}

function KindBadge({ kind }: { kind: PluginKind }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {kindLabel(kind)}
    </Badge>
  )
}

/** Filter of the kinds: All, Apps, Services, Extensions. */
function KindPills({ value, onChange, counts }: { value: string; onChange: (k: string) => void; counts: Record<string, number> }) {
  return (
    <Pills
      label={t('Kind')}
      items={[
        { id: 'all', label: t('All'), count: counts.all },
        { id: 'app', label: t('Apps'), count: counts.app },
        { id: 'service', label: t('Services'), count: counts.service },
        { id: 'extension', label: t('Extensions'), count: counts.extension },
      ]}
      value={value}
      onChange={onChange}
    />
  )
}

function countKinds<T extends { kind?: PluginKind | null; has_ui?: boolean }>(rows: T[]): Record<string, number> {
  const c: Record<string, number> = { all: rows.length }
  for (const k of KINDS) c[k] = rows.filter((r) => kindOf(r) === k).length
  return c
}

/* ── Administrator › Plugins ─────────────────────────────────────────── */

/** The plugins of the platform: installed, updates and the catalog of the trusted registries. */
export function AdminPlugins({ section }: { section?: string }) {
  const installed = useApi<AdminPlugin[]>(['admin-plugins'], '/api/admin/plugins')
  const catalog = useApi<CatalogItem[]>(['admin-catalog'], '/api/admin/catalog')
  const confirm = useConfirm()
  const file = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState('all')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const cur = section === 'updates' || section === 'catalog' ? section : 'installed'
  const inval = [['admin-plugins'], ['admin-catalog'], ['admin-overview']]
  const act = useAction(({ id, action }: { id: string; action: 'activate' | 'deactivate' }) => api('POST', `/api/admin/plugins/${enc(id)}/${action}`), { invalidate: inval })
  const uninstall = useAction((id: string) => api('DELETE', `/api/admin/plugins/${enc(id)}`), { invalidate: inval })
  const install = useAction((id: string) => api('POST', `/api/admin/catalog/${enc(id)}/install`), { invalidate: inval })
  const upload = useAction((f: File) => api('POST', '/api/admin/plugins', undefined, { raw: f }), { ok: t('Package installed'), invalidate: inval })
  const updates = (catalog.data ?? []).filter((c) => c.update_available)
  const available = (catalog.data ?? []).filter((c) => !c.installed)
  const byId = new Map((catalog.data ?? []).map((c) => [c.id, c]))
  const rows = (installed.data ?? []).filter((p) => kind === 'all' || kindOf(p) === kind)
  const ids = [...sel].filter((id) => rows.some((r) => r.id === id))
  const picked = rows.filter((r) => ids.includes(r.id))
  async function bulk(what: 'update' | 'off' | 'uninstall') {
    if (what === 'update') {
      for (const p of picked.filter((p) => byId.get(p.id)?.update_available)) await install.mutateAsync(p.id)
    } else if (what === 'off') {
      if (!(await confirm(t('Turn off {n} plugins? They go off in every tenant.', { n: picked.length }), true))) return
      for (const p of picked.filter((p) => p.status === 'active')) await act.mutateAsync({ id: p.id, action: 'deactivate' })
    } else {
      if (!(await confirm(t('Uninstall {n} plugins? Their items are removed from every tenant.', { n: picked.length }), true))) return
      for (const p of picked.filter((p) => !p.dev)) await uninstall.mutateAsync(p.id)
    }
    setSel(new Set())
  }
  return (
    <>
      <PageHeader
        title={t('Plugins')}
        sub={t('Installed on the platform and available in the trusted registries')}
        actions={
          <>
            <input
              ref={file}
              type="file"
              accept=".mskp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) upload.mutate(f)
                e.target.value = ''
              }}
            />
            <Button onClick={() => file.current?.click()}>
              <Upload />
              {t('Install from file')}
            </Button>
          </>
        }
      />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <Pills
          items={[
            { id: 'installed', label: t('Installed'), count: installed.data?.length },
            { id: 'updates', label: t('Updates'), count: updates.length },
            { id: 'catalog', label: t('Catalog'), count: available.length },
          ]}
          value={cur}
          onChange={(id) => go(to.admin('plugins', id === 'installed' ? undefined : id))}
        />
        {cur === 'installed' ? (
          installed.isLoading ? (
            <Loading />
          ) : installed.error ? (
            <ErrorBox error={installed.error} />
          ) : !installed.data?.length ? (
            <Empty icon={<Puzzle />} title={t('No plugin installed')} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <KindPills value={kind} onChange={setKind} counts={countKinds(installed.data)} />
                {ids.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/10 py-1 pr-1 pl-3" role="group" aria-label={t('Actions on the selection')}>
                    <span className="text-sm font-medium tabular-nums">{t('{count} selected', { count: ids.length })}</span>
                    <Button variant="outline" size="sm" disabled={!picked.some((p) => byId.get(p.id)?.update_available)} onClick={() => void bulk('update')}>
                      {t('Update')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void bulk('off')}>
                      {t('Turn off')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void bulk('uninstall')}>
                      {t('Uninstall')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>
                      {t('Deselect')}
                    </Button>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label={t('Select all')}
                          checked={rows.length > 0 && ids.length === rows.length ? true : ids.length ? 'indeterminate' : false}
                          onCheckedChange={(v) => setSel(v ? new Set(rows.map((r) => r.id)) : new Set())}
                        />
                      </TableHead>
                      <TableHead>{t('Plugins')}</TableHead>
                      <TableHead>{t('Kind')}</TableHead>
                      <TableHead>{t('Version')}</TableHead>
                      <TableHead>{t('Signature')}</TableHead>
                      <TableHead>{t('Status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((p) => {
                      const c = byId.get(p.id)
                      return (
                        <TableRow key={p.id} data-state={sel.has(p.id) ? 'selected' : undefined}>
                          <TableCell>
                            <Checkbox
                              aria-label={t('Select {name}', { name: p.label })}
                              checked={sel.has(p.id)}
                              onCheckedChange={(v) => {
                                const n = new Set(sel)
                                if (v) n.add(p.id)
                                else n.delete(p.id)
                                setSel(n)
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <a href={to.adminPlugin(p.id)} className="flex items-center gap-2.5 hover:underline">
                              <AppIcon id={p.id} name={p.icon_name} className="size-5 text-primary" />
                              <span>
                                <b className="block font-medium">{p.label}</b>
                                <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                              </span>
                            </a>
                          </TableCell>
                          <TableCell>
                            <KindBadge kind={kindOf(p)} />
                            {p.dev && (
                              <Badge variant="outline" className="ml-1.5 font-normal">
                                {t('development')}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {p.version}
                            {c?.update_available && <span className="ml-1.5 text-primary-strong">→ {c.latest}</span>}
                          </TableCell>
                          <TableCell className="text-sm">{p.signed_by ?? <span className="text-warn">{t('unsigned')}</span>}</TableCell>
                          <TableCell>
                            <StatusBadge status={p.status} />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )
        ) : catalog.isLoading ? (
          <Loading />
        ) : catalog.error ? (
          <ErrorBox error={catalog.error} />
        ) : (cur === 'updates' ? updates : available).length === 0 ? (
          <Empty icon={<Puzzle />} title={cur === 'updates' ? t('No updates') : t('Nothing to install in the catalog')} />
        ) : (
          <div className="grid gap-3">
            {(cur === 'updates' ? updates : available).map((c) => (
              <Card key={c.id}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {c.name}
                      <KindBadge kind={c.kind ?? 'app'} />
                    </CardTitle>
                    <CardDescription>
                      {c.description}
                      {c.extends && <> · {t('Extends {name}', { name: c.extends })}</>}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs">{c.installed ? `${c.installed} → ${c.latest}` : c.latest}</span>
                    <Button size="sm" disabled={install.isPending} onClick={() => install.mutate(c.id)}>
                      {c.installed ? <ArrowUpCircle /> : null}
                      {c.installed ? t('Update to {v}', { v: c.latest }) : t('Install')}
                    </Button>
                  </div>
                </CardHeader>
                {!!c.notes?.length && (
                  <CardContent className="grid gap-2 text-sm">
                    {c.notes.map((n) => (
                      <div key={n.version}>
                        <b className="font-mono text-xs">{n.version}</b>
                        <p className="whitespace-pre-line text-muted-foreground">{n.notes}</p>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/* ── Administrator › a plugin ────────────────────────────────────────── */

export function AdminPluginPage({ id, tab }: { id: string; tab?: string }) {
  const installed = useApi<AdminPlugin[]>(['admin-plugins'], '/api/admin/plugins')
  const catalog = useApi<CatalogItem[]>(['admin-catalog'], '/api/admin/catalog')
  const confirm = useConfirm()
  const inval = [['admin-plugins'], ['admin-catalog'], ['admin-overview'], ['plugin-tenants', id]]
  const act = useAction((action: 'activate' | 'deactivate') => api('POST', `/api/admin/plugins/${enc(id)}/${action}`), {
    ok: (a) => (a === 'activate' ? t('Plugin turned on') : t('Plugin turned off')),
    invalidate: inval,
  })
  const update = useAction(() => api('POST', `/api/admin/catalog/${enc(id)}/install`), { ok: t('Plugin updated'), invalidate: inval })
  const uninstall = useAction(() => api('DELETE', `/api/admin/plugins/${enc(id)}`), { ok: t('Plugin uninstalled'), invalidate: inval })
  if (installed.isLoading) return <Loading />
  if (installed.error) return <ErrorBox error={installed.error} />
  const p = installed.data?.find((x) => x.id === id)
  if (!p) return <Empty icon={<Puzzle />} title={t('Plugin not installed')} />
  const c = catalog.data?.find((x) => x.id === id)
  const kind = kindOf(p)
  const extensions = (installed.data ?? []).filter((x) => x.extends === id)
  const tabs = [
    { id: 'overview', label: t('Overview') },
    { id: 'requests', label: t('What it asks') },
    { id: 'tenants', label: t('Tenants') },
    ...(p.has_config ? [{ id: 'configuration', label: t('Configuration') }] : []),
    ...(kind !== 'extension' ? [{ id: 'extensions', label: t('Extensions'), count: extensions.length }] : []),
  ]
  const cur = tabs.some((x) => x.id === tab) ? tab! : 'overview'
  async function remove() {
    const impact = await api<UninstallImpact>('GET', `/api/admin/plugins/${enc(id)}/impact`)
    const what = [
      t('{items} items in {tenants} tenants are removed with their shares and links.', { items: impact.items, tenants: impact.tenants }),
      impact.extensions.length ? t('These extensions stop working: {names}.', { names: impact.extensions.join(', ') }) : '',
    ]
      .filter(Boolean)
      .join(' ')
    if (await confirm(`${t('Uninstall {label}?', { label: p!.label })} ${what}`, true)) {
      await uninstall.mutateAsync(undefined)
      go(to.admin('plugins'))
    }
  }
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('Plugins'), href: to.admin('plugins') }]}
        title={p.label}
        badge={<StatusBadge status={p.status} />}
        sub={`${kindLabel(kind)} · ${p.version} · ${p.id}`}
        actions={
          c?.update_available ? (
            <Button disabled={update.isPending} onClick={() => update.mutate(undefined)}>
              <ArrowUpCircle />
              {t('Update to {v}', { v: c.latest })}
            </Button>
          ) : undefined
        }
        more={
          <>
            {p.status === 'active' ? (
              <DropdownMenuItem onSelect={async () => (await confirm(t('Turn off {label}? It goes off in every tenant.', { label: p.label }), true)) && act.mutate('deactivate')}>
                <Power />
                {t('Turn off')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => act.mutate('activate')}>
                <Power />
                {t('Turn on')}
              </DropdownMenuItem>
            )}
            {!p.dev && (
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <Trash2 />
                {t('Uninstall')}
              </DropdownMenuItem>
            )}
          </>
        }
      />
      <Tabs tabs={tabs} current={cur} href={(x) => to.adminPlugin(id, x === 'overview' ? undefined : x)} />
      <div className="p-6 max-[620px]:p-4">
        {cur === 'overview' && <PluginOverview p={p} c={c} all={installed.data ?? []} />}
        {cur === 'requests' && <PluginAsks p={p} base={installed.data?.find((x) => x.id === p.extends)?.label} />}
        {cur === 'tenants' && <PluginTenants id={id} />}
        {cur === 'configuration' && <PluginConfiguration id={id} />}
        {cur === 'extensions' && <PluginExtensions name={p.label} installed={extensions} catalog={(catalog.data ?? []).filter((x) => x.extends === id && !x.installed)} />}
      </div>
    </>
  )
}

function PluginOverview({ p, c, all }: { p: AdminPlugin; c?: CatalogItem; all: AdminPlugin[] }) {
  const base = p.extends ? all.find((x) => x.id === p.extends) : undefined
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <AppIcon id={p.id} name={p.icon_name} className="size-6 text-primary" />
            {p.label}
          </CardTitle>
          <CardDescription>{p.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('Kind')}</dt>
            <dd>{kindLabel(kindOf(p))}</dd>
            {p.extends && (
              <>
                <dt className="text-muted-foreground">{t('Extends')}</dt>
                <dd>
                  {base ? <a className="underline-offset-4 hover:underline" href={to.adminPlugin(base.id)}>{base.label}</a> : <span className="font-mono">{p.extends}</span>}
                  {p.extends_min && p.extends_min !== '0.0.0' && <span className="text-muted-foreground"> · {t('from version {v}', { v: p.extends_min })}</span>}
                  {!base && <span className="text-warn"> · {t('not installed')}</span>}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">{t('Version')}</dt>
            <dd className="font-mono">{p.version}</dd>
            <dt className="text-muted-foreground">{t('Signature')}</dt>
            <dd>{p.signed_by ?? <span className="text-warn">{t('unsigned')}</span>}</dd>
            <dt className="text-muted-foreground">sha256</dt>
            <dd className="font-mono text-xs break-all">{p.sha256}</dd>
            <dt className="text-muted-foreground">{t('Installed')}</dt>
            <dd>{fmtDate(p.installed_at)}</dd>
            {p.min_kernel && (
              <>
                <dt className="text-muted-foreground">{t('Needs Mosaikit')}</dt>
                <dd className="font-mono">{p.min_kernel}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>
      {!!c?.notes?.length && (
        <Card>
          <CardHeader>
            <CardTitle>{c.update_available ? t('What the update brings') : t('Release notes')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {c.notes.map((n) => (
              <div key={n.version}>
                <b className="font-mono text-xs">{n.version}</b>
                <p className="whitespace-pre-line text-muted-foreground">{n.notes}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function AskRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

/** What the plugin asks of the platform: data, files, network, other plugins, permissions. */
function PluginAsks({ p, base }: { p: AdminPlugin; base?: string }) {
  const perm = p.permissions
  const none = <span className="text-muted-foreground">{t('nothing')}</span>
  const list = (v?: string[]) => (v?.length ? <span className="font-mono text-xs">{v.join(', ')}</span> : none)
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('What it asks')}</CardTitle>
          <CardDescription>{t('Declared by its manifest and enforced by the kernel.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <AskRow label={t('Logic on the server')}>{p.has_logic ? t('yes, in a sandbox (WebAssembly)') : none}</AskRow>
            <AskRow label={t('Reacts to changes of')}>{list(perm.hooks)}</AskRow>
            <AskRow label={t('Files on disk')}>{perm.files ? t('yes') : none}</AskRow>
            <AskRow label={t('Folders from zip archives')}>{perm.content ? t('yes') : none}</AskRow>
            <AskRow label={t('Network addresses')}>{list(perm.network)}</AskRow>
            <AskRow label={t('Embeds pages of')}>{list(perm.frame_src)}</AskRow>
            <AskRow label={t('Calls the plugins')}>{list(perm.calls)}</AskRow>
            <AskRow label={t('Database')}>{p.requires?.database ? <span className="font-mono text-xs">{[p.requires.database, ...(p.requires.extensions ?? [])].join(', ')}</span> : t('any')}</AskRow>
          </dl>
        </CardContent>
      </Card>
      {!!p.user_permissions?.length && (
        <Card>
          <CardHeader>
            <CardTitle>{t('Permissions it brings')}</CardTitle>
            <CardDescription>{t('Besides use, create, delete and share: given by the permission profiles of each tenant.')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {p.user_permissions.map((u) => (
              <div key={u.key}>
                <b>{u.label}</b> <span className="font-mono text-xs text-muted-foreground">{u.key}</span>
                {u.description && <p className="text-muted-foreground">{u.description}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {!!(p.extension?.fields.length || p.extension?.actions.length) && (
        <Card>
          <CardHeader>
            <CardTitle>{t('What it adds')}</CardTitle>
            <CardDescription>{t('Fields and actions on the items of {name}, with their permissions.', { name: base ?? p.extends ?? '' })}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {p.extension.fields.map((f) => (
              <div key={f.key}>
                {t('Field')} <b>{f.label}</b> <span className="text-muted-foreground">· {f.resource}</span>
              </div>
            ))}
            {p.extension.actions.map((a) => (
              <div key={a.key}>
                {t('Action')} <b>{a.label}</b> <span className="text-muted-foreground">· {a.resource}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** Tenants: where the plugin is available (the Administrator) and whether each tenant turned it on. */
function PluginTenants({ id }: { id: string }) {
  const q = useApi<{ default: boolean; tenants: PluginTenant[] }>(['plugin-tenants', id], `/api/admin/plugins/${enc(id)}/tenants`)
  const inval = [['plugin-tenants', id]]
  const setOne = useAction(({ tid, available }: { tid: string; available: boolean | null }) => api('PUT', `/api/admin/plugins/${enc(id)}/tenants/${tid}`, { available }), {
    ok: t('Availability updated'),
    invalidate: inval,
  })
  const setDefault = useAction((available: boolean) => api('PUT', `/api/admin/plugins/${enc(id)}/default`, { available }), { ok: t('Availability updated'), invalidate: inval })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  return (
    <div className="grid gap-4">
      <label className="flex max-w-3xl items-center justify-between gap-4 rounded-xl border bg-card p-4">
        <span>
          <b className="block text-sm">{t('Available to every tenant')}</b>
          <span className="text-xs text-muted-foreground">{t('The default, for the new tenants and the ones without a choice of their own.')}</span>
        </span>
        <Switch checked={d.default} onCheckedChange={(v) => setDefault.mutate(v)} aria-label={t('Available to every tenant')} />
      </label>
      {d.tenants.length === 0 ? (
        <Empty title={t('No tenants')} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Tenant')}</TableHead>
                <TableHead>{t('Available')}</TableHead>
                <TableHead>{t('In the tenant')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.tenants.map((x) => (
                <TableRow key={x.tenant_id}>
                  <TableCell>
                    <a className="font-medium hover:underline" href={to.adminTenant(x.tenant_id, 'plugins')}>
                      {x.name}
                    </a>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{x.slug}</span>
                  </TableCell>
                  <TableCell>
                    <Switch checked={x.available} onCheckedChange={(v) => setOne.mutate({ tid: x.tenant_id, available: v })} aria-label={t('Available to {name}', { name: x.name })} />
                    {x.own_choice === null && <span className="ml-2 text-xs text-muted-foreground">{t('default')}</span>}
                  </TableCell>
                  <TableCell>{x.on ? <StatusBadge status="active" /> : !x.available ? <span className="text-sm text-muted-foreground">—</span> : <Badge variant="outline" className="font-normal">{x.enabled ? t('off: needs its plugin') : t('turned off')}</Badge>}</TableCell>
                  <TableCell className="text-right">
                    {x.own_choice !== null && (
                      <Button variant="ghost" size="sm" onClick={() => setOne.mutate({ tid: x.tenant_id, available: null })}>
                        <RotateCcw />
                        {t('Restore')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function ConfigInput({ d, value, onChange }: { d: ConfigDecl; value: unknown; onChange: (v: unknown) => void }) {
  if (d.kind === 'bool') return <Switch checked={value === true} onCheckedChange={onChange} aria-label={d.label} />
  if (d.kind === 'choice')
    return (
      <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
        <SelectTrigger className="w-60" aria-label={d.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(d.options ?? []).map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  return (
    <Input
      className="max-w-md"
      type={d.kind === 'number' ? 'number' : 'text'}
      aria-label={d.label}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onChange(d.kind === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
    />
  )
}

/** Configuration: the settings the plugin declares, chosen by the Administrator for the whole platform. */
function PluginConfiguration({ id }: { id: string }) {
  const q = useApi<PluginConfig>(['plugin-config', id], `/api/admin/plugins/${enc(id)}/config`)
  const [values, setValues] = useState<Record<string, unknown> | null>(null)
  const [secrets, setSecrets] = useState<Record<string, string | null>>({})
  const save = useAction((body: { values: Record<string, unknown>; secrets: Record<string, string | null> }) => api('PUT', `/api/admin/plugins/${enc(id)}/config`, body), {
    ok: t('Settings saved'),
    invalidate: [['plugin-config', id]],
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const c = q.data!
  const v = values ?? c.values
  const dirty = (!!values && JSON.stringify(values) !== JSON.stringify(c.values)) || Object.keys(secrets).length > 0
  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('Configuration')}</CardTitle>
          <CardDescription>{t('For the whole platform. Secrets are encrypted and never shown again.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {c.decls.map((d) => (
            <div key={d.key} className="grid gap-1.5">
              <b className="text-sm">{d.label}</b>
              {d.description && <span className="text-xs text-muted-foreground">{d.description}</span>}
              {d.kind === 'secret' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="max-w-md"
                    type="password"
                    autoComplete="new-password"
                    aria-label={d.label}
                    placeholder={c.secrets.includes(d.key) ? t('Saved: type to replace') : t('Not set')}
                    value={secrets[d.key] ?? ''}
                    onChange={(e) => setSecrets({ ...secrets, [d.key]: e.target.value })}
                  />
                  {c.secrets.includes(d.key) && (
                    <Button variant="ghost" size="sm" onClick={() => setSecrets({ ...secrets, [d.key]: null })}>
                      {t('Remove')}
                    </Button>
                  )}
                </div>
              ) : (
                <ConfigInput d={d} value={v[d.key]} onChange={(x) => setValues({ ...v, [d.key]: x })} />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <SaveBar
        dirty={dirty}
        busy={save.isPending}
        onCancel={() => {
          setValues(null)
          setSecrets({})
        }}
        onSave={() =>
          void save
            .mutateAsync({ values: values ?? {}, secrets: Object.fromEntries(Object.entries(secrets).filter(([, s]) => s === null || s !== '')) })
            .then(() => {
              setValues(null)
              setSecrets({})
            })
        }
      />
    </div>
  )
}

function PluginExtensions({ name, installed, catalog }: { name: string; installed: AdminPlugin[]; catalog: CatalogItem[] }) {
  const install = useAction((x: string) => api('POST', `/api/admin/catalog/${enc(x)}/install`), {
    ok: t('Plugin installed'),
    invalidate: [['admin-plugins'], ['admin-catalog']],
  })
  return (
    <div className="grid max-w-3xl gap-4">
      <p className="text-sm text-muted-foreground">{t('Extensions add fields and actions to {name}. They work in a tenant only where {name} is on.', { name })}</p>
      {installed.length === 0 && catalog.length === 0 ? (
        <Empty icon={<Puzzle />} title={t('No extensions')} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableBody>
              {installed.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <a href={to.adminPlugin(e.id)} className="flex items-center gap-2.5 hover:underline">
                      <AppIcon id={e.id} name={e.icon_name} className="size-5 text-primary" />
                      <b className="font-medium">{e.label}</b>
                    </a>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.version}</TableCell>
                  <TableCell>
                    <StatusBadge status={e.status} />
                  </TableCell>
                </TableRow>
              ))}
              {catalog.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <b className="font-medium">{e.name}</b>
                    <span className="block text-xs text-muted-foreground">{e.description}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.latest}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" disabled={install.isPending} onClick={() => install.mutate(e.id)}>
                      {t('Install')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/* ── Administrator › a tenant › Plugins ──────────────────────────────── */

/** The plugins of the platform in a tenant: available or not, turned on or not (read-only here). */
export function TenantPluginsOfAdmin({ id }: { id: string }) {
  const q = useApi<TenantPlugin[]>(['admin-tenant-plugins', id], `/api/admin/tenants/${id}/plugins`)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  return (
    <div className="grid gap-3">
      <p className="max-w-2xl text-sm text-muted-foreground">{t('Availability is decided in the page of each plugin; the Tenant Manager turns on the available ones.')}</p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Plugins')}</TableHead>
              <TableHead>{t('Kind')}</TableHead>
              <TableHead>{t('Available')}</TableHead>
              <TableHead>{t('In the tenant')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <a href={to.adminPlugin(p.id, 'tenants')} className="flex items-center gap-2.5 hover:underline">
                    <AppIcon id={p.id} name={p.icon} className="size-5 text-primary" />
                    <b className="font-medium">{p.label}</b>
                    <ExternalLink className="size-3.5 text-muted-foreground" />
                  </a>
                </TableCell>
                <TableCell>
                  <KindBadge kind={p.kind} />
                </TableCell>
                <TableCell>{p.available ? t('yes') : t('no')}</TableCell>
                <TableCell>{p.on ? <StatusBadge status="active" /> : <span className="text-sm text-muted-foreground">{offText(p)}</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function offText(p: TenantPlugin): string {
  switch (p.off) {
    case 'unavailable':
      return t('not available')
    case 'turned_off':
      return t('turned off')
    case 'base':
      return t('off: needs its plugin')
    case 'platform':
      return t('off in the platform')
    default:
      return ''
  }
}

/* ── Tenant Manager › Plugins ────────────────────────────────────────── */

/** The plugins the Administrator made available to the tenant, turned on or off by its Tenant Manager. */
export function TenantPlugins({ slug }: { slug: string }) {
  const path = `/api/t/${enc(slug)}/manage/plugins`
  const q = useApi<TenantPlugin[]>(['tenant-plugins', slug], path)
  const confirm = useConfirm()
  const [kind, setKind] = useState('all')
  const set = useAction(({ id, on }: { id: string; on: boolean }) => api('PUT', `${path}/${enc(id)}/on`, { on }), {
    ok: ({ on }) => (on ? t('Turned on for the tenant') : t('Turned off for the tenant')),
    invalidate: [['tenant-plugins', slug], ['ctx', slug]],
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const all = q.data ?? []
  const label = (id: string) => all.find((p) => p.id === id)?.label ?? all.find((p) => p.extends === id)?.extends_label ?? id
  const rows = all.filter((p) => kind === 'all' || p.kind === kind)
  async function toggle(p: TenantPlugin, on: boolean) {
    const ext = p.extensions.filter((e) => all.find((x) => x.id === e)?.on)
    if (!on && ext.length && !(await confirm(t('Turn off {label}? Its extensions go off with it: {names}.', { label: p.label, names: ext.map(label).join(', ') }), true))) return
    set.mutate({ id: p.id, on })
  }
  return (
    <>
      <PageHeader title={t('Plugins')} crumbs={[{ label: t('Tenant management') }]} sub={t('{n} available to the tenant', { n: all.length })} />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t('The Administrator makes them available; here you turn them on for the people of the tenant and decide their permissions. Apps appear in the sidebar, services work behind the scenes, extensions add to another plugin.')}
        </p>
        {all.length === 0 ? (
          <Empty icon={<Puzzle />} title={t('No plugins available')} />
        ) : (
          <>
            <KindPills value={kind} onChange={setKind} counts={countKinds(all)} />
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Plugins')}</TableHead>
                    <TableHead>{t('Kind')}</TableHead>
                    <TableHead>{t('Version')}</TableHead>
                    <TableHead>{t('On')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => {
                    const base = p.extends ? all.find((b) => b.id === p.extends) : undefined
                    const blocked = !!p.extends && !base?.on
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <span className="flex items-center gap-2.5">
                            <AppIcon id={p.id} name={p.icon} className="size-5 text-primary" />
                            <span>
                              <b className="block font-medium">{p.label}</b>
                              <span className="line-clamp-1 text-xs text-muted-foreground">{p.description}</span>
                            </span>
                          </span>
                        </TableCell>
                        <TableCell>
                          <KindBadge kind={p.kind} />
                          {p.extends && <span className="ml-1.5 text-xs text-muted-foreground">{t('Extends {name}', { name: label(p.extends) })}</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{p.version}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <Switch
                              checked={p.enabled && !blocked}
                              disabled={set.isPending || blocked}
                              onCheckedChange={(v) => void toggle(p, v)}
                              aria-label={t('{label} on in the tenant', { label: p.label })}
                            />
                            {blocked && <span className="text-xs text-muted-foreground">{t('Turn on {name} first', { name: label(p.extends!) })}</span>}
                          </span>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button variant="outline" size="sm" onClick={() => go(to.tenant(slug, 'plugins', p.id))}>
                            <KeySquare />
                            {t('Access and permissions')}
                          </Button>
                          {p.has_ui && p.on && (
                            <Button variant="ghost" size="sm" onClick={() => go(to.plugin(slug, p.id))}>
                              {t('Open')}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </>
  )
}
