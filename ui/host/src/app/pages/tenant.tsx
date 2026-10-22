// Pages of a tenant: Home or overview, apps (in the iframe) and, for the Tenant Manager, the management of
// the tenant: People, Plugins, Shares, Usage and Tenant settings (docs/refactoring-ui.md §2).

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Activity, Bell, Frame, Gauge, Grid2x2, KeyRound, KeySquare, Link2, Lock, Mail, MoreHorizontal, Palette, Plus, Share2, ShieldCheck, ShieldOff, Trash2, TrendingUp, UserRound, Users } from 'lucide-react'
import { api, appUrl, fmtBytes, fmtDate } from '../../api.ts'
import PluginFrame from '../../components/PluginFrame.tsx'
import { UiContext, useUi, type Ui } from '../../ui-context.ts'
import ShareDialog from '../ShareDialog.tsx'
import { SharedByMeSection } from './history.tsx'
import type { AccessRequest, Group, Invitation, LinkInfo, Member, Overview, Profile, ResetLink, ResourceRow, Revoked, Session, TenantContext, TenantKpi, TenantSettings } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { initials, passwordMin, useAction, useApi, useConfig, useConfirm, useTenantCtx } from '../core.ts'
import { t, useLang } from '../i18n.ts'
import { Empty, ErrorBox, FormDialog, Kpi, Loading, PageHeader, Pills, PluginKpis, SaveBar, Sections, StatusBadge, Tabs } from '../kit.tsx'
import { go, to } from '../router.ts'
import { effectiveMode, useTheme } from '../theme.ts'
import AppIcon from '../AppIcon.tsx'
import { TenantTheme } from '../ThemeSettings.tsx'
import { useTenantSignIn } from '../signin.ts'
import { LinkDialog, ProfilesSection, RequestsTable } from './people.tsx'
import { EmbeddingPanel, IdentityPanel, KeysPanel, LanguagesPanel, ManagedPanel, ModePanel, NotificationsPanel, SecurityPanel } from '../SettingsPanels.tsx'
import { UsageAlerts, UsageConsumers, UsagePanel, UsageQuotas, UsageTrend } from '../Quotas.tsx'
import { totals, trashHint } from '../usage.ts'

const enc = encodeURIComponent
const ROLE: Record<string, string> = { tenant_manager: 'Tenant Manager', user: 'User' }

/* ── Overview ────────────────────────────────────────────────────────── */

export function TenantHome({ session, slug }: { session: Session; slug: string }) {
  const ctx = useTenantCtx(slug)
  const o = useApi<Overview>(['overview', slug], `/api/t/${enc(slug)}/overview`)
  if (ctx.isLoading || o.isLoading) return <Loading />
  if (ctx.error) return <ErrorBox error={ctx.error} />
  const c = ctx.data!
  const d = o.data
  const me = totals(d?.me.resources ?? [])
  const mine = me.count
  return (
    <>
      <PageHeader
        title={c.tenant.role === 'tenant_manager' ? t('Tenant overview') : t('Home')}
        sub={`${t('Hello')} ${session.user.display_name || session.user.username} · ${ROLE[c.tenant.role]} in ${c.tenant.name}`}
      />
      <div className="grid gap-6 p-6 max-[620px]:p-4">
        {d && (
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">{t('Your space')}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              <Kpi label={t('Your items')} value={mine} hint={[fmtBytes(me.bytes), trashHint(me.trashCount, 'items')].filter(Boolean).join(' · ')} />
              <Kpi label={t('Shared by me')} value={d.me.shared_by_me} />
              <Kpi label={t('Shared with me')} value={d.me.shared_with_me} />
              <Kpi label={t('My active public links')} value={d.me.public_links} hint={t('{n} views', { n: d.me.link_views })} />
            </div>
          </section>
        )}
        <SharedByMeSection slug={slug} />
        {d?.tenant && (
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">{t('The tenant {name}', { name: c.tenant.name })}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              <Kpi label={t('Members')} value={d.tenant.members} hint={t('{count} guests', { count: d.tenant.guests })} onClick={() => go(to.tenant(slug, 'manage'))} />
              <Kpi label={t('Active users (30 days)')} value={d.tenant.active_users_30d} />
              <Kpi label={t('Items')} value={d.tenant.resources.reduce((s, r) => s + r.count, 0)} />
              <Kpi label={t('Shares')} value={d.tenant.shares} hint={t('{count} public links', { count: d.tenant.public_links })} onClick={() => go(to.tenant(slug, 'shares'))} />
            </div>
            <UsagePanel slug={slug} />
          </section>
        )}
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">{t('Apps')}</h2>
          {c.plugins.length === 0 ? (
            <Empty icon={<Grid2x2 />} title={t('No active apps')}>
              {t('An Administrator installs and turns them on.')}
            </Empty>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {c.plugins.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => go(to.plugin(slug, p.id))}
                  className="flex flex-col gap-1.5 rounded-xl border bg-card p-4 text-left hover:border-primary/50 hover:bg-accent/40"
                >
                  <AppIcon id={p.id} name={p.icon_name} className="size-[22px] fill-current text-primary [fill-opacity:0.12]" />
                  <b className="text-base font-semibold">{p.label}</b>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{p.description}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}

/* ── Plugins ─────────────────────────────────────────────────────────── */

/** In development the server says when a plugin changes: the iframe reloads (hot reload). */
function useDevReload(session: Session, slug: string): Record<string, number> {
  const qc = useQueryClient()
  const [reloads, setReloads] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!session.dev) return
    const es = new EventSource(appUrl('/api/dev/events'))
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as { type: string; id: string; what?: string; error?: string }
        if (ev.type === 'plugin_changed') {
          setReloads((r) => ({ ...r, [ev.id]: (r[ev.id] ?? 0) + 1 }))
          if (ev.what === 'schema') void qc.invalidateQueries({ queryKey: ['ctx', slug] })
          toast(`${ev.id}: ${ev.what === 'ui' ? t('interface updated') : ev.what === 'logic' ? t('logic updated') : t('schema updated')}`)
        } else if (ev.type === 'plugin_error') toast.error(`${ev.id}: ${ev.error}`)
      } catch {
        /* invalid event */
      }
    }
    return () => es.close()
  }, [session.dev, slug, qc])
  return reloads
}

