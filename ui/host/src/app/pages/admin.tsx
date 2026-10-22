// Pages of the Administrator: platform overview, tenants and their tabbed detail, plugins, System
// (administrators, identity and top bar). Account and Notifications are in common.tsx and notifications.tsx.

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Building2, CircleHelp, Contrast, Info, KeyRound, MoreHorizontal, Palette, PanelLeft, PanelTop, Plus, Power, Puzzle, Search, ShieldCheck, Trash2, Upload, Users } from 'lucide-react'
import { api, fmtBytes, fmtDate } from '../../api.ts'
import { useBrand } from '../../brand.ts'
import type { AdminPlugin, AdminUser, CatalogItem, GlobalKpi, Member, Session, ShellBand, SystemOverview, TenantInfo } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { initials, useAction, useApi, useConfirm } from '../core.ts'
import AppIcon from '../AppIcon.tsx'
import { DataTable, Empty, ErrorBox, FormDialog, Kpi, Loading, PageHeader, Pills, PluginKpis, SaveBar, Sections, StatusBadge, Tabs } from '../kit.tsx'
import { go, to } from '../router.ts'
import { bandOf } from '../prefs.ts'
import { AppMark } from '../Shell.tsx'
import { PlatformTheme } from '../ThemeSettings.tsx'
import { t } from '../i18n.ts'

const enc = encodeURIComponent

/* ── Overview ────────────────────────────────────────────────────────── */

export function AdminOverview({ session }: { session: Session }) {
  const q = useApi<SystemOverview>(['admin-overview'], '/api/admin/overview')
  const kpi = useApi<GlobalKpi>(['admin-kpi'], '/api/admin/kpi')
  return (
    <>
      <PageHeader title={t('Platform overview')} sub={t('Hello {name} · Administrator', { name: session.user.display_name || session.user.username })} />
      <div className="grid gap-6 p-6 max-[620px]:p-4">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            <Kpi label={t('Active tenants')} value={`${q.data!.active_tenants}/${q.data!.tenants}`} onClick={() => go(to.admin('tenants'))} />
            <Kpi label={t('Active users')} value={q.data!.users} hint={t('{n} in the last 30 days', { n: q.data!.active_users_30d })} />
            <Kpi label={t('Administrators')} value={q.data!.administrators} onClick={() => go(to.admin('system', 'admins'))} />
            <Kpi label={t('Items')} value={q.data!.resources} hint={fmtBytes(q.data!.bytes)} />
            <Kpi label={t('Active plugins')} value={`${q.data!.plugins_active}/${q.data!.plugins_installed}`} onClick={() => go(to.admin('plugins'))} />
          </div>
        )}
        {q.data?.tenants === 0 && (
          <Empty icon={<Building2 />} title={t('No tenants')}>
            <Button className="mt-2" onClick={() => go(to.admin('tenants'))}>
              {t('Create the first tenant')}
            </Button>
          </Empty>
        )}
        {kpi.data && kpi.data.resources.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">{t('Items by plugin, in every tenant')}</h2>
            <DataTable
              label={t('Items by plugin, in every tenant')}
              rows={kpi.data.resources.map((r) => ({ [t('Plugins')]: r.plugin, [t('Kind')]: r.kind, [t('Items')]: r.count, [t('Space')]: fmtBytes(r.bytes) }))}
            />
          </section>
        )}
        {kpi.data && <PluginKpis items={kpi.data.plugins} />}
      </div>
    </>
  )
}

/* ── Tenant ──────────────────────────────────────────────────────────── */

