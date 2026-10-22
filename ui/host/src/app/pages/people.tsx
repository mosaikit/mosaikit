// People and permissions (docs/refactoring-ui.md §3, mockup: members/*, person/*, group/*, module,
// gusers): the detail of a person for the Tenant Manager and for the Administrator, permission profiles,
// the permissions of a plugin, access requests, the directory of every person, the page of a link to
// choose a new password.

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, KeyRound, Link2, LogOut, Minus, MoreHorizontal, Plus, Puzzle, ShieldCheck, ShieldOff, Trash2, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api, errText, fmtDate, ApiError } from '../../api.ts'
import { useBrand } from '../../brand.ts'
import type {
  AccessRequest,
  Group,
  GroupDetail,
  Member,
  MemberDetail,
  PermDecl,
  PersonRow,
  PluginAccess,
  Profile,
  ResetLink,
  SessionInfo,
  TenantInfo,
  WhyNot,
} from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { initials, useAction, useApi, useConfirm, useTenantCtx } from '../core.ts'
import { t } from '../i18n.ts'
import { Empty, ErrorBox, Loading, PageHeader, Pills, SaveBar, StatusBadge, Tabs } from '../kit.tsx'
import { go, to } from '../router.ts'
import AppIcon from '../AppIcon.tsx'
import { AppMark } from '../Shell.tsx'
import { IdpBadge, RemoveDialog } from './tenant.tsx'
import { ActivityLog } from './history.tsx'

const enc = encodeURIComponent

function roleLabel(r: string): string {
  return r === 'tenant_manager' ? 'Tenant Manager' : t('User')
}

/** Texts of the standard permissions come from the kernel in English; the others in the language of the request. */
function permLabel(p: { label: string; standard: boolean }): string {
  return p.standard ? t(p.label) : p.label
}

/** A permission by its key, for the summaries (the standard ones have a text). */
function keyLabel(k: string): string {
  const std: Record<string, string> = { use: 'Use the app', create: 'Create items', delete: 'Delete items', share: 'Share items' }
  return std[k] ? t(std[k]) : k
}

function permDescription(p: PermDecl): string {
  return p.standard ? t(p.description) : p.description
}

/** The default profile when a member has none. */
const DEFAULT = 'default'

function profileOptions(profiles: Profile[]): [string, string][] {
  const def = profiles.find((p) => p.is_default)
  return [[DEFAULT, def ? t('Default profile ({name})', { name: def.name }) : t('Default profile')], ...profiles.filter((p) => !p.is_default).map((p): [string, string] => [p.id, p.name])]
}

function memberStatus(m: { status: string; membership: string }): string {
  return m.status !== 'active' ? m.status : m.membership
}

/* ── Link to choose a new password ───────────────────────────────────── */