export function PluginPage({ session, slug, id, at }: { session: Session; slug: string; id: string; at?: string }) {
  const ctx = useTenantCtx(slug)
  // language, theme and mode of the shell: they reach the plugin at start and at every change
  const lang = useLang()
  const th = useTheme()
  const ui = { lang, preset: th.preset, mode: effectiveMode(th), preference: th.mode }
  const base = useUi()
  const reloads = useDevReload(session, slug)
  const [share, setShare] = useState<{ id: string; done: () => void } | null>(null)
  // the sharing asked by the plugin opens the dialog of the host, which knows the tenant
  const services = useMemo<Ui>(() => ({ ...base, share: (rid) => new Promise<void>((done) => setShare({ id: rid, done })) }), [base])
  if (ctx.isLoading) return <Loading />
  if (ctx.error) return <ErrorBox error={ctx.error} />
  const c: TenantContext = ctx.data!
  const p = c.plugins.find((x) => x.id === id)
  if (!p) return <Empty title={t('App not active in this tenant')} />
  return (
    <UiContext.Provider value={services}>
      <div className="relative flex-1 [&_.frame-msg]:absolute [&_.frame-msg]:inset-0 [&_.frame-msg]:flex [&_.frame-msg]:items-center [&_.frame-msg]:justify-center [&_.frame-msg]:text-sm [&_.frame-msg]:text-muted-foreground [&_.frame-wrap]:absolute [&_.frame-wrap]:inset-0 [&_iframe]:size-full [&_iframe]:border-0">
        {/* another place (a notification) opens the page again at that place */}
        <PluginFrame key={`${p.id}|${slug}|${at ?? ''}`} plugin={p} session={session} ctx={c} reloadKey={reloads[p.id] ?? 0} ui={ui} at={at} />
      </div>
      <ShareDialog
        ctx={c}
        resourceId={share?.id ?? null}
        onClose={() => {
          share?.done()
          setShare(null)
        }}
      />
    </UiContext.Provider>
  )
}

/* ── People ──────────────────────────────────────────────────────────── */

