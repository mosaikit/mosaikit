// Pages of a tenant: Home or overview, apps (in the iframe) and, for the Tenant Manager, the management of
// the tenant: People, Plugins, Shares, Usage and Tenant settings (docs/refactoring-ui.md §2).

import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Activity, Bell, Frame, Gauge, Grid2x2, KeyRound, KeySquare, Link2, Lock, Mail, MoreHorizontal, Palette, Plus, Share2, ShieldCheck, ShieldOff, Trash2, TrendingUp, Upload, UserRound, Users } from 'lucide-react'
import { api, appUrl, fmtBytes, fmtDate } from '../../api.ts'
import PluginFrame from '../../components/PluginFrame.tsx'
import { UiContext, useUi, type Ui } from '../../ui-context.ts'
import ShareDialog from '../ShareDialog.tsx'
import { SharedByMeSection } from './history.tsx'
import type { AccessRequest, Group, HomeItem, Invitation, LinkInfo, Member, Overview, Profile, ResetLink, ResourceRow, Revoked, Session, TenantContext, TenantKpi, TenantSettings } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { PersonPicture } from '../picture.tsx'
import { isApp, passwordMin, useAction, useApi, useConfig, useConfirm, usePaged, useTenantCtx, type PageOf } from '../core.ts'
import { fmtDay, t, useLang } from '../i18n.ts'
import { Empty, ErrorBox, FormDialog, Kpi, Loading, MoreRows, PageHeader, PluginKpis, SaveBar, SelectAllRows, Sections, StatusBadge, Sliced, Tabs } from '../kit.tsx'
import { go, to } from '../router.ts'
import { useNoteList, useUnread } from '../notes.ts'
import { NoteRow } from '../notifications.tsx'
import { effectiveMode, useTheme } from '../theme.ts'
import AppIcon from '../AppIcon.tsx'
import { ImportDialog, InviteManyDialog } from '../BulkPeople.tsx'
import { TenantTheme } from '../ThemeSettings.tsx'
import { useTenantSignIn } from '../signin.ts'
import { LinkDialog, ProfilesSection, RequestsTable } from './people.tsx'
import { ActivityWidget, AppsStrip, KpiRow, NotesWidget, TrendWidget, WaitingWidget, Widget, WidgetGrid } from '../Overview.tsx'
import { describe } from '../logtext.ts'
import { BulkBar, FilterColumn, ListPage, type FacetGroup } from '../listkit.tsx'
import { ListTable } from '../ListTable.tsx'
import { sortParams, type Sort } from '../tableutil.ts'
import { EmbeddingPanel, IdentityPanel, KeysPanel, LanguagesPanel, ManagedPanel, ModePanel, NotificationsPanel, SecurityPanel } from '../SettingsPanels.tsx'
import { UsageAlerts, UsageConsumers, UsagePanel, UsageQuotas, UsageTrend } from '../Quotas.tsx'
import { totals, trashHint } from '../usage.ts'
import { LayoutPanel, StylePanel } from '../LayoutSettings.tsx'

const enc = encodeURIComponent
const ROLE: Record<string, string> = {
  tenant_manager: 'Tenant Manager',
  user: 'User',
}

/* ── Overview ────────────────────────────────────────────────────────── */

/** Good morning, afternoon or evening, by the hour of the person. */
function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? t('Good morning') : h < 18 ? t('Good afternoon') : t('Good evening')
}