/** The link just created: to copy and give to the person (it is shown once). */
export function LinkDialog({ link, name, onClose }: { link: ResetLink | null; name: string; onClose: () => void }) {
  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Link to choose a new password')}</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        {link && (
          <div className="grid gap-3 text-sm">
            <p>{t('Give this link to the person: it works once, until {date}.', { date: fmtDate(link.expires_at) })}</p>
            <div className="flex gap-2">
              <Input readOnly value={link.url} aria-label={t('Link')} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(link.url)
                  toast.success(t('Link copied'))
                }}
              >
                <Copy />
                {t('Copy')}
              </Button>
            </div>
            {link.emailed && <p className="text-muted-foreground">{t('It was also sent to the email address of the account.')}</p>}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>{t('Done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Sign-in, sessions, activity (shared by Tenant Manager and Administrator) ── */

function SignInPanel({ base, qk, name }: { base: string; qk: string[]; name: string }) {
  const sessions = useApi<SessionInfo[]>([...qk, 'sessions'], `${base}/sessions`)
  const [link, setLink] = useState<ResetLink | null>(null)
  const inval = [[...qk, 'sessions']]
  const reset = useAction(() => api<ResetLink>('POST', `${base}/reset-link`), {})
  const closeOne = useAction((id: string) => api('DELETE', `${base}/sessions/${enc(id)}`), { ok: t('Session closed'), invalidate: inval })
  const closeAll = useAction(() => api('DELETE', `${base}/sessions`), { ok: t('Every session closed'), invalidate: inval })
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Password')}</CardTitle>
          <CardDescription>{t('A local account of Mosaikit. A link lets the person choose a new password; their sessions close when they do.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled={reset.isPending} onClick={() => reset.mutate(undefined, { onSuccess: (l) => setLink(l as ResetLink) })}>
            <Link2 />
            {t('Send the password link')}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Sessions')}</CardTitle>
          <CardDescription>{t('Where the person is signed in now.')}</CardDescription>
          {!!sessions.data?.length && (
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => closeAll.mutate(undefined)}>
                <LogOut />
                {t('Close every session')}
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {sessions.isLoading ? (
            <Loading />
          ) : sessions.error ? (
            <ErrorBox error={sessions.error} />
          ) : !sessions.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('No open session.')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Started')}</TableHead>
                  <TableHead>{t('Last seen')}</TableHead>
                  <TableHead>{t('Expires')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{fmtDate(s.created_at)}</TableCell>
                    <TableCell>{fmtDate(s.last_seen)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(s.expires_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => closeOne.mutate(s.id)}>
                        {t('Close')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <LinkDialog link={link} name={name} onClose={() => setLink(null)} />
    </div>
  )
}

/** Name and email of an account. */
function PersonForm({ base, name, email, invalidate, editable }: { base: string; name: string; email: string | null; invalidate: string[][]; editable: boolean }) {
  const [v, setV] = useState({ display_name: name, email: email ?? '' })
  useEffect(() => setV({ display_name: name, email: email ?? '' }), [name, email])
  const save = useAction((x: typeof v) => api('PUT', base, x), { ok: t('Saved'), invalidate })
  const dirty = v.display_name !== name || v.email !== (email ?? '')
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Details')}</CardTitle>
        {!editable && <CardDescription>{t('The Tenant Manager of the home tenant changes them.')}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="p-name">{t('Display name')}</Label>
          <Input id="p-name" disabled={!editable} value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="p-email">{t('Email')}</Label>
          <Input id="p-email" type="email" disabled={!editable} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </div>
        {editable && dirty && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setV({ display_name: name, email: email ?? '' })}>
              {t('Cancel')}
            </Button>
            <Button disabled={save.isPending} onClick={() => save.mutate(v)}>
              {t('Save')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── A person, for the Tenant Manager ───────────────────────────────── */

export function PersonPage({ slug, id, tab }: { slug: string; id: string; tab?: string }) {
  const qc = useQueryClient()
  const mbase = `/api/t/${enc(slug)}/manage/members`
  const base = `${mbase}/${enc(id)}`
  const q = useApi<MemberDetail>(['member', slug, id], base)
  const profiles = useApi<Profile[]>(['profiles', slug], `/api/t/${enc(slug)}/manage/profiles`)
  const members = useApi<Member[]>(['members', slug], mbase)
  const [removing, setRemoving] = useState<Member | null>(null)
  const inval = [['member', slug, id], ['members', slug], ['profiles', slug]]
  const setRole = useAction((role: string) => api('PUT', `${base}/role`, { role }), { ok: t('Role updated'), invalidate: inval })
  const setProfile = useAction((p: string) => api('PUT', `${base}/profile`, { profile: p === DEFAULT ? null : p }), { ok: t('Profile updated'), invalidate: inval })
  const suspend = useAction((suspended: boolean) => api('PUT', `${base}/status`, { suspended }), { ok: (s) => (s ? t('Suspended in the tenant') : t('Active again')), invalidate: inval })
  const remove = useAction((newOwner?: string) => api('DELETE', `${base}${newOwner ? `?new_owner=${newOwner}` : ''}`), {
    ok: t('Person removed from the tenant'),
    invalidate: [['members', slug]],
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  const m = d.member
  const name = m.display_name || m.username
  const cur = ['profile', 'sign-in', 'permissions', 'activity'].includes(tab ?? '') ? tab! : 'profile'
  const suspended = m.membership === 'suspended'
  return (
    <>
      <PageHeader
        title={name}
        crumbs={[{ label: t('Tenant management') }, { label: t('Manage'), href: to.tenant(slug, 'manage', 'people') }]}
        sub={`${m.username}@${m.home_tenant}${m.is_guest ? ` · ${t('guest')}` : ''}`}
        badge={
          <>
            <Badge variant={m.role === 'tenant_manager' ? 'default' : 'secondary'} className="font-normal">
              {roleLabel(m.role)}
            </Badge>
            {memberStatus(m) !== 'active' && <StatusBadge status={memberStatus(m)} />}
          </>
        }
        more={
          <>
            <DropdownMenuItem onSelect={() => suspend.mutate(!suspended)}>
              {suspended ? <ShieldCheck /> : <ShieldOff />}
              {suspended ? t('Reactivate in the tenant') : t('Suspend in the tenant')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(m)}>
              <Trash2 />
              {t('Remove from the tenant')}
            </DropdownMenuItem>
          </>
        }
      />
      <Tabs
        tabs={[
          { id: 'profile', label: t('Profile') },
          { id: 'sign-in', label: t('Sign-in') },
          { id: 'permissions', label: t('Permissions') },
          { id: 'activity', label: t('Activity') },
        ]}
        current={cur}
        href={(x) => to.person(slug, id, x)}
      />
      <div className="p-6 max-[620px]:p-4">
        {cur === 'profile' && (
          <div className="grid max-w-3xl gap-6">
            <PersonForm base={`${base}/person`} name={m.display_name} email={m.email} invalidate={inval} editable={d.home_here} />
            <Card>
              <CardHeader>
                <CardTitle>{t('Role, profile and groups')}</CardTitle>
                <CardDescription>{t('The permission profile is where the permissions in the plugins start; groups and personal grants add to it.')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="p-role">{t('Role')}</Label>
                  <Select value={m.role} onValueChange={(v) => setRole.mutate(v)}>
                    <SelectTrigger id="p-role" className="w-72 max-w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">{t('User')}</SelectItem>
                      <SelectItem value="tenant_manager">Tenant Manager</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="p-profile">{t('Permission profile')}</Label>
                  <Select value={m.profile_id ?? DEFAULT} onValueChange={(v) => setProfile.mutate(v)}>
                    <SelectTrigger id="p-profile" className="w-72 max-w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {profileOptions(profiles.data ?? []).map(([v, l]) => (
                        <SelectItem key={v} value={v}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {m.role === 'tenant_manager' && <p className="text-xs text-muted-foreground">{t('A Tenant Manager has every permission, whatever the profile.')}</p>}
                </div>
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">{t('Groups')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {m.groups.length === 0 && <span className="text-sm text-muted-foreground">{t('In no group.')}</span>}
                    {m.groups.map((g) => (
                      <Badge key={g} variant="secondary" className="font-normal">
                        {g}
                      </Badge>
                    ))}
                  </div>
                </div>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{t('In the tenant since')}</dt>
                  <dd>{fmtDate(m.joined_at)}</dd>
                  <dt className="text-muted-foreground">{t('Last sign-in')}</dt>
                  <dd>{m.last_sign_in_at ? fmtDate(m.last_sign_in_at) : t('Never')}</dd>
                  <dt className="text-muted-foreground">{t('Items')}</dt>
                  <dd className="tabular-nums">{m.owned_resources}</dd>
                </dl>
              </CardContent>
            </Card>
          </div>
        )}
        {cur === 'sign-in' &&
          (d.home_here ? (
            <SignInPanel base={base} qk={['member', slug, id]} name={name} />
          ) : (
            <Card className="max-w-3xl">
              <CardHeader>
                <CardTitle>{t('Sign-in')}</CardTitle>
                <CardDescription>{t('{name} signs in from the home tenant {tenant}: its Tenant Manager handles password and sessions.', { name, tenant: m.home_tenant })}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        {cur === 'permissions' && <PermissionsSummary slug={slug} detail={d} />}
        {cur === 'activity' && <ActivityLog scope={{ api: `/api/t/${enc(slug)}/manage/log`, slug }} fixed={{ user: id }} more={to.tenant(slug, 'log')} />}
      </div>
      <RemoveDialog
        member={removing}
        members={members.data ?? []}
        busy={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={(newOwner) =>
          remove.mutate(newOwner, {
            onSuccess: () => {
              setRemoving(null)
              void qc.invalidateQueries({ queryKey: ['members', slug] })
              go(to.tenant(slug, 'manage', 'people'))
            },
          })
        }
      />
    </>
  )
}

function sourceLabel(s: { kind: string; name: string }): string {
  if (s.kind === 'manager') return 'Tenant Manager'
  if (s.kind === 'profile') return t('Profile {name}', { name: s.name })
  if (s.kind === 'group') return t('Group {name}', { name: s.name })
  return t('Personal')
}

/** What a member may do in every plugin, and where it comes from (read only). */
function PermissionsSummary({ slug, detail }: { slug: string; detail: MemberDetail }) {
  return (
    <div className="grid max-w-4xl gap-6">
      {detail.permissions.length === 0 && <Empty icon={<Puzzle />} title={t('No active plugins')} />}
      {detail.permissions.map((p) => (
        <Card key={p.plugin_id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AppIcon id={p.plugin_id} className="size-5" />
              {p.label}
            </CardTitle>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => go(to.tenant(slug, 'plugins', p.plugin_id))}>
                {t('Change in the permissions of the plugin')}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2" aria-label={t('Permissions in {plugin}', { plugin: p.label })}>
              {p.perms.map((x) => (
                <li key={x.key} data-granted={x.granted} className="flex flex-wrap items-center gap-2 text-sm">
                  {x.granted ? <Check className="size-4 text-emerald-700 dark:text-emerald-400" aria-label={t('Yes')} /> : <Minus className="size-4 text-muted-foreground" aria-label={t('No')} />}
                  <span className={x.granted ? '' : 'text-muted-foreground'}>{permLabel(x)}</span>
                  {x.sources.map((s, i) => (
                    <Badge key={i} variant="secondary" className="font-normal">
                      {sourceLabel(s)}
                    </Badge>
                  ))}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      <WhyCard slug={slug} userId={detail.member.user_id} />
    </div>
  )
}

const STEP: Record<string, string> = {
  account_active: 'The account is active',
  member_active: 'The membership is active',
  plugin_use: 'May use the app of the item',
  owner: 'Owns the item',
  shared: 'The item is shared with them or with a group of theirs',
}

/** «Why can't they see an item?»: the steps of the check, for an item of the tenant. */
function WhyCard({ slug, userId }: { slug: string; userId: string }) {
  const [rid, setRid] = useState('')
  const [res, setRes] = useState<WhyNot | null>(null)
  const [busy, setBusy] = useState(false)
  async function check(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      setRes(await api<WhyNot>('GET', `/api/t/${enc(slug)}/manage/members/${enc(userId)}/why?resource=${enc(rid.trim())}`))
    } catch (err) {
      setRes(null)
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Why can't they see an item?")}</CardTitle>
        <CardDescription>{t('The identifier of the item is in its address, or in Shares.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={(e) => void check(e)} className="flex flex-wrap gap-2">
          <Input aria-label={t('Identifier of the item')} placeholder={t('Identifier of the item')} className="w-96 max-w-full font-mono text-xs" value={rid} onChange={(e) => setRid(e.target.value)} required />
          <Button type="submit" variant="outline" disabled={busy}>
            {t('Check')}
          </Button>
        </form>
        {res && (
          <div className="grid gap-2 text-sm" role="status">
            <p>
              <b>{res.title || t('An item')}</b> · {t('Access')}: <b>{levelLabel(res.level)}</b>
            </p>
            <ul className="grid gap-1.5">
              {res.steps.map((s) => (
                <li key={s.code} className="flex items-center gap-2">
                  {s.ok ? <Check className="size-4 text-emerald-700 dark:text-emerald-400" aria-label={t('Yes')} /> : <Minus className="size-4 text-destructive" aria-label={t('No')} />}
                  {t(STEP[s.code] ?? s.code)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function levelLabel(l: string): string {
  return { none: t('none'), read: t('Can view'), write: t('Can edit'), manage: t('Can manage') }[l] ?? l
}

/* ── A group ─────────────────────────────────────────────────────────── */

export function GroupPage({ slug, id, tab }: { slug: string; id: string; tab?: string }) {
  const base = `/api/t/${enc(slug)}/manage/groups`
  const q = useApi<GroupDetail>(['group', slug, id], `${base}/${enc(id)}`)
  const members = useApi<Member[]>(['members', slug], `/api/t/${enc(slug)}/manage/members`)
  const ctx = useTenantCtx(slug)
  const confirm = useConfirm()
  const inval = [['group', slug, id], ['groups', slug], ['members', slug]]
  const add = useAction((u: string) => api('PUT', `${base}/${enc(id)}/members/${u}`), { ok: t('Added to the group'), invalidate: inval })
  const rm = useAction((u: string) => api('DELETE', `${base}/${enc(id)}/members/${u}`), { invalidate: inval })
  const del = useAction(() => api('DELETE', `${base}/${enc(id)}`), { ok: t('Group deleted'), invalidate: [['groups', slug]] })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const g = q.data!
  const cur = ['members', 'shared', 'plugins', 'activity'].includes(tab ?? '') ? tab! : 'members'
  const others = (members.data ?? []).filter((m) => !g.members.some((x) => x.user_id === m.user_id))
  const label = (pid: string) => ctx.data?.plugins.find((p) => p.id === pid)?.label ?? pid
  const idp = g.source === 'idp'
  return (
    <>
      <PageHeader
        title={g.name}
        crumbs={[{ label: t('Tenant management') }, { label: t('Manage'), href: to.tenant(slug, 'manage', 'groups') }]}
        sub={t('{count} members', { count: g.members.length })}
        badge={idp ? <IdpBadge /> : undefined}
        actions={
          cur === 'members' &&
          !idp && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={!others.length}>
                  <UserPlus />
                  {t('Add a member')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 overflow-auto">
                {others.map((m) => (
                  <DropdownMenuItem key={m.user_id} onSelect={() => add.mutate(m.user_id)}>
                    {m.display_name || m.username}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
        more={
          idp ? undefined : (
            <DropdownMenuItem
              variant="destructive"
              onSelect={async () => {
                if (await confirm(t('Delete the group {name}? The shares with the group are revoked.', { name: g.name }), true)) del.mutate(undefined, { onSuccess: () => go(to.tenant(slug, 'manage', 'groups')) })
              }}
            >
              <Trash2 />
              {t('Delete the group')}
            </DropdownMenuItem>
          )
        }
      />
      <Tabs
        tabs={[
          { id: 'members', label: t('Members'), count: g.members.length },
          { id: 'shared', label: t('Shared items'), count: g.shared.length },
          { id: 'plugins', label: t('Plugins') },
          { id: 'activity', label: t('Activity') },
        ]}
        current={cur}
        href={(x) => to.group(slug, id, x)}
      />
      <div className="p-6 max-[620px]:p-4">
        {cur === 'members' &&
          (g.members.length === 0 ? (
            <Empty icon={<Users />} title={t('No members.')} />
          ) : (
            <div className="max-w-3xl overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Name')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.members.map((m) => (
                    <TableRow key={m.user_id}>
                      <TableCell>
                        <a className="font-medium hover:underline" href={to.person(slug, m.user_id)}>
                          {m.display_name || m.username}
                        </a>
                        <span className="ml-2 text-xs text-muted-foreground">{m.username}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        {!idp && (
                          <Button variant="ghost" size="sm" aria-label={t('Remove {username} from the group', { username: m.username })} onClick={() => rm.mutate(m.user_id)}>
                            {t('Remove')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        {cur === 'shared' &&
          (g.shared.length === 0 ? (
            <Empty title={t('Nothing shared with the group')} />
          ) : (
            <div className="max-w-3xl overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Item')}</TableHead>
                    <TableHead>{t('App')}</TableHead>
                    <TableHead>{t('Access')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.shared.map((s) => (
                    <TableRow key={s.resource_id}>
                      <TableCell>{s.title || <span className="text-muted-foreground">{t('Title not visible')}</span>}</TableCell>
                      <TableCell>{label(s.plugin_id)}</TableCell>
                      <TableCell>{levelLabel(s.level)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        {cur === 'plugins' && (
          <div className="grid max-w-3xl gap-3">
            <p className="text-sm text-muted-foreground">{t('What the group adds to the profile of its members, plugin by plugin. It is changed in the permissions of each plugin.')}</p>
            {g.plugins.length === 0 && <Empty icon={<Puzzle />} title={t('The group adds no permission')} />}
            {g.plugins.map(([pid, keys]) => (
              <Card key={pid}>
                <CardHeader>
                  <CardTitle className="text-base">{label(pid)}</CardTitle>
                  <CardAction>
                    <Button variant="outline" size="sm" onClick={() => go(to.tenant(slug, 'plugins', pid))}>
                      {t('Change in the permissions of the plugin')}
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  {keys.map((k) => (
                    <Badge key={k} variant="secondary" className="font-normal">
                      {keyLabel(k)}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {cur === 'activity' && <ActivityLog scope={{ api: `/api/t/${enc(slug)}/manage/log`, slug }} fixed={{ group: id }} more={to.tenant(slug, 'log')} />}
      </div>
    </>
  )
}

/* ── Permission profiles ─────────────────────────────────────────────── */

export function ProfilesSection({ slug }: { slug: string }) {
  const base = `/api/t/${enc(slug)}/manage/profiles`
  const q = useApi<Profile[]>(['profiles', slug], base)
  const ctx = useTenantCtx(slug)
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Profile | null>(null)
  const inval = [['profiles', slug], ['members', slug]]
  const copy = useAction((p: Profile) => api('POST', base, { name: t('Copy of {name}', { name: p.name }), description: p.description, copy_of: p.id }), { ok: t('Profile duplicated'), invalidate: inval })
  const makeDefault = useAction((p: Profile) => api('PUT', `${base}/${p.id}`, { make_default: true }), { ok: t('Default profile changed'), invalidate: inval })
  const del = useAction((p: Profile) => api('DELETE', `${base}/${p.id}`), { ok: t('Profile deleted'), invalidate: inval })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const label = (pid: string) => ctx.data?.plugins.find((p) => p.id === pid)?.label ?? pid
  return (
    <div className="grid gap-3">
      <p className="max-w-3xl text-sm text-muted-foreground">
        {t('A profile is where the permissions of a User in the plugins start; groups and personal grants add to it. The default profile goes to the members without one and to the new invitations. Tenant Managers have every permission.')}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {q.data!.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {p.name}
                {p.is_default && <Badge>{t('Default')}</Badge>}
              </CardTitle>
              <CardDescription>
                {p.description || '—'} · {t('{count} people', { count: p.members })}
              </CardDescription>
              <CardAction>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t('Actions for {name}', { name: p.name })}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(p)}>
                      <KeyRound />
                      {t('Edit the permissions')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => copy.mutate(p)}>
                      <Copy />
                      {t('Duplicate')}
                    </DropdownMenuItem>
                    {!p.is_default && (
                      <DropdownMenuItem onSelect={() => makeDefault.mutate(p)}>
                        <Check />
                        {t('Use for new invitations')}
                      </DropdownMenuItem>
                    )}
                    {!p.is_default && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={async () => (await confirm(t('Delete the profile {name}? Its members get the default profile.', { name: p.name }), true)) && del.mutate(p)}
                        >
                          <Trash2 />
                          {t('Delete')}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-1.5 text-sm">
              {Object.entries(p.perms).map(([pid, keys]) => (
                <div key={pid} className="flex flex-wrap items-baseline gap-x-2">
                  <b className="font-medium">{label(pid)}</b>
                  <span className="text-muted-foreground">{keys.length ? keys.map(keyLabel).join(' · ') : t('no access')}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
      <ProfileEditor slug={slug} profile={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

/** The permissions of a profile, plugin by plugin. */
function ProfileEditor({ slug, profile, onClose }: { slug: string; profile: Profile | null; onClose: () => void }) {
  const [perms, setPerms] = useState<Record<string, string[]>>({})
  useEffect(() => setPerms(profile?.perms ?? {}), [profile])
  const save = useAction((x: Record<string, string[]>) => api('PUT', `/api/t/${enc(slug)}/manage/profiles/${profile!.id}`, { plugins: x }), {
    ok: t('Profile saved'),
    invalidate: [['profiles', slug], ['access', slug], ['member', slug]],
  })
  return (
    <Dialog open={!!profile} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Permissions of the profile {name}', { name: profile?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('What the members with this profile may do in each plugin.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {Object.keys(perms).map((pid) => (
            <PluginPermsChooser key={pid} slug={slug} plugin={pid} value={perms[pid]} onChange={(keys) => setPerms({ ...perms, [pid]: keys })} />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(perms, { onSuccess: onClose })}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PluginPermsChooser({ slug, plugin, value, onChange }: { slug: string; plugin: string; value: string[]; onChange: (v: string[]) => void }) {
  const q = useApi<PluginAccess>(['access', slug, plugin], `/api/t/${enc(slug)}/manage/plugins/${enc(plugin)}/access`)
  if (!q.data) return null
  return (
    <fieldset className="grid gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{q.data.label}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {q.data.permissions.map((p) => (
          <label key={p.key} className="flex items-center gap-2 text-sm">
            <Checkbox checked={value.includes(p.key)} onCheckedChange={(v) => onChange(v ? [...value, p.key] : value.filter((x) => x !== p.key))} />
            {permLabel(p)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/* ── Access and permissions of a plugin ──────────────────────────────── */

type Rows = Record<string, string[]>

export function PluginAccessPage({ slug, plugin }: { slug: string; plugin: string }) {
  const base = `/api/t/${enc(slug)}/manage`
  const q = useApi<PluginAccess>(['access', slug, plugin], `${base}/plugins/${enc(plugin)}/access`)
  const groups = useApi<Group[]>(['groups', slug], `${base}/groups`)
  const members = useApi<Member[]>(['members', slug], `${base}/members`)
  const qc = useQueryClient()
  // profiles by id and grants by `type:id`, with the changes not saved yet
  const [profiles, setProfiles] = useState<Rows | null>(null)
  const [grants, setGrants] = useState<Rows | null>(null)
  const [busy, setBusy] = useState(false)
  const saved = useMemo(() => {
    const d = q.data
    return {
      profiles: Object.fromEntries((d?.profiles ?? []).map((p) => [p.id, p.perms[plugin] ?? []])) as Rows,
      grants: Object.fromEntries((d?.grants ?? []).map((g) => [`${g.principal_type}:${g.principal_id}`, g.perms])) as Rows,
    }
  }, [q.data, plugin])
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  const P = profiles ?? saved.profiles
  const G = grants ?? saved.grants
  const dirty = JSON.stringify(P) !== JSON.stringify(saved.profiles) || JSON.stringify(G) !== JSON.stringify(saved.grants)
  const names: Record<string, string> = {
    ...Object.fromEntries((groups.data ?? []).map((g) => [`group:${g.id}`, t('Group {name}', { name: g.name })])),
    ...Object.fromEntries((members.data ?? []).map((m) => [`user:${m.user_id}`, m.display_name || m.username])),
    ...Object.fromEntries(d.grants.map((g) => [`${g.principal_type}:${g.principal_id}`, g.principal_type === 'group' ? t('Group {name}', { name: g.name }) : g.name])),
  }
  const candidates = [
    ...(groups.data ?? []).map((g) => [`group:${g.id}`, t('Group {name}', { name: g.name })]),
    ...(members.data ?? []).filter((m) => m.role !== 'tenant_manager').map((m) => [`user:${m.user_id}`, m.display_name || m.username]),
  ].filter(([k]) => !(k in G))
  const toggle = (rows: Rows, set: (r: Rows) => void, key: string, perm: string, on: boolean) => set({ ...rows, [key]: on ? [...(rows[key] ?? []), perm] : (rows[key] ?? []).filter((x) => x !== perm) })
  async function save() {
    setBusy(true)
    try {
      for (const [id, keys] of Object.entries(P)) if (JSON.stringify(keys) !== JSON.stringify(saved.profiles[id])) await api('PUT', `${base}/profiles/${id}`, { plugins: { [plugin]: keys } })
      const all = new Set([...Object.keys(G), ...Object.keys(saved.grants)])
      for (const k of all) {
        const keys = G[k] ?? []
        if (JSON.stringify(keys) === JSON.stringify(saved.grants[k] ?? [])) continue
        const [type, id] = k.split(':')
        await api('PUT', `${base}/plugins/${enc(plugin)}/grants`, { principal_type: type, principal_id: id, perms: keys })
      }
      toast.success(t('Permissions saved'))
      setProfiles(null)
      setGrants(null)
      await qc.invalidateQueries({ queryKey: ['access', slug] })
      void qc.invalidateQueries({ queryKey: ['profiles', slug] })
      void qc.invalidateQueries({ queryKey: ['member', slug] })
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const head = (
    <TableHeader>
      <TableRow>
        <TableHead>{t('Who')}</TableHead>
        {d.permissions.map((p) => (
          <TableHead key={p.key} className="text-center">
            {permLabel(p)}
          </TableHead>
        ))}
        <TableHead />
      </TableRow>
    </TableHeader>
  )
  return (
    <>
      <PageHeader title={t('Access and permissions · {plugin}', { plugin: d.label })} crumbs={[{ label: t('Tenant management') }, { label: t('Plugins'), href: to.tenant(slug, 'plugins') }]} sub={t('Tenant Managers have every permission.')} />
      <div className="grid gap-6 p-6 max-[620px]:p-4">
        <Card className="max-w-4xl">
          <CardHeader>
            <CardTitle>{t('What each permission means')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
              {d.permissions.map((p) => (
                <div key={p.key} className="contents">
                  <dt className="font-medium">
                    {permLabel(p)}
                    {!p.standard && (
                      <Badge variant="secondary" className="ml-2 font-normal">
                        {t('of the plugin')}
                      </Badge>
                    )}
                  </dt>
                  <dd className="text-muted-foreground">{permDescription(p) || '—'}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <section className="grid max-w-5xl gap-2" aria-label={t('Profiles')}>
          <h2 className="text-sm font-semibold">{t('Profiles')}</h2>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              {head}
              <TableBody>
                {d.profiles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {t('Profile {name}', { name: p.name })}
                      {p.is_default && <span className="ml-1 text-xs text-muted-foreground">({t('default')})</span>}
                    </TableCell>
                    {d.permissions.map((x) => (
                      <TableCell key={x.key} className="text-center">
                        <Checkbox aria-label={`${p.name}: ${permLabel(x)}`} checked={(P[p.id] ?? []).includes(x.key)} onCheckedChange={(v) => toggle(P, setProfiles, p.id, x.key, !!v)} />
                      </TableCell>
                    ))}
                    <TableCell />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
        <section className="grid max-w-5xl gap-2" aria-label={t('Groups and people')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t('Groups and people')}</h2>
              <p className="text-xs text-muted-foreground">{t('They add to the profile, never take away.')}</p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!candidates.length}>
                  <Plus />
                  {t('Add a group or person')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 overflow-auto">
                {candidates.map(([k, n]) => (
                  <DropdownMenuItem key={k} onSelect={() => setGrants({ ...G, [k]: [] })}>
                    {n}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {Object.keys(G).length === 0 ? (
            <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{t('No group or person has more than their profile.')}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                {head}
                <TableBody>
                  {Object.keys(G).map((k) => (
                    <TableRow key={k}>
                      <TableCell className="font-medium">{names[k] ?? k}</TableCell>
                      {d.permissions.map((x) => (
                        <TableCell key={x.key} className="text-center">
                          <Checkbox aria-label={`${names[k] ?? k}: ${permLabel(x)}`} checked={(G[k] ?? []).includes(x.key)} onCheckedChange={(v) => toggle(G, setGrants, k, x.key, !!v)} />
                        </TableCell>
                      ))}
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('Remove {name}', { name: names[k] ?? k })}
                          onClick={() => {
                            const n = { ...G }
                            delete n[k]
                            setGrants(n)
                          }}
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
        </section>
        <SaveBar
          dirty={dirty}
          busy={busy}
          onSave={() => void save()}
          onCancel={() => {
            setProfiles(null)
            setGrants(null)
          }}
        />
      </div>
    </>
  )
}

/* ── Access requests ─────────────────────────────────────────────────── */

export function RequestsTable({ slug, manager }: { slug: string; manager: boolean }) {
  const q = useApi<AccessRequest[]>(['requests', slug], `/api/t/${enc(slug)}/requests`)
  const ctx = useTenantCtx(slug)
  const decide = useAction(({ id, action }: { id: string; action: string }) => api('POST', `/api/t/${enc(slug)}/requests/${id}/${action}`), {
    ok: ({ action }) => ({ approve: t('Access given'), refuse: t('Request refused'), forward: t('Forwarded to the owner') })[action] ?? t('Done'),
    invalidate: [['requests', slug]],
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const rows = q.data ?? []
  if (!rows.length) return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{t('No access request.')}</p>
  const label = (pid: string) => ctx.data?.plugins.find((p) => p.id === pid)?.label ?? pid
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table aria-label={t('Access requests')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Item')}</TableHead>
            <TableHead>{t('Asked by')}</TableHead>
            <TableHead>{t('Access')}</TableHead>
            <TableHead>{t('Message')}</TableHead>
            <TableHead>{t('Status')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <div className="font-medium">{r.title || t('An item of {owner}', { owner: r.owner_name })}</div>
                <div className="text-xs text-muted-foreground">
                  {label(r.plugin_id)} · {t('owner {name}', { name: r.owner_name })}
                </div>
              </TableCell>
              <TableCell>
                {r.requester_name}
                <div className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</div>
              </TableCell>
              <TableCell>{r.level === 'write' ? t('Edit') : t('See')}</TableCell>
              <TableCell className="max-w-64 text-sm text-muted-foreground">{r.message || '—'}</TableCell>
              <TableCell>{r.status === 'forwarded' ? <Badge variant="secondary">{t('Forwarded to the owner')}</Badge> : <StatusBadge status={r.status} />}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  {(r.mine || manager) && (
                    <>
                      <Button size="sm" onClick={() => decide.mutate({ id: r.id, action: 'approve' })}>
                        {t('Approve')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, action: 'refuse' })}>
                        {t('Refuse')}
                      </Button>
                    </>
                  )}
                  {manager && !r.mine && r.status === 'pending' && (
                    <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, action: 'forward' })}>
                      {t('Forward to the owner')}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Access requests on the items of the person (the address of the notifications). */
export function RequestsPage({ slug }: { slug: string }) {
  const ctx = useTenantCtx(slug)
  const manager = ctx.data?.tenant.role === 'tenant_manager'
  return (
    <>
      <PageHeader title={t('Access requests')} sub={manager ? t('Every open request of the tenant') : t('Requests to see or edit your items')} />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <RequestsTable slug={slug} manager={!!manager} />
      </div>
    </>
  )
}

/** An item: open it in its app, or ask to see it. */
export function ItemPage({ slug, id }: { slug: string; id: string }) {
  const meta = useQuery({
    queryKey: ['item', slug, id],
    queryFn: () => api<{ plugin_id: string }>('GET', `/api/t/${enc(slug)}/resources/${enc(id)}`),
    retry: false,
  })
  const [level, setLevel] = useState('read')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const ask = useAction(() => api('POST', `/api/t/${enc(slug)}/resources/${enc(id)}/request`, { level, message }), { ok: t('Request sent') })
  useEffect(() => {
    if (meta.data) go(to.plugin(slug, meta.data.plugin_id, id))
  }, [meta.data, slug, id])
  if (meta.isLoading || meta.data) return <Loading />
  const missing = meta.error instanceof ApiError && meta.error.status === 404
  if (!missing) return <ErrorBox error={meta.error} />
  return (
    <>
      <PageHeader title={t('You cannot see this item')} />
      <div className="p-6 max-[620px]:p-4">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>{t('Ask for access')}</CardTitle>
            <CardDescription>{t('The owner of the item, or a Tenant Manager, decides. You get a notification with the answer.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <p role="status" className="text-sm">
                {t('Request sent: you will get a notification with the answer.')}
              </p>
            ) : (
              <form
                className="grid gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  ask.mutate(undefined, { onSuccess: () => setSent(true) })
                }}
              >
                <div className="grid gap-1.5">
                  <Label htmlFor="rq-level">{t('Access')}</Label>
                  <Select value={level} onValueChange={setLevel}>
                    <SelectTrigger id="rq-level" className="w-60">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read">{t('See')}</SelectItem>
                      <SelectItem value="write">{t('Edit')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rq-msg">{t('Message (optional)')}</Label>
                  <Textarea id="rq-msg" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
                </div>
                <div>
                  <Button type="submit" disabled={ask.isPending}>
                    {t('Send the request')}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

/* ── Every person, for the Administrator ────────────────────────────── */

function TenantProfiles({ tenant, value, onChange, id }: { tenant: string; value: string; onChange: (v: string) => void; id?: string }) {
  const q = useApi<Profile[]>(['t-profiles', tenant], tenant ? `/api/admin/tenants/${enc(tenant)}/profiles` : null)
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full" aria-label={id ? undefined : t('Permission profile')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {profileOptions(q.data ?? []).map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A person in a tenant: tenant, role and profile (new person, add to a tenant). */
function MembershipFields({ tenants, value, onChange, prefix }: { tenants: TenantInfo[]; value: { tenant: string; role: string; profile: string }; onChange: (v: { tenant: string; role: string; profile: string }) => void; prefix: string }) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${prefix}-tenant`}>{t('Tenant')}</Label>
        <Select value={value.tenant} onValueChange={(x) => onChange({ ...value, tenant: x, profile: DEFAULT })}>
          <SelectTrigger id={`${prefix}-tenant`} className="w-full">
            <SelectValue placeholder={t('Choose the tenant…')} />
          </SelectTrigger>
          <SelectContent>
            {tenants.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${prefix}-role`}>{t('Role')}</Label>
          <Select value={value.role} onValueChange={(x) => onChange({ ...value, role: x })}>
            <SelectTrigger id={`${prefix}-role`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">{t('User')}</SelectItem>
              <SelectItem value="tenant_manager">Tenant Manager</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${prefix}-profile`}>{t('Permission profile')}</Label>
          <TenantProfiles id={`${prefix}-profile`} tenant={value.tenant} value={value.profile} onChange={(x) => onChange({ ...value, profile: x })} />
        </div>
      </div>
    </>
  )
}

const membershipBody = (v: { tenant: string; role: string; profile: string }) => ({ tenant: v.tenant, role: v.role, profile: v.profile === DEFAULT ? null : v.profile })

function NewPersonDialog({ open, onClose, tenants, onCreated }: { open: boolean; onClose: () => void; tenants: TenantInfo[]; onCreated: (p: PersonRow, link: ResetLink | null) => void }) {
  const blank = { username: '', display_name: '', email: '', password: '', m: { tenant: '', role: 'user', profile: DEFAULT } }
  const [v, setV] = useState(blank)
  useEffect(() => {
    if (open) setV(blank)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const create = useAction(
    () =>
      api<{ person: PersonRow; reset_link: ResetLink | null }>('POST', '/api/admin/people', {
        username: v.username,
        display_name: v.display_name,
        email: v.email || null,
        password: v.password || null,
        home_tenant: v.m.tenant,
        role: v.m.role,
        profile: v.m.profile === DEFAULT ? null : v.m.profile,
      }),
    { ok: t('Person created'), invalidate: [['people']] },
  )
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(undefined, {
              onSuccess: (r) => {
                const x = r as { person: PersonRow; reset_link: ResetLink | null }
                onCreated(x.person, x.reset_link)
              },
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('New person')}</DialogTitle>
            <DialogDescription>{t('A local account with its home tenant, where it signs in.')}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="np-user">{t('Username')}</Label>
              <Input id="np-user" required value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-name">{t('Display name')}</Label>
              <Input id="np-name" value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="np-email">{t('Email')}</Label>
            <Input id="np-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
          </div>
          <MembershipFields prefix="np" tenants={tenants} value={v.m} onChange={(m) => setV({ ...v, m })} />
          <div className="grid gap-1.5">
            <Label htmlFor="np-pw">{t('Initial password (optional)')}</Label>
            <Input id="np-pw" type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
            <p className="text-xs text-muted-foreground">{t('Empty: you get a link the person uses to choose it.')}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !v.m.tenant}>
              {t('Create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddToTenantDialog({ open, onClose, tenants, onSubmit, title }: { open: boolean; onClose: () => void; tenants: TenantInfo[]; onSubmit: (v: { tenant: string; role: string; profile: string }) => Promise<unknown>; title: string }) {
  const [v, setV] = useState({ tenant: '', role: 'user', profile: DEFAULT })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setV({ tenant: '', role: 'user', profile: DEFAULT })
  }, [open])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('At once, without an invitation.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <MembershipFields prefix="at" tenants={tenants} value={v} onChange={setV} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={busy || !v.tenant}
            onClick={async () => {
              setBusy(true)
              try {
                await onSubmit(v)
                onClose()
              } catch {
                /* the message is shown by the caller */
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('Add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdminPeople() {
  const q = useApi<PersonRow[]>(['people'], '/api/admin/people')
  const tenants = useApi<TenantInfo[]>(['tenants'], '/api/admin/tenants')
  const [show, setShow] = useState('all')
  const [tenant, setTenant] = useState('any')
  const [role, setRole] = useState('any')
  const [status, setStatus] = useState('any')
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [dlg, setDlg] = useState<null | 'new' | 'add'>(null)
  const [links, setLinks] = useState<{ name: string; link: ResetLink }[]>([])
  const inval = [['people']]
  const status_ = useAction(({ ids, active }: { ids: string[]; active: boolean }) => Promise.all(ids.map((id) => api('PUT', `/api/admin/people/${id}/status`, { active }))), {
    ok: ({ active }) => (active ? t('Reactivated') : t('Disabled')),
    invalidate: inval,
  })
  const clients = (tenants.data ?? []).filter((x) => !x.is_system)
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter(
      (p) =>
        (show === 'all' || (show === 'several' && p.tenants.length > 1) || (show === 'admins' && p.is_admin)) &&
        (tenant === 'any' || p.tenants.some((x) => x.tenant_id === tenant)) &&
        (role === 'any' || p.tenants.some((x) => x.role === role)) &&
        (status === 'any' || p.status === status) &&
        (!s || `${p.username} ${p.display_name} ${p.home_tenant} ${p.email ?? ''}`.toLowerCase().includes(s)),
    )
  }, [q.data, show, tenant, role, status, search])
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const all = q.data ?? []
  const ids = [...sel].filter((id) => rows.some((r) => r.user_id === id && !r.is_admin))
  const nameOf = (id: string) => {
    const p = all.find((x) => x.user_id === id)
    return p ? p.display_name || p.username : id
  }
  async function sendLinks() {
    const out: { name: string; link: ResetLink }[] = []
    for (const id of ids) {
      try {
        out.push({ name: nameOf(id), link: await api<ResetLink>('POST', `/api/admin/people/${id}/reset-link`) })
      } catch (e) {
        toast.error(`${nameOf(id)}: ${errText(e)}`)
      }
    }
    setLinks(out)
  }
  return (
    <>
      <PageHeader
        title={t('People')}
        sub={t('{count} people', { count: all.length })}
        actions={
          <Button onClick={() => setDlg('new')}>
            <Plus />
            {t('New person')}
          </Button>
        }
      />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <Pills
          value={show}
          onChange={setShow}
          items={[
            { id: 'all', label: t('All'), count: all.length },
            { id: 'several', label: t('In several tenants'), count: all.filter((p) => p.tenants.length > 1).length },
            { id: 'admins', label: t('Administrators'), count: all.filter((p) => p.is_admin).length },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input type="search" placeholder={t('Search by name or username')} aria-label={t('Search by name or username')} className="w-64 max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={tenant} onValueChange={setTenant}>
            <SelectTrigger className="w-48" aria-label={t('Tenant')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{t('Every tenant')}</SelectItem>
              {clients.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-44" aria-label={t('Role')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{t('Every role')}</SelectItem>
              <SelectItem value="tenant_manager">Tenant Manager</SelectItem>
              <SelectItem value="user">{t('User')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" aria-label={t('Status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{t('Every status')}</SelectItem>
              <SelectItem value="active">{t('Active')}</SelectItem>
              <SelectItem value="disabled">{t('Disabled')}</SelectItem>
            </SelectContent>
          </Select>
          {ids.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/10 py-1 pr-1 pl-3" role="group" aria-label={t('Actions on the selection')}>
              <span className="text-sm font-medium tabular-nums">{t('{count} selected', { count: ids.length })}</span>
              <Button variant="outline" size="sm" onClick={() => status_.mutate({ ids, active: false })}>
                {t('Disable')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => status_.mutate({ ids, active: true })}>
                {t('Reactivate')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDlg('add')}>
                {t('Add to a tenant')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void sendLinks()}>
                {t('Send the password link')}
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
                    checked={rows.length > 0 && ids.length === rows.filter((r) => !r.is_admin).length ? true : ids.length ? 'indeterminate' : false}
                    onCheckedChange={(v) => setSel(v ? new Set(rows.filter((r) => !r.is_admin).map((r) => r.user_id)) : new Set())}
                  />
                </TableHead>
                <TableHead>{t('Name')}</TableHead>
                <TableHead>{t('Home tenant')}</TableHead>
                <TableHead>{t('Tenants')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
                <TableHead>{t('Last sign-in')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.user_id} data-state={sel.has(p.user_id) ? 'selected' : undefined}>
                  <TableCell>
                    {!p.is_admin && (
                      <Checkbox
                        aria-label={t('Select {name}', { name: p.username })}
                        checked={sel.has(p.user_id)}
                        onCheckedChange={(v) => {
                          const n = new Set(sel)
                          if (v) n.add(p.user_id)
                          else n.delete(p.user_id)
                          setSel(n)
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <a className="flex items-center gap-2.5" href={p.is_admin ? to.admin('system', 'admins') : to.adminPerson(p.user_id)}>
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary-strong">{initials(p.display_name || p.username)}</span>
                      <span>
                        <span className="block font-medium hover:underline">{p.display_name || p.username}</span>
                        <span className="block text-xs text-muted-foreground">{p.username}</span>
                      </span>
                    </a>
                  </TableCell>
                  <TableCell>{p.is_admin ? <Badge>{t('Administrator')}</Badge> : p.home_tenant}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {p.tenants.map((x) => (
                        <Badge key={x.tenant_id} variant={x.is_home ? 'default' : 'secondary'} className="font-normal" title={roleLabel(x.role)}>
                          {x.slug}
                          {x.role === 'tenant_manager' ? ' · TM' : ''}
                          {x.status === 'suspended' ? ` · ${t('suspended')}` : ''}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.last_sign_in_at ? fmtDate(p.last_sign_in_at) : t('Never')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('No person found.')}</p>}
        </div>
      </div>
      <NewPersonDialog
        open={dlg === 'new'}
        onClose={() => setDlg(null)}
        tenants={clients}
        onCreated={(p, link) => {
          setDlg(null)
          if (link) setLinks([{ name: p.display_name || p.username, link }])
        }}
      />
      <AddToTenantDialog
        open={dlg === 'add'}
        title={t('Add to a tenant')}
        onClose={() => setDlg(null)}
        tenants={clients}
        onSubmit={async (v) => {
          for (const id of ids) {
            try {
              await api('POST', `/api/admin/people/${id}/tenants`, membershipBody(v))
            } catch (e) {
              toast.error(`${nameOf(id)}: ${errText(e)}`)
            }
          }
          toast.success(t('Added to the tenant'))
          void q.refetch()
        }}
      />
      <LinksDialog links={links} onClose={() => setLinks([])} />
    </>
  )
}

function LinksDialog({ links, onClose }: { links: { name: string; link: ResetLink }[]; onClose: () => void }) {
  if (links.length === 1) return <LinkDialog link={links[0].link} name={links[0].name} onClose={onClose} />
  return (
    <Dialog open={links.length > 1} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Links to choose a new password')}</DialogTitle>
          <DialogDescription>{t('Each link works once. Give each person theirs.')}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 text-sm">
          {links.map((l) => (
            <li key={l.link.url} className="grid gap-1">
              <b>{l.name}</b>
              <Input readOnly value={l.link.url} aria-label={t('Link of {name}', { name: l.name })} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(links.map((l) => `${l.name}: ${l.link.url}`).join('\n'))
              toast.success(t('Links copied'))
            }}
          >
            <Copy />
            {t('Copy all')}
          </Button>
          <Button onClick={onClose}>{t('Done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdminPersonPage({ id, tab }: { id: string; tab?: string }) {
  const base = `/api/admin/people/${enc(id)}`
  const q = useApi<PersonRow>(['person', id], base)
  const tenants = useApi<TenantInfo[]>(['tenants'], '/api/admin/tenants')
  const confirm = useConfirm()
  const [dlg, setDlg] = useState<null | 'add' | 'home'>(null)
  const [home, setHome] = useState('')
  const inval = [['person', id], ['people']]
  const setStatus = useAction((active: boolean) => api('PUT', `${base}/status`, { active }), { ok: (a) => (a ? t('Reactivated') : t('Disabled')), invalidate: inval })
  const update = useAction(({ tenant, body }: { tenant: string; body: Record<string, unknown> }) => api('PUT', `${base}/tenants/${tenant}`, body), { ok: t('Saved'), invalidate: inval })
  const remove = useAction((tenant: string) => api('DELETE', `${base}/tenants/${tenant}`), { ok: t('Removed from the tenant'), invalidate: inval })
  const add = useAction((v: { tenant: string; role: string; profile: string }) => api('POST', `${base}/tenants`, membershipBody(v)), { ok: t('Added to the tenant'), invalidate: inval })
  const move = useAction((tenant: string) => api('POST', `${base}/home`, { tenant }), { ok: t('Home tenant moved'), invalidate: inval })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const p = q.data!
  const name = p.display_name || p.username
  const cur = ['profile', 'tenants', 'sign-in', 'activity'].includes(tab ?? '') ? tab! : 'profile'
  const clients = (tenants.data ?? []).filter((x) => !x.is_system)
  return (
    <>
      <PageHeader
        title={name}
        crumbs={[{ label: t('People'), href: to.admin('people') }]}
        sub={`${p.username}@${p.home_tenant}`}
        badge={<StatusBadge status={p.status} />}
        more={
          <DropdownMenuItem onSelect={() => setStatus.mutate(p.status !== 'active')}>
            {p.status === 'active' ? <ShieldOff /> : <ShieldCheck />}
            {p.status === 'active' ? t('Disable the account') : t('Reactivate the account')}
          </DropdownMenuItem>
        }
      />
      <Tabs
        tabs={[
          { id: 'profile', label: t('Profile') },
          { id: 'tenants', label: t('Tenants'), count: p.tenants.length },
          { id: 'sign-in', label: t('Sign-in') },
          { id: 'activity', label: t('Activity') },
        ]}
        current={cur}
        href={(x) => to.adminPerson(id, x)}
      />
      <div className="p-6 max-[620px]:p-4">
        {cur === 'profile' && (
          <div className="grid max-w-3xl gap-6">
            <PersonForm base={base} name={p.display_name} email={p.email} invalidate={inval} editable />
            <Card>
              <CardContent className="pt-6">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{t('Home tenant')}</dt>
                  <dd>{p.home_tenant}</dd>
                  <dt className="text-muted-foreground">{t('Created')}</dt>
                  <dd>{fmtDate(p.created_at)}</dd>
                  <dt className="text-muted-foreground">{t('Last sign-in')}</dt>
                  <dd>{p.last_sign_in_at ? fmtDate(p.last_sign_in_at) : t('Never')}</dd>
                </dl>
              </CardContent>
            </Card>
          </div>
        )}
        {cur === 'tenants' && (
          <div className="grid max-w-5xl gap-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDlg('add')}>
                <Plus />
                {t('Add to a tenant')}
              </Button>
              <Button variant="outline" disabled={p.tenants.length < 2} onClick={() => setDlg('home')}>
                {t('Move the home tenant')}
              </Button>
            </div>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Tenant')}</TableHead>
                    <TableHead>{t('Role')}</TableHead>
                    <TableHead>{t('Permission profile')}</TableHead>
                    <TableHead>{t('Status')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.tenants.map((m) => (
                    <TableRow key={m.tenant_id}>
                      <TableCell className="font-medium">
                        {m.name}
                        {m.is_home && (
                          <Badge variant="secondary" className="ml-2 font-normal">
                            {t('home')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select value={m.role} onValueChange={(role) => update.mutate({ tenant: m.tenant_id, body: { role } })}>
                          <SelectTrigger className="w-44" aria-label={t('Role in {tenant}', { tenant: m.name })}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">{t('User')}</SelectItem>
                            <SelectItem value="tenant_manager">Tenant Manager</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="min-w-52">
                        <TenantProfiles tenant={m.tenant_id} value={m.profile_id ?? DEFAULT} onChange={(v) => update.mutate({ tenant: m.tenant_id, body: { profile: v === DEFAULT ? null : v } })} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={m.status} />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={t('Actions in {tenant}', { tenant: m.name })}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => update.mutate({ tenant: m.tenant_id, body: { suspended: m.status !== 'suspended' } })}>
                              {m.status === 'suspended' ? <ShieldCheck /> : <ShieldOff />}
                              {m.status === 'suspended' ? t('Reactivate in the tenant') : t('Suspend in the tenant')}
                            </DropdownMenuItem>
                            {!m.is_home && (
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={async () => (await confirm(t('Remove {name} from {tenant}?', { name, tenant: m.name }), true)) && remove.mutate(m.tenant_id)}
                              >
                                <Trash2 />
                                {t('Remove from the tenant')}
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
          </div>
        )}
        {cur === 'sign-in' && <SignInPanel base={base} qk={['person', id]} name={name} />}
        {cur === 'activity' && <ActivityLog scope={{ api: '/api/admin/log', admin: true }} fixed={{ user: id }} more={to.admin('log')} />}
      </div>
      <AddToTenantDialog open={dlg === 'add'} title={t('Add to a tenant')} onClose={() => setDlg(null)} tenants={clients.filter((x) => !p.tenants.some((m) => m.tenant_id === x.id))} onSubmit={(v) => add.mutateAsync(v)} />
      <Dialog open={dlg === 'home'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Move the home tenant')}</DialogTitle>
            <DialogDescription>{t('The person signs in from the new home tenant; the old one stays as a tenant where they are a guest. Their sessions close.')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="mh-tenant">{t('New home tenant')}</Label>
            <Select value={home} onValueChange={setHome}>
              <SelectTrigger id="mh-tenant" className="w-full">
                <SelectValue placeholder={t('Choose the tenant…')} />
              </SelectTrigger>
              <SelectContent>
                {p.tenants
                  .filter((m) => !m.is_home)
                  .map((m) => (
                    <SelectItem key={m.tenant_id} value={m.tenant_id}>
                      {m.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>
              {t('Cancel')}
            </Button>
            <Button disabled={!home || move.isPending} onClick={() => move.mutate(home, { onSuccess: () => setDlg(null) })}>
              {t('Move')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ── Page of the link to choose a new password (public) ─────────────── */

export function ResetPage({ token }: { token: string }) {
  const brand = useBrand()
  const info = useApi<{ username: string; tenant: string; min_length: number }>(['reset', token], `/api/auth/reset/${enc(token)}`)
  const [pw, setPw] = useState({ a: '', b: '' })
  const [done, setDone] = useState(false)
  const set = useAction(() => api('POST', '/api/auth/reset', { token, password: pw.a }), {})
  const min = info.data?.min_length ?? 10
  const mismatch = pw.b !== '' && pw.a !== pw.b
  let body: ReactNode
  if (info.isLoading) body = <Loading />
  else if (info.error) body = <p role="alert" className="text-sm text-destructive">{errText(info.error)}</p>
  else if (done)
    body = (
      <div className="grid gap-4">
        <p role="status">{t('Done: sign in with the new password.')}</p>
        <Button asChild>
          <a href="#/">{t('Sign in')}</a>
        </Button>
      </div>
    )
  else
    body = (
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!mismatch) set.mutate(undefined, { onSuccess: () => setDone(true) })
        }}
      >
        <p className="text-sm text-muted-foreground">{t('Account {username} of {tenant}.', { username: info.data!.username, tenant: info.data!.tenant })}</p>
        <div className="grid gap-1.5">
          <Label htmlFor="rs-a">{t('New password')}</Label>
          <Input id="rs-a" type="password" autoComplete="new-password" minLength={min} required value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} aria-describedby="rs-rule" />
          <p id="rs-rule" className="text-xs text-muted-foreground">
            {t('At least {n} characters', { n: min })}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rs-b">{t('Repeat the new password')}</Label>
          <Input id="rs-b" type="password" autoComplete="new-password" required value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} aria-invalid={mismatch} />
          {mismatch && <p className="text-xs text-destructive">{t('The two passwords differ')}</p>}
        </div>
        <Button type="submit" disabled={set.isPending}>
          {t('Save the new password')}
        </Button>
      </form>
    )
  return (
    <main className="flex min-h-full items-center justify-center bg-background p-6">
      <div className="grid w-full max-w-sm gap-6">
        <div className="flex items-center gap-3">
          <AppMark className="size-9" />
          <b className="text-lg">{brand.name}</b>
        </div>
        <h1 className="text-2xl font-semibold">{t('Choose a new password')}</h1>
        {body}
      </div>
    </main>
  )
}