export function Manage({ slug, section }: { slug: string; section?: string }) {
  const pwMin = passwordMin(useConfig(slug))
  const oidc = useTenantSignIn(slug) === 'oidc'
  const base = `/api/t/${enc(slug)}/manage`
  const members = useApi<Member[]>(['members', slug], `${base}/members`)
  const groups = useApi<Group[]>(['groups', slug], `${base}/groups`)
  const invites = useApi<Invitation[]>(['invites', slug], `${base}/invitations`)
  const profiles = useApi<Profile[]>(['profiles', slug], `${base}/profiles`)
  const requests = useApi<AccessRequest[]>(['requests', slug], `/api/t/${enc(slug)}/requests`)
  const cur = ['people', 'groups', 'profiles', 'pending'].includes(section ?? '') ? section! : 'people'
  const pending = (invites.data?.filter((i) => i.status === 'pending').length ?? 0) + (requests.data?.length ?? 0)
  const sections = [
    { id: 'people', label: t('People'), icon: <Users />, count: members.data?.length },
    { id: 'groups', label: t('Groups'), icon: <Grid2x2 />, count: groups.data?.length },
    { id: 'profiles', label: t('Permission profiles'), icon: <KeySquare />, count: profiles.data?.length },
    { id: 'pending', label: t('Pending'), icon: <Mail />, count: pending },
  ]
  const [dlg, setDlg] = useState<null | 'member' | 'group' | 'invite' | 'profile'>(null)
  const inval = [['members', slug], ['groups', slug], ['invites', slug], ['overview', slug], ['profiles', slug]]
  const create = useAction((v: Record<string, string>) => api('POST', `${base}/members`, v), { ok: (v) => t('User {username} created', { username: v.username }), invalidate: inval })
  const newGroup = useAction((v: Record<string, string>) => api('POST', `${base}/groups`, v), { ok: (v) => t('Group {name} created', { name: v.name }), invalidate: inval })
  const invite = useAction((v: Record<string, string>) => api('POST', `${base}/invitations`, { ...v, profile: v.profile === 'default' ? null : v.profile }), { ok: t('Invitation sent'), invalidate: inval })
  const newProfile = useAction((v: Record<string, string>) => api('POST', `${base}/profiles`, v), { ok: (v) => t('Profile {name} created', { name: v.name }), invalidate: inval })
  const profileChoices: [string, string][] = [
    ['default', t('Default profile')],
    ...(profiles.data ?? []).filter((p) => !p.is_default).map((p): [string, string] => [p.id, p.name]),
  ]
  const action =
    cur === 'profiles' ? (
      <Button onClick={() => setDlg('profile')}>
        <Plus />
        {t('New profile')}
      </Button>
    ) : cur === 'people' && !oidc ? (
      // with an identity provider the people come from the provider, at their first sign-in
      <Button onClick={() => setDlg('member')}>
        <Plus />
        {t('New user')}
      </Button>
    ) : cur === 'groups' ? (
      <Button onClick={() => setDlg('group')}>
        <Plus />
        {t('New group')}
      </Button>
    ) : (
      <Button onClick={() => setDlg('invite')}>
        <Plus />
        {t('Invite')}
      </Button>
    )
  return (
    <>
      <PageHeader
        title={t('Manage')}
        crumbs={[{ label: t('Tenant management') }]}
        sub={
          {
            people: t('{count} people', { count: members.data?.length ?? 0 }),
            groups: t('{count} groups', { count: groups.data?.length ?? 0 }),
            profiles: t('{count} profiles', { count: profiles.data?.length ?? 0 }),
            pending: t('{count} pending', { count: pending }),
          }[cur]
        }
        actions={action}
      />
      <Sections sections={sections} current={cur} href={(id) => to.tenant(slug, 'manage', id)}>
        {cur === 'people' && <People slug={slug} q={members} profiles={profiles.data ?? []} groups={groups.data ?? []} />}
        {cur === 'groups' && <Groups slug={slug} q={groups} members={members.data ?? []} />}
        {cur === 'profiles' && <ProfilesSection slug={slug} />}
        {cur === 'pending' && (
          <div className="grid gap-6">
            <section className="grid gap-2" aria-label={t('Access requests')}>
              <h2 className="text-sm font-semibold">{t('Access requests')}</h2>
              <RequestsTable slug={slug} manager />
            </section>
            <section className="grid gap-2" aria-label={t('Invitations')}>
              <h2 className="text-sm font-semibold">{t('Invitations')}</h2>
              <Invites slug={slug} q={invites} />
            </section>
          </div>
        )}
      </Sections>
      <FormDialog
        open={dlg === 'member'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('New user')}
        description={t('A local account of this tenant.')}
        fields={[
          { name: 'username', label: t('Username'), required: true },
          { name: 'display_name', label: t('Display name') },
          { name: 'password', label: t('Initial password'), type: 'password', required: true, hint: t('At least {n} characters', { n: pwMin }) },
          { name: 'role', label: t('Role'), options: [['user', 'User'], ['tenant_manager', 'Tenant Manager']] },
        ]}
        submit={t('Create user')}
        onSubmit={(v) => create.mutateAsync(v)}
      />
      <FormDialog
        open={dlg === 'group'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('New group')}
        fields={[{ name: 'name', label: t('Name'), required: true }]}
        submit={t('Create group')}
        onSubmit={(v) => newGroup.mutateAsync(v)}
      />
      <FormDialog
        open={dlg === 'invite'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('Invite a person of another tenant')}
        description={t('They join as a guest: they sign in from their tenant and get a role and groups here.')}
        fields={[
          { name: 'tenant', label: t('Home tenant'), required: true },
          { name: 'username', label: t('Username'), required: true },
          { name: 'role', label: t('Role'), options: [['user', 'User'], ['tenant_manager', 'Tenant Manager']] },
          { name: 'profile', label: t('Permission profile'), options: profileChoices },
        ]}
        submit={t('Send the invitation')}
        onSubmit={(v) => invite.mutateAsync(v)}
      />
      <FormDialog
        open={dlg === 'profile'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('New profile')}
        description={t('It starts with the default permissions of every plugin: change them afterwards.')}
        fields={[
          { name: 'name', label: t('Name'), required: true },
          { name: 'description', label: t('Description') },
        ]}
        submit={t('Create profile')}
        onSubmit={(v) => newProfile.mutateAsync(v)}
      />
    </>
  )
}

type Q<T> = { data?: T; isLoading: boolean; error: unknown }