export function AdminTenants() {
  const q = useApi<TenantInfo[]>(['admin-tenants'], '/api/admin/tenants')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const create = useAction((v: Record<string, string>) => api('POST', '/api/admin/tenants', v), {
    ok: (v) => t('Tenant {name} created with its Tenant Manager', { name: v.name }),
    invalidate: [['admin-tenants'], ['admin-overview']],
  })
  const rows = (q.data ?? []).filter((tn) => !search || `${tn.name} ${tn.slug}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <PageHeader
        title={t('Tenant')}
        sub={q.data ? `${q.data.length} tenant` : undefined}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus />
            {t('New tenant')}
          </Button>
        }
      />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <Input type="search" placeholder={t('Search a tenant')} aria-label={t('Search a tenant')} className="w-72 max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : rows.length === 0 ? (
          <Empty icon={<Building2 />} title={q.data?.length ? t('No tenant found') : t('No tenants')} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Tenant')}</TableHead>
                  <TableHead className="text-right">{t('Members')}</TableHead>
                  <TableHead className="text-right">{t('Guests')}</TableHead>
                  <TableHead className="text-right">{t('Items')}</TableHead>
                  <TableHead className="text-right">{t('Space')}</TableHead>
                  <TableHead>{t('Status')}</TableHead>
                  <TableHead>{t('Created')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((tn) => (
                  <TableRow key={tn.id} className="cursor-pointer" onClick={() => go(to.adminTenant(tn.id))}>
                    <TableCell>
                      <a href={to.adminTenant(tn.id)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {tn.name}
                      </a>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{tn.slug}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{tn.members}</TableCell>
                    <TableCell className="text-right tabular-nums">{tn.guests}</TableCell>
                    <TableCell className="text-right tabular-nums">{tn.resources}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBytes(tn.bytes)}</TableCell>
                    <TableCell>
                      <StatusBadge status={tn.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(tn.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('New tenant')}
        description={t('With its first Tenant Manager, a local account of the tenant.')}
        fields={[
          { name: 'slug', label: t('Identifier'), required: true, hint: t('Lowercase letters, digits and hyphens: it goes in the address and does not change') },
          { name: 'name', label: t('Name'), required: true },
          { name: 'manager_username', label: t('Username of the Tenant Manager'), required: true },
          { name: 'manager_display_name', label: t('Name of the Tenant Manager') },
          { name: 'manager_password', label: t('Initial password'), type: 'password', required: true, hint: t('At least 10 characters') },
        ]}
        submit={t('Create the tenant')}
        onSubmit={(v) => create.mutateAsync(v)}
      />
    </>
  )
}

export function AdminTenant({ id, section }: { id: string; section?: string }) {
  const tenants = useApi<TenantInfo[]>(['admin-tenants'], '/api/admin/tenants')
  const members = useApi<Member[]>(['admin-members', id], `/api/admin/tenants/${id}/members`)
  const confirm = useConfirm()
  const tn = tenants.data?.find((x) => x.id === id)
  const cur = section === 'users' ? 'users' : 'details'
  const toggle = async () => {
    const next = tn!.status === 'active' ? 'suspended' : 'active'
    if (next === 'active' || (await confirm(t('Suspend {name}? Its people will no longer be able to sign in.', { name: tn!.name }), true))) status.mutate(next)
  }
  const status = useAction((s: string) => api('PUT', `/api/admin/tenants/${id}/status`, { status: s }), {
    ok: (s) => (s === 'active' ? t('Tenant reactivated') : t('Tenant suspended')),
    invalidate: [['admin-tenants'], ['admin-overview']],
  })
  if (tenants.isLoading) return <Loading />
  if (!tn) return <Empty title={t('No such tenant')} />
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('Tenant'), href: to.admin('tenants') }]}
        title={tn.name}
        badge={<StatusBadge status={tn.status} />}
        sub={t('{slug} · {members} members · {guests} guests', { slug: tn.slug, members: tn.members, guests: tn.guests })}
        more={
          <DropdownMenuItem variant={tn.status === 'active' ? 'destructive' : 'default'} onSelect={() => void toggle()}>
            <Power />
            {tn.status === 'active' ? t('Suspend the tenant') : t('Reactivate the tenant')}
          </DropdownMenuItem>
        }
      />
      <Tabs
        tabs={[
          { id: 'details', label: t('Details') },
          { id: 'users', label: t('Users and managers'), count: members.data?.length },
        ]}
        current={cur}
        href={(s) => to.adminTenant(id, s === 'details' ? undefined : s)}
      />
      <div className="p-6 max-[620px]:p-4">

        {cur === 'details' ? (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>{t('Tenant')}</CardTitle>
              <CardDescription>{t('Sign-in with local accounts. Sign-in with an identity provider (OIDC) comes later.')}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t('Name')}</dt>
                <dd>{tn.name}</dd>
                <dt className="text-muted-foreground">{t('Identifier')}</dt>
                <dd className="font-mono">{tn.slug}</dd>
                <dt className="text-muted-foreground">{t('Sign-in')}</dt>
                <dd>{t('Local accounts')}</dd>
                <dt className="text-muted-foreground">{t('Items')}</dt>
                <dd>
                  {tn.resources} · {fmtBytes(tn.bytes)}
                </dd>
                <dt className="text-muted-foreground">{t('Created')}</dt>
                <dd>{fmtDate(tn.created_at)}</dd>
              </dl>
            </CardContent>
          </Card>
        ) : (
          <TenantUsers id={id} q={members} />
        )}
      </div>
    </>
  )
}

function TenantUsers({ id, q }: { id: string; q: { data?: Member[]; isLoading: boolean; error: unknown } }) {
  const base = `/api/admin/tenants/${id}`
  const [dlg, setDlg] = useState<null | 'manager' | Member>(null)
  const inval = [['admin-members', id], ['admin-tenants']]
  const setRole = useAction(({ uid, role }: { uid: string; role: string }) => api('PUT', `${base}/members/${uid}/role`, { role }), { ok: t('Role updated'), invalidate: inval })
  const newManager = useAction((v: Record<string, string>) => api('POST', `${base}/managers`, v), { ok: (v) => t('{username} is Tenant Manager', { username: v.username }), invalidate: inval })
  const resetPw = useAction(({ uid, password }: { uid: string; password: string }) => api('POST', `${base}/members/${uid}/password`, { password }), { ok: t('Password reset') })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">{t('Users and roles, never the contents: to appoint or replace a Tenant Manager and to unlock a sign-in.')}</p>
        <Button variant="outline" onClick={() => setDlg('manager')}>
          <Plus />
          {t('New Tenant Manager')}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Username')}</TableHead>
              <TableHead className="w-48">{t('Role')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((m) => (
              <TableRow key={m.user_id}>
                <TableCell>
                  <div className="font-medium">{m.display_name || m.username}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.username}@{m.home_tenant}
                    {m.is_guest && ' · ospite'}
                  </div>
                </TableCell>
                <TableCell>
                  <Select value={m.role} onValueChange={(role) => setRole.mutate({ uid: m.user_id, role })}>
                    <SelectTrigger size="sm" aria-label={t('Role of {username}', { username: m.username })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tenant_manager">{t('Tenant Manager')}</SelectItem>
                      <SelectItem value="user">{t('User')}</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <StatusBadge status={m.status} />
                </TableCell>
                <TableCell>
                  {!m.is_guest && (
                    <Button variant="ghost" size="icon" aria-label={t('Reset the password of {username}', { username: m.username })} onClick={() => setDlg(m)}>
                      <KeyRound />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormDialog
        open={dlg === 'manager'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('New Tenant Manager')}
        description={t('A local account of the tenant, with the Tenant Manager role.')}
        fields={[
          { name: 'username', label: t('Username'), required: true },
          { name: 'display_name', label: t('Name') },
          { name: 'password', label: t('Initial password'), type: 'password', required: true, hint: t('At least 10 characters') },
        ]}
        submit={t('Create')}
        onSubmit={(v) => newManager.mutateAsync(v)}
      />
      <FormDialog
        open={!!dlg && dlg !== 'manager'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('New password for {v}', { v: dlg && dlg !== 'manager' ? dlg.username : '' })}
        fields={[{ name: 'password', label: t('New password'), type: 'password', required: true, hint: t('At least 10 characters') }]}
        submit={t('Reset')}
        onSubmit={(v) => resetPw.mutateAsync({ uid: (dlg as Member).user_id, password: v.password })}
      />
    </div>
  )
}

/* ── Plugins ─────────────────────────────────────────────────────────── */

/** The plugins of the platform: installed (on or not) and the catalog of the trusted registries. A plugin
 *  with pages of its own is an App, without them a Service (docs/refactoring-ui.md §4). */
export function AdminPlugins({ section }: { section?: string }) {
  const installed = useApi<AdminPlugin[]>(['admin-plugins'], '/api/admin/plugins')
  const catalog = useApi<CatalogItem[]>(['admin-catalog'], '/api/admin/catalog')
  const confirm = useConfirm()
  const file = useRef<HTMLInputElement>(null)
  const cur = section === 'updates' || section === 'catalog' ? section : 'installed'
  const inval = [['admin-plugins'], ['admin-catalog'], ['admin-overview']]
  const act = useAction(({ id, action }: { id: string; action: 'activate' | 'deactivate' }) => api('POST', `/api/admin/plugins/${enc(id)}/${action}`), {
    ok: ({ action }) => (action === 'activate' ? t('Plugin turned on') : t('Plugin turned off')),
    invalidate: inval,
  })
  const uninstall = useAction((id: string) => api('DELETE', `/api/admin/plugins/${enc(id)}`), { ok: t('Plugin uninstalled'), invalidate: inval })
  const install = useAction((id: string) => api('POST', `/api/admin/catalog/${enc(id)}/install`), { ok: t('Plugin installed'), invalidate: inval })
  const upload = useAction((f: File) => api('POST', '/api/admin/plugins', undefined, { raw: f }), { ok: t('Package installed'), invalidate: inval })
  const updates = (catalog.data ?? []).filter((c) => c.update_available)
  const available = (catalog.data ?? []).filter((c) => !c.installed)
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
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Plugins')}</TableHead>
                    <TableHead>{t('Kind')}</TableHead>
                    <TableHead>{t('Version')}</TableHead>
                    <TableHead>{t('Signature')}</TableHead>
                    <TableHead>{t('Status')}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {installed.data.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <span className="flex items-center gap-2.5">
                          <AppIcon id={p.id} className="size-5 text-primary" />
                          <span>
                            <b className="block font-medium">{p.label}</b>
                            <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          {p.has_ui ? t('App') : t('Service')}
                        </Badge>
                        {p.dev && (
                          <Badge variant="outline" className="ml-1.5 font-normal">
                            {t('development')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.version}</TableCell>
                      <TableCell className="text-sm">{p.signed_by ?? <span className="text-warn">{t('unsigned')}</span>}</TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={t('Actions for {label}', { label: p.label })}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {p.status === 'active' ? (
                              <DropdownMenuItem onSelect={async () => (await confirm(t('Turn off {label}? It goes off in every tenant.', { label: p.label }), true)) && act.mutate({ id: p.id, action: 'deactivate' })}>
                                <Power />
                                {t('Turn off')}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => act.mutate({ id: p.id, action: 'activate' })}>
                                <Power />
                                {t('Turn on')}
                              </DropdownMenuItem>
                            )}
                            {!p.dev && (
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={async () => (await confirm(t('Uninstall {label}? Its data stay in the database.', { label: p.label }), true)) && uninstall.mutate(p.id)}
                              >
                                <Trash2 />
                                {t('Uninstall')}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        ) : catalog.isLoading ? (
          <Loading />
        ) : catalog.error ? (
          <ErrorBox error={catalog.error} />
        ) : (cur === 'updates' ? updates : available).length === 0 ? (
          <Empty icon={<Puzzle />} title={cur === 'updates' ? t('No updates') : t('Nothing to install in the catalog')} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Plugins')}</TableHead>
                  <TableHead>{t('Version')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(cur === 'updates' ? updates : available).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <b className="block font-medium">{c.name}</b>
                      <span className="line-clamp-1 text-xs text-muted-foreground">{c.description}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.installed ? `${c.installed} → ${c.latest}` : c.latest}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={install.isPending} onClick={() => install.mutate(c.id)}>
                        {c.installed ? t('Update') : t('Install')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  )
}

/* ── System ──────────────────────────────────────────────────────────── */

export function AdminSystem({ session, section }: { session: Session; section?: string }) {
  const sections = [
    { id: 'admins', label: t('Administrators'), icon: <ShieldCheck />, group: t('Platform') },
    { id: 'identity', label: t('Identity and texts'), icon: <Info />, group: t('Identity and appearance') },
    { id: 'theme', label: t('Theme'), icon: <Palette /> },
    { id: 'topbar', label: t('Top bar'), icon: <PanelTop /> },
  ]
  const cur = sections.some((s) => s.id === section) ? section! : 'admins'
  return (
    <>
      <PageHeader title={t('System')} sub={t('Settings of the platform, for every tenant')} />
      <Sections sections={sections} current={cur} href={(id) => to.admin('system', id)}>
        {cur === 'admins' && <Admins me={session.user.user_id} />}
        {cur === 'identity' && <Identity />}
        {cur === 'theme' && <PlatformTheme session={session} />}
        {cur === 'topbar' && <BandSettings session={session} />}
      </Sections>
    </>
  )
}

function Identity() {
  const brand = useBrand()
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t('Identity and texts')}</CardTitle>
        <CardDescription>{t('From the brand of the distribution (brand.toml). Editing them from here will come with the kernel.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-3 text-sm">
          <dt className="text-muted-foreground">{t('Logo')}</dt>
          <dd>
            <AppMark />
          </dd>
          <dt className="text-muted-foreground">{t('Name')}</dt>
          <dd>{brand.name}</dd>
          <dt className="text-muted-foreground">{t('Version')}</dt>
          <dd className="font-mono">{brand.version}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}

const bandItems = (): { key: keyof ShellBand; label: string; off: string }[] => [
  { key: 'logo', label: t('Logo and name of the application'), off: t('the sidebar button takes the place of the logo.') },
  { key: 'search', label: t('Search'), off: t('the box and Ctrl K disappear; search within pages stays.') },
  { key: 'lang', label: t('Language'), off: t('the language is chosen in Account › Appearance and language.') },
  { key: 'help', label: t('Help'), off: t('tour, guide and what is new move to the person menu.') },
  { key: 'mode', label: t('Mode (light, dark, automatic)'), off: t('the default mode applies; each person changes it in Account.') },
]

/** The top bar, decided by the Administrator for every tenant, with the preview. Bell, menu of the
 *  person and tenant switcher always stay. */
function BandSettings({ session }: { session: Session }) {
  const qc = useQueryClient()
  const saved = bandOf(session)
  const [v, setV] = useState<ShellBand | null>(null)
  const b = v ?? saved
  const save = useAction((x: ShellBand) => api('PUT', '/api/admin/band', x), { ok: t('Top bar updated for everybody'), invalidate: [['session']] })
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(saved)
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Preview')}</CardTitle>
          <CardDescription>{t('The same for every tenant.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <BandPreview band={b} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Items')}</CardTitle>
          <CardDescription>{t('Bell, person menu and tenant switcher always stay.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1">
          {bandItems().map((it) => (
            <label key={it.key} className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
              <span>
                <b className="block text-sm">{it.label}</b>
                <span className="text-xs text-muted-foreground">{t('If it is off: {what}', { what: it.off })}</span>
              </span>
              <Switch checked={b[it.key]} onCheckedChange={(x) => setV({ ...b, [it.key]: x })} />
            </label>
          ))}
        </CardContent>
      </Card>
      <SaveBar
        dirty={dirty}
        busy={save.isPending}
        onSave={() => v && save.mutate(v, { onSuccess: () => (setV(null), void qc.invalidateQueries({ queryKey: ['session'] })) })}
        onCancel={() => setV(null)}
      />
    </div>
  )
}

function BandPreview({ band }: { band: ShellBand }) {
  const brand = useBrand()
  const icon = 'flex size-6 items-center justify-center rounded text-band-foreground/90 [&>svg]:size-3.5'
  return (
    <div aria-hidden="true" className="flex h-10 items-center overflow-hidden rounded-lg border bg-band text-band-foreground">
      <div className="flex h-full w-40 shrink-0 items-center gap-2 border-r border-band-line px-3">
        {band.logo ? (
          <>
            <AppMark className="size-5" />
            <b className="truncate text-xs">{brand.name}</b>
          </>
        ) : (
          <span className={icon}>
            <PanelLeft />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
        {band.logo && (
          <span className={icon}>
            <PanelLeft />
          </span>
        )}
        <span className="truncate rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">{t('Example City')}</span>
        <span className="flex flex-1 justify-center">{band.search && <span className="flex h-6 w-full max-w-48 items-center gap-1.5 rounded bg-search px-2 text-[11px] text-search-foreground"><Search className="size-3" />{t('Search everywhere')}</span>}</span>
        {band.lang && <span className={cn(icon, 'font-mono text-[10px] font-semibold')}>{t('EN')}</span>}
        {band.mode && (
          <span className={icon}>
            <Contrast />
          </span>
        )}
        {band.help && (
          <span className={icon}>
            <CircleHelp />
          </span>
        )}
        <span className={icon}>
          <Bell />
        </span>
        <span className="flex size-6 items-center justify-center rounded-full bg-teal-700 text-[9px] font-semibold text-white">{t('ER')}</span>
      </div>
    </div>
  )
}

function Admins({ me }: { me: string }) {
  const q = useApi<AdminUser[]>(['admins'], '/api/admin/administrators')
  const confirm = useConfirm()
  const [dlg, setDlg] = useState<null | 'new' | AdminUser>(null)
  const inval = [['admins'], ['admin-overview']]
  const create = useAction((v: Record<string, string>) => api('POST', '/api/admin/administrators', v), { ok: (v) => t('Administrator {username} created', { username: v.username }), invalidate: inval })
  const status = useAction(({ id, active }: { id: string; active: boolean }) => api('PUT', `/api/admin/administrators/${id}/status`, { active }), {
    ok: ({ active }) => (active ? t('Reactivated') : t('Disabled: their sessions are closed')),
    invalidate: inval,
  })
  const totp = useAction((id: string) => api('DELETE', `/api/admin/administrators/${id}/totp`), { ok: t('Second factor removed: at the next sign-in they register the app again'), invalidate: inval })
  const pw = useAction(({ id, password }: { id: string; password: string }) => api('POST', `/api/admin/administrators/${id}/password`, { password }), { ok: t('Password reset') })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  return (
    <div className="grid max-w-4xl gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          {t('Accounts of the platform, separate from those of the tenants: they sign in from «Administrator access» with a local password and a second factor. At least one always stays active.')}
        </p>
        <Button onClick={() => setDlg('new')}>
          <Plus />
          {t('New Administrator')}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Administrators')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead>{t('Second factor')}</TableHead>
              <TableHead>{t('Created')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((a) => (
              <TableRow key={a.user_id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initials(a.display_name || a.username)}</span>
                    <div>
                      <div className="font-medium">
                        {a.display_name || a.username}
                        {a.user_id === me && (
                          <Badge variant="secondary" className="ml-2 font-normal">
                            tu
                          </Badge>
                        )}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{a.username}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={a.status} />
                </TableCell>
                <TableCell>{a.totp ? <Badge className="bg-ok/10 font-normal text-ok">{t('on')}</Badge> : <Badge variant="secondary" className="font-normal">{t('to register')}</Badge>}</TableCell>
                <TableCell className="text-muted-foreground">{fmtDate(a.created_at)}</TableCell>
                <TableCell>
                  {a.user_id !== me && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={t('Actions for {username}', { username: a.username })}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setDlg(a)}>
                          <KeyRound />
                          {t('Reset the password')}
                        </DropdownMenuItem>
                        {a.totp && (
                          <DropdownMenuItem onSelect={async () => (await confirm(t('Remove the second factor of {username}?', { username: a.username }), true)) && totp.mutate(a.user_id)}>
                            <ShieldCheck />
                            {t('Reset the second factor')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          variant={a.status === 'active' ? 'destructive' : 'default'}
                          onSelect={async () => {
                            const active = a.status !== 'active'
                            if (active || (await confirm(t('Disable {username}? Their sessions are closed.', { username: a.username }), true))) status.mutate({ id: a.user_id, active })
                          }}
                        >
                          <Users />
                          {a.status === 'active' ? t('Disable') : t('Reactivate')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormDialog
        open={dlg === 'new'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('New Administrator')}
        description={t('At the first sign-in they register the second factor.')}
        fields={[
          { name: 'username', label: t('Username'), required: true },
          { name: 'display_name', label: t('Name') },
          { name: 'password', label: t('Initial password'), type: 'password', required: true, hint: t('At least 10 characters') },
        ]}
        submit={t('Create')}
        onSubmit={(v) => create.mutateAsync(v)}
      />
      <FormDialog
        open={!!dlg && dlg !== 'new'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('New password for {v}', { v: dlg && dlg !== 'new' ? dlg.username : '' })}
        fields={[{ name: 'password', label: t('New password'), type: 'password', required: true, hint: t('At least 10 characters') }]}
        submit={t('Reset')}
        onSubmit={(v) => pw.mutateAsync({ id: (dlg as AdminUser).user_id, password: v.password })}
      />
    </div>
  )
}