/** The Home as in the mockup: what to pick up again, what is due soon, what is for you (notifications). */
function HomeLists({ slug, pickUp, due, notifications = true }: { slug: string; pickUp: HomeItem[]; due: HomeItem[]; notifications?: boolean }) {
  const notes = useNoteList({ limit: 4 })
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const item = (x: HomeItem, when: ReactNode) => (
    <li key={x.resource_id}>
      <a href={to.item(slug, x.resource_id)} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
        <AppIcon id={x.plugin_id} />
        <span className="min-w-0 flex-1">
          <b className="block truncate font-medium">{x.title || t('(untitled)')}</b>
          <span className="text-xs text-muted-foreground">{x.plugin}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{when}</span>
      </a>
    </li>
  )
  const box = (id: string, title: string, children: ReactNode, footer?: ReactNode, span?: boolean) => (
    <Widget id={id} title={title} span={span}>
      {children}
      {footer}
    </Widget>
  )
  // widgets of the grid of the page (the parent draws it)
  return (
    <>
      {box(
        'home-pick-up',
        t('Pick up where you left off'),
        pickUp.length ? <ul className="grid gap-0.5">{pickUp.map((x) => item(x, fmtDay(x.at)))}</ul> : <p className="text-sm text-muted-foreground">{t('The items you create or change show here.')}</p>,
        undefined,
        true,
      )}
      {box(
        'home-due',
        t('Due soon'),
        due.length ? (
          <ul className="grid gap-0.5">
            {due.map((x) => item(x, x.at.slice(0, 10) < today ? <span className="font-medium text-destructive">{t('late, {date}', { date: fmtDay(x.at) })}</span> : fmtDay(x.at)))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Nothing due in the next 7 days.')}</p>
        ),
      )}
      {notifications &&
        box(
          'home-for-you',
          t('For you'),
          (notes.data?.items ?? []).length ? (
            <ul className="grid gap-1">
              {(notes.data?.items ?? []).map((n) => (
                <NoteRow key={n.id} n={n} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('No notifications')}</p>
          ),
          <a href={to.tenant(slug, 'notifications')} className="text-sm text-primary-strong underline-offset-4 hover:underline">
            {t('All notifications')}
          </a>,
        )}
    </>
  )
}

export function TenantHome({ session, slug }: { session: Session; slug: string }) {
  const ctx = useTenantCtx(slug)
  const o = useApi<Overview>(['overview', slug], `/api/t/${enc(slug)}/overview`)
  const unread = useUnread().data ?? 0
  if (ctx.isLoading || o.isLoading) return <Loading />
  if (ctx.error) return <ErrorBox error={ctx.error} />
  const c = ctx.data!
  const d = o.data
  const me = totals(d?.me.resources ?? [])
  const manager = c.tenant.role === 'tenant_manager'
  const days = d?.tenant?.activity ?? []
  const personal = (
    <>
      {d && (
        <KpiRow>
          <Kpi label={t('Your items')} value={me.count} hint={[fmtBytes(me.bytes), trashHint(me.trashCount, 'items')].filter(Boolean).join(' · ')} />
          <Kpi label={t('Unread notifications')} value={unread} hint={t('the latest below')} onClick={() => go(to.tenant(slug, 'notifications'))} />
          <Kpi label={t('Shared by me')} value={d.me.shared_by_me} />
          <Kpi label={t('Shared with me')} value={d.me.shared_with_me} hint={`${t('My active public links')}: ${d.me.public_links} · ${t('{n} views', { n: d.me.link_views })}`} />
        </KpiRow>
      )}
      {d && <HomeLists slug={slug} pickUp={d.me.pick_up ?? []} due={d.me.due ?? []} notifications={!manager} />}
      {d && d.me.activity.length > 0 && (
        <Widget id="ov-mine" title={t('My recent activity')} span={!manager}>
          <ul className="grid gap-0.5">
            {d.me.activity.slice(0, 5).map((e, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
                <span className="min-w-0 truncate">{[describe(e), e.title].filter(Boolean).join(' · ')}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(e.ts)}</span>
              </li>
            ))}
          </ul>
        </Widget>
      )}
      <SharedByMeSection slug={slug} full={manager} />
    </>
  )
  return (
    <>
      <PageHeader title={manager ? t('Tenant overview') : t('Home')} sub={`${greeting()}, ${session.user.display_name || session.user.username} · ${t('{role} in {tenant}', { role: c.tenant.role === 'tenant_manager' ? t(ROLE.tenant_manager) : t('User'), tenant: c.tenant.name })}`} />
      <div className="grid gap-4 p-6 max-[620px]:p-4">
        {!c.plugins.some(isApp) ? (
          <Empty compact art="apps" title={t('No active apps')}>
            {t('An Administrator installs and turns them on.')}
          </Empty>
        ) : (
          <AppsStrip slug={slug} plugins={c.plugins} />
        )}
        <WidgetGrid>
          {manager && d?.tenant && (
            <>
              <KpiRow>
                <Kpi label={t('Members')} value={d.tenant.members} hint={t('{count} guests', { count: d.tenant.guests })} onClick={() => go(to.tenant(slug, 'manage'))} />
                <Kpi label={t('Active users (30 days)')} value={d.tenant.active_users_30d} />
                <Kpi label={t('Items')} value={d.tenant.resources.reduce((s, r) => s + r.count, 0)} />
                <Kpi label={t('Shares')} value={d.tenant.shares} hint={t('{count} public links', { count: d.tenant.public_links })} onClick={() => go(to.tenant(slug, 'shares'))} />
              </KpiRow>
              <WaitingWidget slug={slug} publicLinks={d.tenant.public_links} />
              <TrendWidget
                id="ov-people"
                title={t('Active people')}
                figure={d.tenant.active_users_30d}
                caption={t('signed in the last 30 days, of {n}', { n: d.tenant.members })}
                values={days.map((x) => x.users)}
                link={{ href: to.tenant(slug, 'manage'), label: t('People') }}
              />
              <ActivityWidget slug={slug} />
              <NotesWidget href={to.tenant(slug, 'notifications')} />
              <div className="@xl:col-span-2 [&>section]:h-full">
                <UsagePanel slug={slug} />
              </div>
              <h2 className="-mb-1 text-sm font-semibold @xl:col-span-2 @4xl:col-span-4">{t('Your space')}</h2>
            </>
          )}
          {personal}
        </WidgetGrid>
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
        const ev = JSON.parse(m.data) as {
          type: string
          id: string
          what?: string
          error?: string
        }
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
  const ui = {
    lang,
    preset: th.preset,
    mode: effectiveMode(th),
    preference: th.mode,
    contrast: th.contrast,
  }
  const base = useUi()
  const reloads = useDevReload(session, slug)
  const [share, setShare] = useState<{ id: string; done: () => void } | null>(null)
  // the sharing asked by the plugin opens the dialog of the host, which knows the tenant
  const services = useMemo<Ui>(
    () => ({
      ...base,
      share: (rid) => new Promise<void>((done) => setShare({ id: rid, done })),
    }),
    [base],
  )
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
  // the whole list only where a choice among the members is needed (members of a group); People is paged
  const members = useApi<Member[]>(['members', slug], section === 'groups' ? `${base}/members` : null)
  const people = usePaged<Member>(['members', slug, 'count'], `${base}/members`, {}, 1)
  const groups = useApi<Group[]>(['groups', slug], `${base}/groups`)
  // a page at a time; the first one also says how many are pending
  const [inviteSort, setInviteSort] = useState<Sort>(null)
  const invites = usePaged<Invitation, PageOf<Invitation> & { pending: number }>(['invites', slug], `${base}/invitations`, { ...sortParams(inviteSort) }, 20)
  const profiles = useApi<Profile[]>(['profiles', slug], `${base}/profiles`)
  const requests = useApi<AccessRequest[]>(['requests', slug], `/api/t/${enc(slug)}/requests`)
  const cur = ['people', 'groups', 'profiles', 'pending'].includes(section ?? '') ? section! : 'people'
  const pending = (invites.first?.pending ?? 0) + (requests.data?.length ?? 0)
  const sections = [
    {
      id: 'people',
      label: t('People'),
      icon: <Users />,
      count: people.isLoading ? undefined : people.total,
    },
    {
      id: 'groups',
      label: t('Groups'),
      icon: <Grid2x2 />,
      count: groups.data?.length,
    },
    {
      id: 'profiles',
      label: t('Permission profiles'),
      icon: <KeySquare />,
      count: profiles.data?.length,
    },
    { id: 'pending', label: t('Pending'), icon: <Mail />, count: pending },
  ]
  const [dlg, setDlg] = useState<null | 'member' | 'group' | 'invite' | 'profile' | 'import' | 'invite-many'>(null)
  const inval = [
    ['members', slug],
    ['groups', slug],
    ['invites', slug],
    ['overview', slug],
    ['profiles', slug],
  ]
  const create = useAction((v: Record<string, string>) => api('POST', `${base}/members`, v), {
    ok: (v) => t('User {username} created', { username: v.username }),
    invalidate: inval,
  })
  const newGroup = useAction((v: Record<string, string>) => api('POST', `${base}/groups`, v), {
    ok: (v) => t('Group {name} created', { name: v.name }),
    invalidate: inval,
  })
  const invite = useAction(
    (v: Record<string, string>) =>
      api('POST', `${base}/invitations`, {
        ...v,
        profile: v.profile === 'default' ? null : v.profile,
      }),
    { ok: t('Invitation sent'), invalidate: inval },
  )
  const newProfile = useAction((v: Record<string, string>) => api('POST', `${base}/profiles`, v), {
    ok: (v) => t('Profile {name} created', { name: v.name }),
    invalidate: inval,
  })
  const profileChoices: [string, string][] = [['default', t('Default profile')], ...(profiles.data ?? []).filter((p) => !p.is_default).map((p): [string, string] => [p.id, p.name])]
  const action =
    cur === 'profiles' ? (
      <Button onClick={() => setDlg('profile')}>
        <Plus />
        {t('New profile')}
      </Button>
    ) : cur === 'people' ? (
      // as in the mockup: inviting is the primary action of People; with an identity provider the
      // people of the tenant come from the provider, at their first sign-in, so there is no New user
      // nor import
      <Button onClick={() => setDlg('invite')}>
        <Plus />
        {t('Invite people')}
      </Button>
    ) : cur === 'groups' ? (
      <Button onClick={() => setDlg('group')}>
        <Plus />
        {t('New group')}
      </Button>
    ) : (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setDlg('invite-many')}>
          <Users />
          {t('Invite several people')}
        </Button>
        <Button onClick={() => setDlg('invite')}>
          <Plus />
          {t('Invite people')}
        </Button>
      </div>
    )
  // the other actions of People sit before the search of the header, so that the search is next to the primary action
  const secondary =
    cur === 'people' ? (
      <div className="flex flex-wrap gap-2">
        {!oidc && (
          <Button variant="outline" onClick={() => setDlg('import')}>
            <Upload />
            {t('Import from CSV')}
          </Button>
        )}
        {!oidc && (
          <Button variant="outline" onClick={() => setDlg('member')}>
            <Plus />
            {t('New user')}
          </Button>
        )}
        <Button variant="outline" onClick={() => setDlg('invite-many')}>
          <Users />
          {t('Invite several people')}
        </Button>
      </div>
    ) : undefined
  const nav: FacetGroup = {
    id: 'section',
    label: t('Show'),
    value: cur,
    onChange: (id) => go(to.tenant(slug, 'manage', id)),
    options: sections.map((x) => ({
      id: x.id,
      label: x.label,
      count: x.count,
    })),
  }
  const shell: Shell = {
    title: t('Manage'),
    section: sections.find((x) => x.id === cur)?.label,
    sub: {
      people: t('{count} people', { count: people.total }),
      groups: t('{count} groups', { count: groups.data?.length ?? 0 }),
      profiles: t('{count} profiles', { count: profiles.data?.length ?? 0 }),
      pending: t('{count} pending', { count: pending }),
    }[cur],
    actions: action,
    secondary,
    nav,
  }
  return (
    <>
      {cur === 'people' && <People slug={slug} profiles={profiles.data ?? []} groups={groups.data ?? []} shell={shell} />}
      {cur === 'groups' && <Groups slug={slug} members={members.data ?? []} shell={shell} />}
      {(cur === 'profiles' || cur === 'pending') && (
        <ListPage title={shell.title} section={shell.section} sub={shell.sub} actions={shell.actions} filters={<FilterColumn groups={[nav]} />}>
          {cur === 'profiles' && <ProfilesSection slug={slug} />}
          {cur === 'pending' && (
            <div className="grid gap-6">
              <section className="grid gap-2" aria-label={t('Access requests')}>
                <h2 className="text-sm font-semibold">{t('Access requests')}</h2>
                <RequestsTable slug={slug} manager />
              </section>
              <section className="grid gap-2" aria-label={t('Invitations')}>
                <h2 className="text-sm font-semibold">{t('Invitations')}</h2>
                <Invites slug={slug} q={invites} sort={inviteSort} onSort={setInviteSort} onInvite={() => setDlg('invite')} />
              </section>
            </div>
          )}
        </ListPage>
      )}
      <FormDialog
        open={dlg === 'member'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('New user')}
        description={t('A local account of this tenant.')}
        fields={[
          { name: 'username', label: t('Username'), required: true },
          { name: 'display_name', label: t('Display name') },
          { name: 'email', label: t('Email'), type: 'email', required: true, hint: t('Required: the password is recovered at this address.') },
          { name: 'password', label: t('Initial password'), type: 'password', required: true, hint: t('At least {n} characters', { n: pwMin }) },
          { name: 'role', label: t('Role'), options: [['user', 'User'], ['tenant_manager', t('Tenant Manager')]] },
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
          {
            name: 'role',
            label: t('Role'),
            options: [
              ['user', t('User')],
              ['tenant_manager', t('Tenant Manager')],
            ],
          },
          {
            name: 'profile',
            label: t('Permission profile'),
            options: profileChoices,
          },
        ]}
        submit={t('Send the invitation')}
        onSubmit={(v) => invite.mutateAsync(v)}
      />
      <ImportDialog slug={slug} open={dlg === 'import'} onOpenChange={(o) => !o && setDlg(null)} />
      <InviteManyDialog slug={slug} profiles={profiles.data ?? []} open={dlg === 'invite-many'} onOpenChange={(o) => !o && setDlg(null)} />
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

/** What Manage gives to each section: the header and the section list of the filter column. */
interface Shell {
  title: string
  section?: string
  sub: ReactNode
  actions: ReactNode
  secondary?: ReactNode
  nav: FacetGroup
}

function People({ slug, profiles, groups, shell }: { slug: string; profiles: Profile[]; groups: Group[]; shell: Shell }) {
  const pwMin = passwordMin(useConfig(slug))
  const oidc = useTenantSignIn(slug) === 'oidc'
  const base = `/api/t/${enc(slug)}/manage/members`
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const words = useDeferredValue(search.trim())
  // a page at a time, searched on the server
  const [sort, setSort] = useState<Sort>(null)
  const q = usePaged<Member>(['members', slug, 'page'], base, {
    q: words || undefined,
    ...sortParams(sort),
  })
  const [everyone, setEveryone] = useState(false)
  const [selKey, setSelKey] = useState(words)
  if (selKey !== words) {
    setSelKey(words)
    setSel(new Set())
    setEveryone(false)
  }
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
  const resetPw = useAction(({ id, password }: { id: string; password: string }) => api('POST', `${base}/${id}/password`, { password }), {
    ok: t('Password reset'),
  })
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
  // the new owner of the items of a person removed is chosen among every member
  const everyMember = useApi<Member[]>(['members', slug], removing ? base : null)
  const frame = (bar: ReactNode, content: ReactNode) => (
    <ListPage
      title={shell.title}
      section={shell.section}
      sub={shell.sub}
      actions={shell.actions}
      secondary={shell.secondary}
      bar={bar}
      filters={<FilterColumn search={search} onSearch={setSearch} searchLabel={t('Search by name or username')} onReset={() => setSearch('')} groups={[shell.nav]} />}
    >
      {content}
    </ListPage>
  )
  if (q.isLoading) return frame(undefined, <Loading />)
  if (q.error) return frame(undefined, <ErrorBox error={q.error} />)
  const rows = q.items
  // the selection may hold people of pages not loaded yet («Select all»)
  const ids = [...sel]
  const all = rows.length > 0 && ids.length >= rows.length
  const bar = (
    <BulkBar
      selected={ids.length}
      total={rows.length}
      all={all}
      onAll={(on) => {
        setSel(on ? new Set(rows.map((r) => r.user_id)) : new Set())
        setEveryone(false)
      }}
      actions={
        <>
          {q.more && !everyone && all && (
            <SelectAllRows
              selected={ids.length}
              total={q.total}
              onAll={async () => {
                setSel(new Set(await q.allIds()))
                setEveryone(true)
              }}
            />
          )}
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
                <DropdownMenuItem key={g.id} disabled={g.source === 'idp'} onSelect={() => toGroup.mutate({ ids, group: g.id })}>
                  {g.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => suspend.mutate({ ids, suspended: true })}>
            {t('Suspend')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSel(new Set())
              setEveryone(false)
            }}
          >
            {t('Deselect')}
          </Button>
        </>
      }
    />
  )
  return frame(
    bar,
    <>
      <ListTable
        label={t('People')}
        rows={rows}
        rowKey={(m) => m.user_id}
        server={{ total: q.total, more: !!q.more, loading: q.loadingMore, onMore: q.loadMore }}
        sort={sort}
        onSort={setSort}
        selection={{ ids: sel, onChange: setSel, label: (m) => t('Select {name}', { name: m.username }) }}
        rowProps={(m) => ({ className: 'cursor-pointer', onClick: () => go(to.person(slug, m.user_id)) })}
        empty={<p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">{t('No person found.')}</p>}
        columns={[
          {
            key: 'name',
            title: t('Name'),
            width: 'minmax(13rem,2fr)',
            sort: (m) => m.display_name || m.username,
            serverSort: true,
            cell: (m) => (
              <div className="flex items-center gap-2.5">
                <PersonPicture id={m.user_id} name={m.display_name || m.username} className="size-8 bg-primary/15 text-xs text-primary-strong" />
                <div>
                  <a className="font-medium hover:underline" onClick={(e) => e.stopPropagation()} href={to.person(slug, m.user_id)}>
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
            ),
          },
          {
            key: 'role',
            title: t('Role and profile'),
            width: 'minmax(11rem,1.4fr)',
            sort: (m) => m.role,
            serverSort: true,
            cell: (m) => (
              <>
                <Badge variant={m.role === 'tenant_manager' ? 'default' : 'secondary'} className="font-normal">
                  {t(ROLE[m.role])}
                </Badge>
                <div className="mt-1 text-xs text-muted-foreground">{m.role === 'tenant_manager' ? t('every permission') : m.profile}</div>
              </>
            ),
          },
          { key: 'groups', title: t('Groups'), width: 'minmax(8rem,1fr)', sort: (m) => m.groups.join(', '), className: 'text-sm text-muted-foreground', cell: (m) => m.groups.join(', ') || '—' },
          { key: 'status', title: t('Status'), width: 'minmax(7rem,.8fr)', sort: (m) => (m.status !== 'active' ? m.status : m.membership), serverSort: true, cell: (m) => <StatusBadge status={m.status !== 'active' ? m.status : m.membership} /> },
          { key: 'items', title: t('Items'), width: 'minmax(5rem,.6fr)', align: 'right', sort: (m) => m.owned_resources, cell: (m) => m.owned_resources },
          { key: 'last', title: t('Last sign-in'), width: 'minmax(8rem,1fr)', sort: (m) => m.last_sign_in_at ?? '', serverSort: true, className: 'text-muted-foreground', cell: (m) => (m.last_sign_in_at ? fmtDate(m.last_sign_in_at) : t('Never')) },
          {
            key: 'actions',
            title: t('Actions'),
            hideTitle: true,
            width: '3rem',
            cell: (m) => (
              <span onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('Actions for {username}', {
                username: m.username,
              })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => go(to.person(slug, m.user_id))}>
              <UserRound />
              {t('Open')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                setRole.mutate({
                  ids: [m.user_id],
                  role: m.role === 'user' ? 'tenant_manager' : 'user',
                })
              }
            >
              <ShieldCheck />
              {m.role === 'user' ? t('Make Tenant Manager') : t('Make User')}
            </DropdownMenuItem>
            {!m.is_guest && !oidc && (
              <DropdownMenuItem
                onSelect={() =>
                  sendLink.mutate(m, {
                    onSuccess: (l) =>
                      setLink({
                        name: m.display_name || m.username,
                        link: l as ResetLink,
                      }),
                  })
                }
              >
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
            <DropdownMenuItem
              onSelect={() =>
                suspend.mutate({
                  ids: [m.user_id],
                  suspended: m.membership !== 'suspended',
                })
              }
            >
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
              </span>
            ),
          },
        ]}
      />
      <FormDialog
        open={!!pwFor}
        onOpenChange={(o) => !o && setPwFor(null)}
        title={t('New password for {username}', {
          username: pwFor?.username ?? '',
        })}
        description={t('Their open sessions are closed.')}
        fields={[
          {
            name: 'password',
            label: t('New password'),
            type: 'password',
            required: true,
            hint: t('At least {n} characters', { n: pwMin }),
          },
        ]}
        submit={t('Reset')}
        onSubmit={(v) => resetPw.mutateAsync({ id: pwFor!.user_id, password: v.password })}
      />
      <LinkDialog link={link?.link ?? null} name={link?.name ?? ''} onClose={() => setLink(null)} />
      <RemoveDialog
        member={removing}
        members={everyMember.data ?? []}
        busy={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={(newOwner) => remove.mutate({ id: removing!.user_id, newOwner }, { onSuccess: () => setRemoving(null) })}
      />
    </>,
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
              <Label htmlFor="rm-owner">
                {t('Who gets their {count} items', {
                  count: member!.owned_resources,
                })}
              </Label>
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

/** A group of the identity provider of the tenant: read-only in Mosaikit. */
export function IdpBadge() {
  return (
    <Badge variant="outline" className="font-normal" title={t('Only the identity provider changes it')}>
      {t('From the identity provider')}
    </Badge>
  )
}

function Groups({ slug, members, shell }: { slug: string; members: Member[]; shell: Shell }) {
  const base = `/api/t/${enc(slug)}/manage/groups`
  const [search, setSearch] = useState('')
  const words = useDeferredValue(search.trim())
  // a page at a time, searched on the server
  const q = usePaged<Group>(['groups', slug, 'page'], base, {
    q: words || undefined,
  })
  const confirm = useConfirm()
  const inval = [['groups', slug]]
  const del = useAction((id: string) => api('DELETE', `${base}/${id}`), {
    ok: t('Group deleted'),
    invalidate: inval,
  })
  const addMember = useAction(({ g, u }: { g: string; u: string }) => api('PUT', `${base}/${g}/members/${u}`), {
    ok: t('Added to the group'),
    invalidate: inval,
  })
  const rmMember = useAction(({ g, u }: { g: string; u: string }) => api('DELETE', `${base}/${g}/members/${u}`), { invalidate: inval })
  const frame = (content: ReactNode) => (
    <ListPage
      title={shell.title}
      section={shell.section}
      sub={shell.sub}
      actions={shell.actions}
      filters={<FilterColumn search={search} onSearch={setSearch} searchLabel={t('Search a group')} onReset={() => setSearch('')} groups={[shell.nav]} />}
    >
      {content}
    </ListPage>
  )
  if (q.isLoading) return frame(<Loading />)
  if (q.error) return frame(<ErrorBox error={q.error} />)
  if (!q.items.length && !words)
    return frame(
      <Empty art="people" title={t('No groups')} actions={shell.actions}>
        {t('Groups are for sharing with several people at once.')}
      </Empty>,
    )
  return frame(
    <>
      {!q.items.length && <p className="text-sm text-muted-foreground">{t('No group found.')}</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {q.items.map((g) => {
          const others = members.filter((m) => !g.members.some((x) => x.user_id === m.user_id))
          const idp = g.source === 'idp'
          return (
            <Card key={g.id}>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <a className="hover:underline" href={to.group(slug, g.id)}>
                      {g.name}
                    </a>
                    {idp && <IdpBadge />}
                  </CardTitle>
                  <CardDescription>{t('{count} members', { count: g.members.length })}</CardDescription>
                </div>
                {!idp && (
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
                      aria-label={t('Delete the group {name}', {
                        name: g.name,
                      })}
                      onClick={async () => (await confirm(t('Delete the group {name}? The shares with the group are revoked.', { name: g.name }), true)) && del.mutate(g.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {g.members.length === 0 && <span className="text-sm text-muted-foreground">{t('No members.')}</span>}
                {g.members.map((m) => (
                  <Badge key={m.user_id} variant="secondary" className="gap-1 font-normal">
                    {m.display_name || m.username}
                    {!idp && (
                      <button
                        type="button"
                        aria-label={t('Remove {username} from the group', {
                          username: m.username,
                        })}
                        className="ml-0.5 opacity-60 hover:opacity-100"
                        onClick={() => rmMember.mutate({ g: g.id, u: m.user_id })}
                      >
                        ×
                      </button>
                    )}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )
        })}
      </div>
      <MoreRows shown={q.items.length} total={q.total} more={q.more} loading={q.loadingMore} onMore={q.loadMore} />
    </>,
  )
}

function Invites({ slug, q, sort, onSort, onInvite }: { slug: string; onInvite: () => void; q: ReturnType<typeof usePaged<Invitation, PageOf<Invitation> & { pending: number }>>; sort: Sort; onSort: (s: Sort) => void }) {
  const revoke = useAction((id: string) => api('DELETE', `/api/t/${enc(slug)}/manage/invitations/${id}`), {
    ok: t('Invitation revoked'),
    invalidate: [['invites', slug]],
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.items.length)
    return (
      <Empty
        compact
        art="people"
        title={t('Nothing pending')}
        actions={
          <Button size="sm" onClick={onInvite}>
            <Plus />
            {t('Invite people')}
          </Button>
        }
      >
        {t('Invitations to people of other tenants stay here until they answer.')}
      </Empty>
    )
  return (
    <ListTable
      label={t('Invitations')}
      rows={q.items}
      rowKey={(i) => i.id}
      server={{ total: q.total, more: !!q.more, loading: q.loadingMore, onMore: q.loadMore }}
      sort={sort}
      onSort={onSort}
      columns={[
        { key: 'person', title: t('Person'), width: 'minmax(10rem,2fr)', sort: (i) => i.user, serverSort: true, className: 'font-medium', cell: (i) => i.user },
        { key: 'role', title: t('Role'), sort: (i) => t(ROLE[i.role]), serverSort: true, cell: (i) => t(ROLE[i.role]) },
        { key: 'status', title: t('Status'), sort: (i) => i.status, serverSort: true, cell: (i) => <StatusBadge status={i.status} /> },
        { key: 'expires', title: t('Expires'), sort: (i) => i.expires_at, serverSort: true, className: 'text-muted-foreground', cell: (i) => fmtDate(i.expires_at) },
        {
          key: 'actions',
          title: t('Actions'),
          hideTitle: true,
          width: '6rem',
          className: 'justify-self-end',
          cell: (i) =>
            i.status === 'pending' && (
              <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)}>
                {t('Revoke')}
              </Button>
            ),
        },
      ]}
    />
  )
}

/* ── Plugins of the tenant ───────────────────────────────────────────── */

/* ── Shares ──────────────────────────────────────────────────────────── */

/** The items of the tenant shared with others or with a public link; links are revoked from here. */
/** A page of the items of the tenant, with the counts of the pills. */
type ResourcePageData = PageOf<ResourceRow> & {
  counts: { items: number; shared: number; public: number }
}

export function Shares({ slug }: { slug: string }) {
  const ctx = useTenantCtx(slug)
  const members = useApi<Member[]>(['members', slug], `/api/t/${enc(slug)}/manage/members`)
  const [show, setShow] = useState('all')
  const [filter, setFilter] = useState({ owner: '', plugin: '', q: '' })
  const words = useDeferredValue(filter.q.trim())
  // filtered and paged on the server (a tenant may have hundreds of thousands of items)
  const [sort, setSort] = useState<Sort>(null)
  const q = usePaged<ResourceRow, ResourcePageData>(['m-resources', slug, 'page'], `/api/t/${enc(slug)}/manage/resources`, {
    show: show === 'all' ? 'shared' : show,
    owner: filter.owner || undefined,
    plugin: filter.plugin || undefined,
    q: words || undefined,
    ...sortParams(sort),
  })
  const [links, setLinks] = useState<ResourceRow | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)
  const [reassign, setReassign] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [everyone, setEveryone] = useState(false)
  const filterKey = [show, filter.owner, filter.plugin, words].join('|')
  const [selKey, setSelKey] = useState(filterKey)
  if (selKey !== filterKey) {
    setSelKey(filterKey)
    setSel(new Set())
    setEveryone(false)
  }
  const confirm = useConfirm()
  const revoke = useAction(
    (ids: string[]) =>
      api<Revoked>('POST', `/api/t/${enc(slug)}/manage/resources/revoke`, {
        ids,
      }),
    {
      invalidate: [
        ['m-resources', slug],
        ['overview', slug],
        ['shared-by-me', slug],
      ],
    },
  )
  // `ids` may hold items of pages not loaded yet («Select all»)
  const askRevoke = async (ids: string[], one?: ResourceRow) => {
    const text = one
      ? t('Revoke every share and public link of «{name}»? The owner keeps the item.', { name: one.title || one.kind })
      : t('Revoke every share and public link of {count} items? The owners keep their items.', { count: ids.length })
    if (await confirm(text, true))
      revoke.mutate(ids, {
        onSuccess: (r) => {
          const x = r as Revoked
          toast.success(
            t('Revoked: {shares} shares, {links} public links', {
              shares: x.shares,
              links: x.links,
            }),
          )
          setSel(new Set())
          setEveryone(false)
        },
      })
  }
  const counts = q.first?.counts ?? { items: 0, shared: 0, public: 0 }
  const rows = q.items
  const selectable = rows.filter((r) => r.shares > 0 || r.public_links > 0)
  const ids = [...sel]
  const allSel = selectable.length > 0 && ids.length >= selectable.length
  const plugins = ctx.data?.plugins ?? []
  const label = (id: string) => plugins.find((p) => p.id === id)?.label ?? id
  const seeTitles = ctx.data?.tenant.settings.managers_see_titles
  return (
    <>
      <ListPage
        title={t('Shares')}
        sub={t('Items shared with other people, with groups or with a public link')}
        bar={
          <BulkBar
            selected={ids.length}
            total={selectable.length}
            all={allSel}
            onAll={(on) => {
              setSel(on ? new Set(selectable.map((r) => r.id)) : new Set())
              setEveryone(false)
            }}
            actions={
              <>
                {show !== 'items' && q.more && !everyone && allSel && (
                  <SelectAllRows
                    selected={ids.length}
                    total={q.total}
                    onAll={async () => {
                      setSel(new Set(await q.allIds()))
                      setEveryone(true)
                    }}
                  />
                )}
                <Button variant="outline" size="sm" onClick={() => void askRevoke(ids, ids.length === 1 ? rows.find((r) => r.id === ids[0]) : undefined)}>
                  {t('Revoke shares and links')}
                </Button>
              </>
            }
          />
        }
        more={
          <DropdownMenuItem onSelect={() => setReassign(true)}>
            <Users />
            {t("Reassign a person's items")}
          </DropdownMenuItem>
        }
        filters={
          <FilterColumn
            search={seeTitles ? filter.q : undefined}
            onSearch={seeTitles ? (v) => setFilter({ ...filter, q: v }) : undefined}
            searchLabel={t('Search in the title')}
            onReset={() => {
              setShow('all')
              setFilter({ owner: '', plugin: '', q: '' })
            }}
            groups={[
              {
                id: 'show',
                label: t('Show'),
                value: show,
                onChange: setShow,
                options: [
                  { id: 'all', label: t('Shared'), count: counts.shared },
                  {
                    id: 'public',
                    label: t('Public and links'),
                    count: counts.public,
                  },
                  { id: 'items', label: t('All items'), count: counts.items },
                ],
              },
              {
                id: 'app',
                label: t('Apps'),
                value: filter.plugin || 'all',
                onChange: (v) => setFilter({ ...filter, plugin: v === 'all' ? '' : v }),
                options: [{ id: 'all', label: t('All apps') }, ...plugins.map((p) => ({ id: p.id, label: p.label }))],
              },
            ]}
          />
        }
      >
        <Select value={filter.owner || 'all'} onValueChange={(v) => setFilter({ ...filter, owner: v === 'all' ? '' : v })}>
          <SelectTrigger size="sm" className="w-56 max-w-full" aria-label={t('Owner')}>
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
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : rows.length === 0 ? (
          show === 'all' && !filter.plugin && !filter.owner && !words ? (
            <Empty art="shares" title={t('Nothing shared yet')}>
              {t('Items you share with people, groups or a public link appear here.')}
            </Empty>
          ) : (
            <Empty
              filtered
              title={show === 'public' ? t('No active public link') : show === 'items' ? t('No items') : t('No shares')}
              onClear={() => {
                setShow('all')
                setFilter({ owner: '', plugin: '', q: '' })
              }}
            />
          )
        ) : (
          <ListTable
            label={t('Shared items')}
            rows={rows}
            rowKey={(r) => r.id}
            server={{ total: q.total, more: !!q.more, loading: q.loadingMore, onMore: q.loadMore }}
            sort={sort}
            onSort={setSort}
            selection={{ ids: sel, onChange: setSel, label: (r) => t('Select {name}', { name: r.title || r.kind }), skip: (r) => !(r.shares > 0 || r.public_links > 0) }}
            columns={[
              {
                key: 'item',
                title: t('Item'),
                width: 'minmax(12rem,2fr)',
                sort: (r) => r.title,
                serverSort: true,
                cell: (r) => (
                  <>
                    <b className="block font-medium">{r.title || <span className="font-normal text-muted-foreground italic">{t('title hidden')}</span>}</b>
                    <span className="text-xs text-muted-foreground">
                      {label(r.plugin_id)} · {r.kind}
                    </span>
                  </>
                ),
              },
              {
                key: 'owner',
                title: t('Owner'),
                width: 'minmax(8rem,1fr)',
                sort: (r) => r.owner_name,
                serverSort: true,
                cell: (r) => (
                  <>
                    {r.owner_name}
                    {!r.owner_active && (
                      <Badge variant="secondary" className="ml-2 font-normal">
                        {t('left')}
                      </Badge>
                    )}
                  </>
                ),
              },
              { key: 'size', title: t('Size'), width: 'minmax(5rem,.6fr)', align: 'right', sort: (r) => r.size_bytes, serverSort: true, cell: (r) => fmtBytes(r.size_bytes) },
              { key: 'shares', title: t('Shares'), width: 'minmax(5rem,.6fr)', align: 'right', sort: (r) => r.shares, cell: (r) => r.shares },
              {
                key: 'links',
                title: t('Public links'),
                width: 'minmax(6rem,.7fr)',
                align: 'right',
                sort: (r) => r.public_links,
                cell: (r) =>
                  r.public_links > 0 ? (
                    <Badge variant="secondary" className="bg-warn/10 font-normal text-warn">
                      {r.public_links}
                    </Badge>
                  ) : (
                    0
                  ),
              },
              { key: 'updated', title: t('Modified'), width: 'minmax(8rem,1fr)', sort: (r) => r.updated_at, serverSort: true, className: 'text-muted-foreground', cell: (r) => fmtDate(r.updated_at) },
              {
                key: 'actions',
                title: t('Actions'),
                hideTitle: true,
                width: 'minmax(14rem,auto)',
                className: 'justify-self-end whitespace-nowrap',
                cell: (r) => (
                  <>
                    {r.public_links > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => setLinks(r)}>
                        {t('Public links')}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setSharing(r.id)}>
                      {t('Share')}
                    </Button>
                    {(r.shares > 0 || r.public_links > 0) && (
                      <Button variant="ghost" size="sm" onClick={() => void askRevoke([r.id], r)}>
                        {t('Revoke')}
                      </Button>
                    )}
                  </>
                ),
              },
            ]}
          />
        )}
        {rows.length > 0 && !rows.some((r) => r.title) && <p className="text-xs text-muted-foreground">{t('Titles are hidden by the rules of the tenant (Tenant settings › Sharing).')}</p>}
      </ListPage>
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
                    toast.success(
                      t('{count} items reassigned', {
                        count: (r as { reassigned: number }).reassigned,
                      }),
                    )
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
          <Sliced items={active}>{(shown) => (<ul className="grid gap-2">
            {shown.map((l) => (
              <li key={l.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block">
                    {t('Created on {date}', { date: fmtDate(l.created_at) })}
                    {l.created_by ? ` ${t('by {name}', { name: l.created_by })}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {l.expires_at ? t('Expires on {date}', { date: fmtDay(l.expires_at) }) : t('No expiry')} · {t('{n} views', { n: l.view_count })}
                    {l.has_password ? ` · ${t('with password')}` : ''}
                  </span>
                </span>
                <Button variant="outline" size="sm" onClick={() => revoke.mutate(l.id)}>
                  {t('Revoke')}
                </Button>
              </li>
            ))}
            {active.length === 0 && <li className="text-sm text-muted-foreground">{t('No active link.')}</li>}
          </ul>)}</Sliced>
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
        <div className="grid gap-6">
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
        <Kpi
          label={t('People')}
          value={k.members}
          hint={t('{guests} guests · {groups} groups', {
            guests: k.guests,
            groups: k.groups,
          })}
        />
        <Kpi label={t('Active in the last 30 days')} value={k.active_users_30d} />
        <Kpi
          label={t('Shares')}
          value={k.shares}
          hint={t('{n} active public links · {v} views', {
            n: k.public_links,
            v: k.link_views,
          })}
          onClick={() => go(to.tenant(slug, 'shares'))}
        />
      </div>
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">{t('Activity of the last days')}</h2>
        {k.activity.length === 0 ? (
          <Empty compact art="usage" title={t('No activity')}>{t('The events of the last days appear here.')}</Empty>
        ) : (
          <div className="flex h-36 items-end gap-1 rounded-xl border bg-card p-4" role="img" aria-label={t('Events per day')}>
            {k.activity.map((d) => (
              <span
                key={d.day}
                title={t('{day}: {events} events, {users} people', {
                  day: d.day,
                  events: d.events,
                  users: d.users,
                })}
                className="min-w-1 flex-1 rounded-t bg-primary/70"
                style={{ height: `${Math.max(4, (d.events / max) * 100)}%` }}
              />
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
    {
      id: 'sharing',
      label: t('Sharing'),
      icon: <Share2 />,
      group: t('Tenant'),
    },
    { id: 'security', label: t('Passwords and sessions'), icon: <KeyRound /> },
    { id: 'keys', label: t('Keys of outside services'), icon: <KeySquare /> },
    { id: 'embedding', label: t('Embedding'), icon: <Frame /> },
    { id: 'notifications', label: t('Notifications'), icon: <Bell /> },
    {
      id: 'appearance',
      label: t('Identity and appearance'),
      icon: <Palette />,
      group: t('Appearance'),
    },
    {
      id: 'platform',
      label: t('Managed by the platform'),
      icon: <Lock />,
      group: t('Platform'),
    },
  ]
  const tabs = [
    { id: 'identity', label: t('Identity and texts') },
    { id: 'theme', label: t('Theme and mode') },
    { id: 'layout', label: t('Layout') },
    { id: 'style', label: t('Style') },
    { id: 'languages', label: t('Languages and formats') },
  ]
  // before: Sign-in (now in Managed by the platform)
  const sec = section === 'sign-in' ? 'platform' : section
  const tab = tabs.some((x) => x.id === sec) ? sec! : sec === 'appearance' ? 'identity' : null
  const cur = tab ? 'appearance' : sections.some((s) => s.id === sec) ? sec! : 'sharing'
  return (
    <>
      <PageHeader
        title={t('Tenant settings')}
        sub={t('They apply to everybody in {name}', {
          name: ctx.data.tenant.name,
        })}
      />
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
            {tab === 'layout' && <LayoutPanel level={level} />}
            {tab === 'style' && <StylePanel level={level} />}
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
    <div>
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
            <Input
              id="maxd"
              type="number"
              min={0}
              className="w-32"
              value={s.public_link_max_days}
              onChange={(e) =>
                setV({
                  ...s,
                  public_link_max_days: Math.max(0, +e.target.value),
                })
              }
            />
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