function People({ slug, q, profiles, groups }: { slug: string; q: Q<Member[]>; profiles: Profile[]; groups: Group[] }) {
  const pwMin = passwordMin(useConfig(slug))
  const oidc = useTenantSignIn(slug) === 'oidc'
  const base = `/api/t/${enc(slug)}/manage/members`
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [pwFor, setPwFor] = useState<Member | null>(null)
  const inval = [['members', slug], ['overview', slug]]
  const setRole = useAction(({ ids, role }: { ids: string[]; role: string }) => Promise.all(ids.map((id) => api('PUT', `${base}/${id}/role`, { role }))), {
    ok: ({ ids }) => (ids.length === 1 ? t('Role updated') : t('Role updated for {n} people', { n: ids.length })),
    invalidate: inval,
  })
  const [removing, setRemoving] = useState<Member | null>(null)
  const remove = useAction(({ id, newOwner }: { id: string; newOwner?: string }) => api('DELETE', `${base}/${id}${newOwner ? `?new_owner=${newOwner}` : ''}`), {
    ok: t('Person removed from the tenant'),
    invalidate: [...inval, ['m-resources', slug]],
  })
  const resetPw = useAction(({ id, password }: { id: string; password: string }) => api('POST', `${base}/${id}/password`, { password }), { ok: t('Password reset') })
  const setProfile = useAction(({ ids, profile }: { ids: string[]; profile: string | null }) => Promise.all(ids.map((id) => api('PUT', `${base}/${id}/profile`, { profile }))), {
    ok: t('Profile updated'),
    invalidate: [...inval, ['profiles', slug]],
  })
  const toGroup = useAction(({ ids, group }: { ids: string[]; group: string }) => Promise.all(ids.map((id) => api('PUT', `/api/t/${enc(slug)}/manage/groups/${group}/members/${id}`))), {
    ok: t('Added to the group'),
    invalidate: [...inval, ['groups', slug]],
  })
  const suspend = useAction(({ ids, suspended }: { ids: string[]; suspended: boolean }) => Promise.all(ids.map((id) => api('PUT', `${base}/${id}/status`, { suspended }))), {
    ok: ({ suspended }) => (suspended ? t('Suspended in the tenant') : t('Active again')),
    invalidate: inval,
  })
  const [link, setLink] = useState<{ name: string; link: ResetLink } | null>(null)
  const sendLink = useAction((m: Member) => api<ResetLink>('POST', `${base}/${m.user_id}/reset-link`), {})
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter((m) => !s || `${m.username} ${m.display_name} ${m.home_tenant}`.toLowerCase().includes(s))
  }, [q.data, search])
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const ids = [...sel].filter((id) => rows.some((r) => r.user_id === id))
  const all = rows.length > 0 && ids.length === rows.length
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="search" placeholder={t('Search by name or username')} aria-label={t('Search by name or username')} className="w-72 max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
        {ids.length > 0 && (
          // the action bar appears only with a selection
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/10 py-1 pr-1 pl-3" role="group" aria-label={t('Actions on the selection')}>
            <span className="text-sm font-medium tabular-nums">{t('{count} selected', { count: ids.length })}</span>
            <Button variant="outline" size="sm" onClick={() => setRole.mutate({ ids, role: 'tenant_manager' })}>
              <ShieldCheck />
              {t('Make Tenant Manager')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRole.mutate({ ids, role: 'user' })}>
              <UserRound />
              {t('Make User')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  {t('Change profile')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setProfile.mutate({ ids, profile: null })}>{t('Default profile')}</DropdownMenuItem>
                {profiles
                  .filter((p) => !p.is_default)
                  .map((p) => (
                    <DropdownMenuItem key={p.id} onSelect={() => setProfile.mutate({ ids, profile: p.id })}>
                      {p.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!groups.length}>
                  {t('Add to a group')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-72 overflow-auto">
                {groups.map((g) => (
                  <DropdownMenuItem key={g.id} onSelect={() => toGroup.mutate({ ids, group: g.id })}>
                    {g.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={() => suspend.mutate({ ids, suspended: true })}>
              {t('Suspend')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>
              {t('Deselect')}
            </Button>
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label={t('Select all')}
                  checked={all ? true : ids.length ? 'indeterminate' : false}
                  onCheckedChange={(v) => setSel(v ? new Set(rows.map((r) => r.user_id)) : new Set())}
                />
              </TableHead>
              <TableHead>{t('Name')}</TableHead>
              <TableHead>{t('Role and profile')}</TableHead>
              <TableHead>{t('Groups')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead className="text-right">{t('Items')}</TableHead>
              <TableHead>{t('Last sign-in')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.user_id} data-state={sel.has(m.user_id) ? 'selected' : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={t('Select {name}', { name: m.username })}
                    checked={sel.has(m.user_id)}
                    onCheckedChange={(v) => {
                      const n = new Set(sel)
                      if (v) n.add(m.user_id)
                      else n.delete(m.user_id)
                      setSel(n)
                    }}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary-strong">{initials(m.display_name || m.username)}</span>
                    <div>
                      <a className="font-medium hover:underline" href={to.person(slug, m.user_id)}>
                        {m.display_name || m.username}
                      </a>
                      <div className="contents">
                        {m.is_guest && (
                          <Badge variant="secondary" className="ml-2 font-normal">
                            {t('guest')} · {m.home_tenant}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.username}@{m.home_tenant}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={m.role === 'tenant_manager' ? 'default' : 'secondary'} className="font-normal">
                    {ROLE[m.role]}
                  </Badge>
                  <div className="mt-1 text-xs text-muted-foreground">{m.role === 'tenant_manager' ? t('every permission') : m.profile}</div>
                </TableCell>
                <TableCell className="max-w-48 text-sm text-muted-foreground">{m.groups.join(', ') || '—'}</TableCell>
                <TableCell>
                  <StatusBadge status={m.status !== 'active' ? m.status : m.membership} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.owned_resources}</TableCell>
                <TableCell className="text-muted-foreground">{m.last_sign_in_at ? fmtDate(m.last_sign_in_at) : t('Never')}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t('Actions for {username}', { username: m.username })}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => go(to.person(slug, m.user_id))}>
                        <UserRound />
                        {t('Open')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setRole.mutate({ ids: [m.user_id], role: m.role === 'user' ? 'tenant_manager' : 'user' })}>
                        <ShieldCheck />
                        {m.role === 'user' ? t('Make Tenant Manager') : t('Make User')}
                      </DropdownMenuItem>
                      {!m.is_guest && !oidc && (
                        <DropdownMenuItem onSelect={() => sendLink.mutate(m, { onSuccess: (l) => setLink({ name: m.display_name || m.username, link: l as ResetLink }) })}>
                          <Link2 />
                          {t('Send the password link')}
                        </DropdownMenuItem>
                      )}
                      {!m.is_guest && !oidc && (
                        <DropdownMenuItem onSelect={() => setPwFor(m)}>
                          <KeyRound />
                          {t('Reset the password')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => suspend.mutate({ ids: [m.user_id], suspended: m.membership !== 'suspended' })}>
                        <ShieldOff />
                        {m.membership === 'suspended' ? t('Reactivate in the tenant') : t('Suspend in the tenant')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setRemoving(m)}
                      >
                        <Trash2 />
                        {t('Remove from the tenant')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('No person found.')}</p>}
      </div>
      <FormDialog
        open={!!pwFor}
        onOpenChange={(o) => !o && setPwFor(null)}
        title={t('New password for {username}', { username: pwFor?.username ?? '' })}
        description={t('Their open sessions are closed.')}
        fields={[{ name: 'password', label: t('New password'), type: 'password', required: true, hint: t('At least {n} characters', { n: pwMin }) }]}
        submit={t('Reset')}
        onSubmit={(v) => resetPw.mutateAsync({ id: pwFor!.user_id, password: v.password })}
      />
      <LinkDialog link={link?.link ?? null} name={link?.name ?? ''} onClose={() => setLink(null)} />
      <RemoveDialog
        member={removing}
        members={q.data ?? []}
        busy={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={(newOwner) => remove.mutate({ id: removing!.user_id, newOwner }, { onSuccess: () => setRemoving(null) })}
      />
    </div>
  )
}

/** Removal from the tenant (mockup: dlg-remove-person): who receives the items of the person and what
 *  happens to their account. */
export function RemoveDialog({ member, members, busy, onConfirm, onClose }: { member: Member | null; members: Member[]; busy: boolean; onConfirm: (newOwner?: string) => void; onClose: () => void }) {
  const [owner, setOwner] = useState('')
  useEffect(() => setOwner(''), [member])
  const owns = (member?.owned_resources ?? 0) > 0
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Remove from the tenant')}</DialogTitle>
          <DialogDescription>{member && (member.display_name || member.username)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm">
          <p>{member?.is_guest ? t('They are a guest: they lose access to this tenant, their account stays in their home tenant.') : t('It is their home tenant: the account is disabled.')}</p>
          {owns && (
            <div className="grid gap-1.5">
              <Label htmlFor="rm-owner">{t('Who gets their {count} items', { count: member!.owned_resources })}</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger id="rm-owner" className="w-full">
                  <SelectValue placeholder={t('Choose the person…')} />
                </SelectTrigger>
                <SelectContent>
                  {members
                    .filter((x) => x.user_id !== member!.user_id && x.status === 'active')
                    .map((x) => (
                      <SelectItem key={x.user_id} value={x.user_id}>
                        {x.display_name || x.username}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button variant="destructive" disabled={busy || (owns && !owner)} onClick={() => onConfirm(owner || undefined)}>
              {t('Remove')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Groups({ slug, q, members }: { slug: string; q: Q<Group[]>; members: Member[] }) {
  const base = `/api/t/${enc(slug)}/manage/groups`
  const confirm = useConfirm()
  const inval = [['groups', slug]]
  const del = useAction((id: string) => api('DELETE', `${base}/${id}`), { ok: t('Group deleted'), invalidate: inval })
  const addMember = useAction(({ g, u }: { g: string; u: string }) => api('PUT', `${base}/${g}/members/${u}`), { ok: t('Added to the group'), invalidate: inval })
  const rmMember = useAction(({ g, u }: { g: string; u: string }) => api('DELETE', `${base}/${g}/members/${u}`), { invalidate: inval })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length)
    return (
      <Empty icon={<Grid2x2 />} title={t('No groups')}>
        {t('Groups are for sharing with several people at once.')}
      </Empty>
    )
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {q.data.map((g) => {
        const others = members.filter((m) => !g.members.some((x) => x.user_id === m.user_id))
        return (
          <Card key={g.id}>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  <a className="hover:underline" href={to.group(slug, g.id)}>
                    {g.name}
                  </a>
                </CardTitle>
                <CardDescription>{t('{count} members', { count: g.members.length })}</CardDescription>
              </div>
              <div className="flex gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={!others.length}>
                      <Plus />
                      {t('Add')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 overflow-auto">
                    {others.map((m) => (
                      <DropdownMenuItem key={m.user_id} onSelect={() => addMember.mutate({ g: g.id, u: m.user_id })}>
                        {m.display_name || m.username}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('Delete the group {name}', { name: g.name })}
                  onClick={async () => (await confirm(t('Delete the group {name}? The shares with the group are revoked.', { name: g.name }), true)) && del.mutate(g.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {g.members.length === 0 && <span className="text-sm text-muted-foreground">{t('No members.')}</span>}
              {g.members.map((m) => (
                <Badge key={m.user_id} variant="secondary" className="gap-1 font-normal">
                  {m.display_name || m.username}
                  <button type="button" aria-label={t('Remove {username} from the group', { username: m.username })} className="ml-0.5 opacity-60 hover:opacity-100" onClick={() => rmMember.mutate({ g: g.id, u: m.user_id })}>
                    ×
                  </button>
                </Badge>
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function Invites({ slug, q }: { slug: string; q: Q<Invitation[]> }) {
  const revoke = useAction((id: string) => api('DELETE', `/api/t/${enc(slug)}/manage/invitations/${id}`), { ok: t('Invitation revoked'), invalidate: [['invites', slug]] })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length)
    return (
      <Empty icon={<Mail />} title={t('Nothing pending')}>
        {t('Invitations to people of other tenants stay here until they answer.')}
      </Empty>
    )
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Person')}</TableHead>
            <TableHead>{t('Role')}</TableHead>
            <TableHead>{t('Status')}</TableHead>
            <TableHead>{t('Expires')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.data.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.user}</TableCell>
              <TableCell>{ROLE[i.role]}</TableCell>
              <TableCell>
                <StatusBadge status={i.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">{fmtDate(i.expires_at)}</TableCell>
              <TableCell className="text-right">
                {i.status === 'pending' && (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)}>
                    {t('Revoke')}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/* ── Plugins of the tenant ───────────────────────────────────────────── */

/* ── Shares ──────────────────────────────────────────────────────────── */

/** The items of the tenant shared with others or with a public link; links are revoked from here. */
export function Shares({ slug }: { slug: string }) {
  const ctx = useTenantCtx(slug)
  const members = useApi<Member[]>(['members', slug], `/api/t/${enc(slug)}/manage/members`)
  const [show, setShow] = useState('all')
  const [filter, setFilter] = useState({ owner: '', plugin: '', q: '' })
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString()
  const q = useApi<ResourceRow[]>(['m-resources', slug, qs], `/api/t/${enc(slug)}/manage/resources${qs ? '?' + qs : ''}`)
  const [links, setLinks] = useState<ResourceRow | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)
  const [reassign, setReassign] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const confirm = useConfirm()
  const revoke = useAction((ids: string[]) => api<Revoked>('POST', `/api/t/${enc(slug)}/manage/resources/revoke`, { ids }), {
    invalidate: [['m-resources', slug], ['overview', slug], ['shared-by-me', slug]],
  })
  const askRevoke = async (list: ResourceRow[]) => {
    const text =
      list.length === 1
        ? t('Revoke every share and public link of «{name}»? The owner keeps the item.', { name: list[0].title || list[0].kind })
        : t('Revoke every share and public link of {count} items? The owners keep their items.', { count: list.length })
    if (await confirm(text, true))
      revoke.mutate(
        list.map((r) => r.id),
        {
          onSuccess: (r) => {
            const x = r as Revoked
            toast.success(t('Revoked: {shares} shares, {links} public links', { shares: x.shares, links: x.links }))
            setSel(new Set())
          },
        },
      )
  }
  const all = q.data ?? []
  const shared = all.filter((r) => r.shares > 0 || r.public_links > 0)
  const rows = show === 'items' ? all : show === 'public' ? shared.filter((r) => r.public_links > 0) : shared
  const ids = [...sel].filter((id) => rows.some((r) => r.id === id && (r.shares > 0 || r.public_links > 0)))
  const selectable = rows.filter((r) => r.shares > 0 || r.public_links > 0)
  const allSel = selectable.length > 0 && ids.length === selectable.length
  const plugins = ctx.data?.plugins ?? []
  const label = (id: string) => plugins.find((p) => p.id === id)?.label ?? id
  const seeTitles = ctx.data?.tenant.settings.managers_see_titles
  return (
    <>
      <PageHeader
        title={t('Shares')}
        crumbs={[{ label: t('Tenant management') }]}
        sub={t('Items shared with other people, with groups or with a public link')}
        more={
          <DropdownMenuItem onSelect={() => setReassign(true)}>
            <Users />
            {t("Reassign a person's items")}
          </DropdownMenuItem>
        }
      />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Pills
            items={[
              { id: 'all', label: t('Shared'), count: shared.length },
              { id: 'public', label: t('Public and links'), count: shared.filter((r) => r.public_links > 0).length },
              { id: 'items', label: t('All items'), count: all.length },
            ]}
            value={show}
            onChange={setShow}
          />
          <Select value={filter.owner || 'all'} onValueChange={(v) => setFilter({ ...filter, owner: v === 'all' ? '' : v })}>
            <SelectTrigger size="sm" className="w-48" aria-label={t('Owner')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All owners')}</SelectItem>
              {(members.data ?? []).map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.display_name || m.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filter.plugin || 'all'} onValueChange={(v) => setFilter({ ...filter, plugin: v === 'all' ? '' : v })}>
            <SelectTrigger size="sm" className="w-40" aria-label={t('Apps')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All apps')}</SelectItem>
              {plugins.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {seeTitles && (
            <Input type="search" className="h-8 w-56" placeholder={t('Search in the title')} aria-label={t('Search in the title')} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          )}
          {ids.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/10 py-1 pr-1 pl-3" role="group" aria-label={t('Actions on the selection')}>
              <span className="text-sm font-medium tabular-nums">{t('{count} selected', { count: ids.length })}</span>
              <Button variant="outline" size="sm" onClick={() => void askRevoke(rows.filter((r) => ids.includes(r.id)))}>
                {t('Revoke shares and links')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>
                {t('Deselect')}
              </Button>
            </div>
          )}
        </div>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : rows.length === 0 ? (
          <Empty icon={<Share2 />} title={show === 'public' ? t('No active public link') : show === 'items' ? t('No items') : t('No shares')} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label={t('Select all')}
                      disabled={!selectable.length}
                      checked={allSel ? true : ids.length ? 'indeterminate' : false}
                      onCheckedChange={(v) => setSel(v ? new Set(selectable.map((r) => r.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>{t('Item')}</TableHead>
                  <TableHead>{t('Owner')}</TableHead>
                  <TableHead className="text-right">{t('Size')}</TableHead>
                  <TableHead className="text-right">{t('Shares')}</TableHead>
                  <TableHead className="text-right">{t('Public links')}</TableHead>
                  <TableHead>{t('Modified')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-state={sel.has(r.id) ? 'selected' : undefined}>
                    <TableCell>
                      {(r.shares > 0 || r.public_links > 0) && (
                        <Checkbox
                          aria-label={t('Select {name}', { name: r.title || r.kind })}
                          checked={sel.has(r.id)}
                          onCheckedChange={(v) => {
                            const n = new Set(sel)
                            if (v) n.add(r.id)
                            else n.delete(r.id)
                            setSel(n)
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <b className="block font-medium">{r.title || <span className="font-normal text-muted-foreground italic">{t('title hidden')}</span>}</b>
                      <span className="text-xs text-muted-foreground">
                        {label(r.plugin_id)} · {r.kind}
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.owner_name}
                      {!r.owner_active && (
                        <Badge variant="secondary" className="ml-2 font-normal">
                          {t('left')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBytes(r.size_bytes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.shares}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.public_links > 0 ? (
                        <Badge variant="secondary" className="bg-warn/10 font-normal text-warn">
                          {r.public_links}
                        </Badge>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(r.updated_at)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {r.public_links > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setLinks(r)}>
                          {t('Public links')}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setSharing(r.id)}>
                        {t('Share')}
                      </Button>
                      {(r.shares > 0 || r.public_links > 0) && (
                        <Button variant="ghost" size="sm" onClick={() => void askRevoke([r])}>
                          {t('Revoke')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {all.length > 0 && !all.some((r) => r.title) && <p className="text-xs text-muted-foreground">{t('Titles are hidden by the rules of the tenant (Tenant settings › Sharing).')}</p>}
      </div>
      <LinksDialog slug={slug} row={links} onClose={() => setLinks(null)} />
      {ctx.data && <ShareDialog ctx={ctx.data} resourceId={sharing} onClose={() => setSharing(null)} />}
      <ReassignDialog slug={slug} open={reassign} members={members.data ?? []} onClose={() => setReassign(false)} />
    </>
  )
}

/** All the items of a person go to another one (for example before they leave the tenant). */
function ReassignDialog({ slug, open, members, onClose }: { slug: string; open: boolean; members: Member[]; onClose: () => void }) {
  const [from, setFrom] = useState('')
  const [dest, setDest] = useState('')
  const run = useAction(() => api<{ reassigned: number }>('POST', `/api/t/${enc(slug)}/manage/resources/reassign`, { from, to: dest }), {
    invalidate: [['m-resources', slug], ['members', slug]],
  })
  const owners = members.filter((m) => m.owned_resources > 0)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Reassign a person's items")}</DialogTitle>
          <DialogDescription>{t('All their items go to the chosen person, with their shares.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ra-from">{t('From')}</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger id="ra-from" className="w-full">
                <SelectValue placeholder={t('Choose the person…')} />
              </SelectTrigger>
              <SelectContent>
                {owners.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.display_name || m.username} · {t('{count} items', { count: m.owned_resources })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ra-to">{t('To')}</Label>
            <Select value={dest} onValueChange={setDest}>
              <SelectTrigger id="ra-to" className="w-full">
                <SelectValue placeholder={t('Choose the person…')} />
              </SelectTrigger>
              <SelectContent>
                {members
                  .filter((m) => m.status === 'active' && m.user_id !== from)
                  .map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.display_name || m.username}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={!from || !dest || from === dest || run.isPending}
              onClick={() =>
                run.mutate(undefined, {
                  onSuccess: (r) => {
                    toast.success(t('{count} items reassigned', { count: (r as { reassigned: number }).reassigned }))
                    setFrom('')
                    setDest('')
                    onClose()
                  },
                })
              }
            >
              {t('Reassign')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LinksDialog({ slug, row, onClose }: { slug: string; row: ResourceRow | null; onClose: () => void }) {
  const q = useApi<LinkInfo[]>(['links', row?.id], row ? `/api/t/${enc(slug)}/resources/${row.id}/links` : null)
  const revoke = useAction((id: string) => api('DELETE', `/api/t/${enc(slug)}/links/${id}`), {
    ok: t('Link revoked'),
    invalidate: [['links', row?.id], ['m-resources', slug], ['overview', slug]],
  })
  const active = (q.data ?? []).filter((l) => l.active)
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Public links')}</DialogTitle>
          <DialogDescription>{row?.title || row?.kind}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : (
          <ul className="grid gap-2">
            {active.map((l) => (
              <li key={l.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block">
                    {t('Created on {date}', { date: fmtDate(l.created_at) })}
                    {l.created_by ? ` ${t('by {name}', { name: l.created_by })}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {l.expires_at ? t('Expires on {date}', { date: fmtDate(l.expires_at) }) : t('No expiry')} · {t('{n} views', { n: l.view_count })}
                    {l.has_password ? ` · ${t('with password')}` : ''}
                  </span>
                </span>
                <Button variant="outline" size="sm" onClick={() => revoke.mutate(l.id)}>
                  {t('Revoke')}
                </Button>
              </li>
            ))}
            {active.length === 0 && <li className="text-sm text-muted-foreground">{t('No active link.')}</li>}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── Usage ───────────────────────────────────────────────────────────── */

/** The usage of the tenant (Tenant Manager): the quotas, read only (the Administrator sets them), the
 *  trend, who uses the most, the activity and the alerts (docs/refactoring-ui.md §6). */
export function Usage({ slug, section }: { slug: string; section?: string }) {
  const sections = [
    { id: 'quotas', label: t('Quotas'), icon: <Gauge /> },
    { id: 'trend', label: t('Trend'), icon: <TrendingUp /> },
    { id: 'consumers', label: t('Who uses the most'), icon: <Users /> },
    { id: 'activity', label: t('Activity'), icon: <Activity /> },
    { id: 'alerts', label: t('Alerts'), icon: <Bell /> },
  ]
  const cur = sections.some((s) => s.id === section) ? section! : 'quotas'
  return (
    <>
      <PageHeader title={t('Usage')} crumbs={[{ label: t('Tenant management') }]} sub={t('Quotas set by the Administrator of the platform')} />
      <Sections sections={sections} current={cur} href={(id) => to.tenant(slug, 'usage', id === 'quotas' ? undefined : id)}>
        <div className="grid max-w-4xl gap-6">
          {cur === 'quotas' && <UsageQuotas slug={slug} />}
          {cur === 'trend' && <UsageTrend slug={slug} />}
          {cur === 'consumers' && <UsageConsumers slug={slug} />}
          {cur === 'activity' && <UsageActivity slug={slug} />}
          {cur === 'alerts' && <UsageAlerts slug={slug} />}
        </div>
      </Sections>
    </>
  )
}

/** Storage, items and activity of the tenant, with the KPIs of the plugins. */
function UsageActivity({ slug }: { slug: string }) {
  const q = useApi<TenantKpi>(['m-kpi', slug], `/api/t/${enc(slug)}/manage/kpi`)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const k = q.data!.core
  const all = totals(k.resources)
  const max = Math.max(1, ...k.activity.map((d) => d.events))
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        <Kpi label={t('Storage used')} value={fmtBytes(all.bytes)} hint={trashHint(all.trashBytes, 'bytes')} />
        <Kpi label={t('Items')} value={all.count} hint={trashHint(all.trashCount, 'items')} />
        <Kpi label={t('People')} value={k.members} hint={t('{guests} guests · {groups} groups', { guests: k.guests, groups: k.groups })} />
        <Kpi label={t('Active in the last 30 days')} value={k.active_users_30d} />
        <Kpi label={t('Shares')} value={k.shares} hint={t('{n} active public links · {v} views', { n: k.public_links, v: k.link_views })} onClick={() => go(to.tenant(slug, 'shares'))} />
      </div>
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">{t('Activity of the last days')}</h2>
        {k.activity.length === 0 ? (
          <Empty icon={<Gauge />} title={t('No activity')} />
        ) : (
          <div className="flex h-36 items-end gap-1 rounded-xl border bg-card p-4" role="img" aria-label={t('Events per day')}>
            {k.activity.map((d) => (
              <span key={d.day} title={t('{day}: {events} events, {users} people', { day: d.day, events: d.events, users: d.users })} className="min-w-1 flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(4, (d.events / max) * 100)}%` }} />
            ))}
          </div>
        )}
      </section>
      <PluginKpis items={q.data!.plugins} />
    </>
  )
}

/* ── Tenant settings ─────────────────────────────────────────────────── */

export function TenantSettingsPage({ slug, section }: { slug: string; section?: string }) {
  const ctx = useTenantCtx(slug)
  if (ctx.isLoading) return <Loading />
  if (ctx.data?.tenant.role !== 'tenant_manager') return <Empty title={t('Reserved to Tenant Managers')} />
  const level = { kind: 'tenant', slug } as const
  const sections = [
    { id: 'sharing', label: t('Sharing'), icon: <Share2 />, group: t('Tenant') },
    { id: 'security', label: t('Passwords and sessions'), icon: <KeyRound /> },
    { id: 'keys', label: t('Keys of outside services'), icon: <KeySquare /> },
    { id: 'embedding', label: t('Embedding'), icon: <Frame /> },
    { id: 'notifications', label: t('Notifications'), icon: <Bell /> },
    { id: 'appearance', label: t('Identity and appearance'), icon: <Palette />, group: t('Appearance') },
    { id: 'platform', label: t('Managed by the platform'), icon: <Lock />, group: t('Platform') },
  ]
  const tabs = [
    { id: 'identity', label: t('Identity and texts') },
    { id: 'theme', label: t('Theme and mode') },
    { id: 'languages', label: t('Languages and formats') },
  ]
  // before: Sign-in (now in Managed by the platform)
  const sec = section === 'sign-in' ? 'platform' : section
  const tab = tabs.some((x) => x.id === sec) ? sec! : sec === 'appearance' ? 'identity' : null
  const cur = tab ? 'appearance' : sections.some((s) => s.id === sec) ? sec! : 'sharing'
  return (
    <>
      <PageHeader title={t('Tenant settings')} sub={t('They apply to everybody in {name}', { name: ctx.data.tenant.name })} />
      <Sections sections={sections} current={cur} href={(id) => to.tenant(slug, 'settings', id === 'appearance' ? 'identity' : id)}>
        {cur === 'sharing' && <Policy slug={slug} />}
        {cur === 'security' && <SecurityPanel level={level} />}
        {cur === 'keys' && <KeysPanel level={level} />}
        {cur === 'embedding' && <EmbeddingPanel level={level} />}
        {cur === 'notifications' && <NotificationsPanel level={level} />}
        {cur === 'platform' && <ManagedPanel slug={slug} />}
        {cur === 'appearance' && tab && (
          <div className="grid gap-6">
            <Tabs tabs={tabs} current={tab} href={(id) => to.tenant(slug, 'settings', id)} />
            {tab === 'identity' && <IdentityPanel level={level} />}
            {tab === 'theme' && (
              <div className="grid gap-6">
                <TenantTheme slug={slug} />
                <ModePanel level={level} />
              </div>
            )}
            {tab === 'languages' && <LanguagesPanel level={level} />}
          </div>
        )}
      </Sections>
    </>
  )
}

function Policy({ slug }: { slug: string }) {
  const path = `/api/t/${enc(slug)}/manage/settings`
  const q = useApi<TenantSettings>(['settings', slug], path)
  const [v, setV] = useState<TenantSettings | null>(null)
  const save = useAction((s: TenantSettings) => api('PUT', path, s), { ok: t('Settings saved'), invalidate: [['settings', slug], ['ctx', slug]] })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const s = v ?? q.data!
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(q.data)
  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{t('Sharing')}</CardTitle>
          <CardDescription>{t('Public links and what Tenant Managers see.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <label className="flex items-center justify-between gap-4">
            <span>
              <b className="block text-sm">{t('Public links')}</b>
              <span className="text-xs text-muted-foreground">{t('Whoever has the manage permission can create read-only links')}</span>
            </span>
            <Switch checked={s.public_links_enabled} onCheckedChange={(x) => setV({ ...s, public_links_enabled: x })} />
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="maxd">{t('Maximum length of links, in days (0 = no limit)')}</Label>
            <Input id="maxd" type="number" min={0} className="w-32" value={s.public_link_max_days} onChange={(e) => setV({ ...s, public_link_max_days: Math.max(0, +e.target.value) })} />
          </div>
          <label className="flex items-center justify-between gap-4">
            <span>
              <b className="block text-sm">{t('Tenant Managers see the titles of the items')}</b>
              <span className="text-xs text-muted-foreground">{t('Otherwise only counts and sizes')}</span>
            </span>
            <Switch checked={s.managers_see_titles} onCheckedChange={(x) => setV({ ...s, managers_see_titles: x })} />
          </label>
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => v && save.mutate(v, { onSuccess: () => setV(null) })} onCancel={() => setV(null)} />
    </div>
  )
}
