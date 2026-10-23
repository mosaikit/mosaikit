// Pages of the Administrator: platform overview, tenants and their tabbed detail, plugins, System
// (administrators, identity and top bar). Account and Notifications are in common.tsx and notifications.tsx.

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Building2, CircleHelp, Contrast, Frame, Gauge, HardDrive, History, KeyRound, KeySquare, Mail, MoreHorizontal, Palette, PanelLeft, Plus, Power, Search, ShieldCheck, Upload, Users, Wrench } from 'lucide-react'
import { api, fmtBytes, fmtDate } from '../../api.ts'
import { useBrand } from '../../brand.ts'
import type { AdminUser, GlobalKpi, Member, Session, ShellBand, SystemOverview, TenantInfo } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { initials, passwordMin, useAction, useApi, useConfig, useConfirm } from '../core.ts'
import { DataTable, Empty, ErrorBox, FormDialog, Kpi, Loading, PageHeader, PluginKpis, SaveBar, Sections, StatusBadge, Tabs } from '../kit.tsx'
import { go, to } from '../router.ts'
import { bandOf } from '../prefs.ts'
import { AppMark } from '../Shell.tsx'
import { PlatformTheme } from '../ThemeSettings.tsx'
import { EmbeddingPanel, IdentityPanel, KeysPanel, LanguagesPanel, ModePanel, NotificationsPanel, RetentionPanel, SecurityPanel, ThemeSwitch } from '../SettingsPanels.tsx'
import { SignInSettings } from '../SignInSettings.tsx'
import { EmailPanel } from '../EmailPanel.tsx'
import { TenantPluginsOfAdmin } from './plugins.tsx'
import { PlatformQuotasPanel, TenantQuotasPanel } from '../Quotas.tsx'
import { BackupPanel, ImportTenantDialog, MaintenancePanel, NewTenantWizard, OverviewOps, TenantLifecycle, TenantState } from './operations.tsx'
import { t } from '../i18n.ts'


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
        <OverviewOps />
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
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const rows = (q.data ?? []).filter((tn) => !search || `${tn.name} ${tn.slug}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <PageHeader
        title={t('Tenants')}
        sub={q.data ? `${q.data.length} tenant` : undefined}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus />
            {t('New tenant')}
          </Button>
        }
        more={
          <DropdownMenuItem onSelect={() => setImporting(true)}>
            <Upload />
            {t('Import a tenant')}
          </DropdownMenuItem>
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
                      <TenantState tn={tn} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(tn.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <NewTenantWizard open={open} onOpenChange={setOpen} />
      <ImportTenantDialog open={importing} onOpenChange={setImporting} />
    </>
  )
}

export function AdminTenant({ id, section }: { id: string; section?: string }) {
  const tenants = useApi<TenantInfo[]>(['admin-tenants'], '/api/admin/tenants')
  const members = useApi<Member[]>(['admin-members', id], `/api/admin/tenants/${id}/members`)
  const confirm = useConfirm()
  const tn = tenants.data?.find((x) => x.id === id)
  const cur = section === 'users' || section === 'sign-in' || section === 'plugins' ? section : 'details'
  const signIn = useApi<{ enabled: boolean }>(['admin-sign-in', id], `/api/admin/tenants/${id}/sign-in`)
  const toggle = async () => {
    const next = tn!.status === 'active' && !tn!.archived_at ? 'suspended' : 'active'
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
        crumbs={[{ label: t('Tenants'), href: to.admin('tenants') }]}
        title={tn.name}
        badge={<TenantState tn={tn} />}
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
          { id: 'users', label: t('People'), count: members.data?.length },
          { id: 'sign-in', label: t('Sign-in') },
          { id: 'plugins', label: t('Plugins') },
        ]}
        current={cur}
        href={(s) => to.adminTenant(id, s === 'details' ? undefined : s)}
      />
      <div className="p-6 max-[620px]:p-4">

        {cur === 'details' ? (
          <div className="grid gap-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>{t('Tenant')}</CardTitle>
              <CardDescription>{t('Name, identifier and contents of the tenant.')}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t('Name')}</dt>
                <dd>{tn.name}</dd>
                <dt className="text-muted-foreground">{t('Identifier')}</dt>
                <dd className="font-mono">{tn.slug}</dd>
                <dt className="text-muted-foreground">{t('Sign-in')}</dt>
                <dd>
                  <a className="underline-offset-4 hover:underline" href={to.adminTenant(id, 'sign-in')}>
                    {signIn.data?.enabled ? t('Identity provider (OIDC)') : t('Local accounts')}
                  </a>
                </dd>
                <dt className="text-muted-foreground">{t('Items')}</dt>
                <dd>
                  {tn.resources} · {fmtBytes(tn.bytes)}
                </dd>
                <dt className="text-muted-foreground">{t('Created')}</dt>
                <dd>{fmtDate(tn.created_at)}</dd>
              </dl>
            </CardContent>
          </Card>
          <TenantQuotasPanel id={id} />
          <TenantLifecycle tn={tn} />
          </div>
        ) : cur === 'sign-in' ? (
          <SignInSettings id={id} />
        ) : cur === 'plugins' ? (
          <TenantPluginsOfAdmin id={id} />
        ) : (
          <TenantUsers id={id} q={members} />
        )}
      </div>
    </>
  )
}

function TenantUsers({ id, q }: { id: string; q: { data?: Member[]; isLoading: boolean; error: unknown } }) {
  const pwMin = passwordMin(useConfig())
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
          { name: 'password', label: t('Initial password'), type: 'password', required: true, hint: t('At least {n} characters', { n: pwMin }) },
        ]}
        submit={t('Create')}
        onSubmit={(v) => newManager.mutateAsync(v)}
      />
      <FormDialog
        open={!!dlg && dlg !== 'manager'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('New password for {v}', { v: dlg && dlg !== 'manager' ? dlg.username : '' })}
        fields={[{ name: 'password', label: t('New password'), type: 'password', required: true, hint: t('At least {n} characters', { n: pwMin }) }]}
        submit={t('Reset')}
        onSubmit={(v) => resetPw.mutateAsync({ uid: (dlg as Member).user_id, password: v.password })}
      />
    </div>
  )
}

/* ── System ──────────────────────────────────────────────────────────── */

export function AdminSystem({ session, section }: { session: Session; section?: string }) {
  const sections = [
    { id: 'admins', label: t('Administrators'), icon: <ShieldCheck />, group: t('Platform') },
    { id: 'email', label: t('Email'), icon: <Mail /> },
    { id: 'notifications', label: t('Notifications'), icon: <Bell /> },
    { id: 'retention', label: t('Retention'), icon: <History /> },
    { id: 'security', label: t('Passwords and sessions'), icon: <KeyRound /> },
    { id: 'quotas', label: t('Quotas'), icon: <Gauge /> },
    { id: 'keys', label: t('Keys of outside services'), icon: <KeySquare /> },
    { id: 'embedding', label: t('Embedding'), icon: <Frame /> },
    { id: 'backup', label: t('Backup and restore'), icon: <HardDrive />, group: t('Operation') },
    { id: 'maintenance', label: t('Maintenance'), icon: <Wrench /> },
    { id: 'appearance', label: t('Identity and appearance'), icon: <Palette />, group: t('Appearance') },
  ]
  // Identity and appearance has tabs: identity and texts, theme and mode, languages and formats, top bar
  const tabs = [
    { id: 'identity', label: t('Identity and texts') },
    { id: 'theme', label: t('Theme and mode') },
    { id: 'languages', label: t('Languages and formats') },
    { id: 'topbar', label: t('Top bar') },
  ]
  const tab = tabs.some((x) => x.id === section) ? section! : section === 'appearance' ? 'identity' : null
  const cur = tab ? 'appearance' : sections.some((s) => s.id === section) ? section! : 'admins'
  return (
    <>
      <PageHeader title={t('System')} sub={t('Settings of the platform, for every tenant')} />
      <Sections sections={sections} current={cur} href={(id) => to.admin('system', id === 'appearance' ? 'identity' : id)}>
        {cur === 'admins' && <Admins me={session.user.user_id} />}
        {cur === 'email' && <EmailPanel session={session} />}
        {cur === 'notifications' && <NotificationsPanel level={PLATFORM} />}
        {cur === 'retention' && <RetentionPanel level={PLATFORM} />}
        {cur === 'security' && <SecurityPanel level={PLATFORM} />}
        {cur === 'quotas' && <PlatformQuotasPanel />}
        {cur === 'keys' && <KeysPanel level={PLATFORM} />}
        {cur === 'embedding' && <EmbeddingPanel level={PLATFORM} />}
        {cur === 'backup' && <BackupPanel />}
        {cur === 'maintenance' && <MaintenancePanel />}
        {cur === 'appearance' && tab && (
          <div className="grid gap-6">
            <Tabs tabs={tabs} current={tab} href={(id) => to.admin('system', id)} />
            {tab === 'identity' && <IdentityPanel level={PLATFORM} />}
            {tab === 'theme' && (
              <div className="grid gap-6">
                <PlatformTheme session={session} />
                <ThemeSwitch />
                <ModePanel level={PLATFORM} />
              </div>
            )}
            {tab === 'languages' && <LanguagesPanel level={PLATFORM} />}
            {tab === 'topbar' && <BandSettings session={session} />}
          </div>
        )}
      </Sections>
    </>
  )
}

const PLATFORM = { kind: 'platform' } as const

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
  const pwMin = passwordMin(useConfig())
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
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary-strong">{initials(a.display_name || a.username)}</span>
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
          { name: 'password', label: t('Initial password'), type: 'password', required: true, hint: t('At least {n} characters', { n: pwMin }) },
        ]}
        submit={t('Create')}
        onSubmit={(v) => create.mutateAsync(v)}
      />
      <FormDialog
        open={!!dlg && dlg !== 'new'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('New password for {v}', { v: dlg && dlg !== 'new' ? dlg.username : '' })}
        fields={[{ name: 'password', label: t('New password'), type: 'password', required: true, hint: t('At least {n} characters', { n: pwMin }) }]}
        submit={t('Reset')}
        onSubmit={(v) => pw.mutateAsync({ id: (dlg as AdminUser).user_id, password: v.password })}
      />
    </div>
  )
}
