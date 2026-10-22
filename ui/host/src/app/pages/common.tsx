// Account: the personal page, the same for every role (docs/refactoring-ui.md §2). Sections: Profile,
// Sign-in and security, Notifications, Appearance and language and, for whoever works in a tenant, My
// tenants and Usage. It is reached from the menu of the person.

import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Building2, Gauge, KeyRound, KeySquare, Loader2, Palette, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { api, errText, fmtBytes } from '../../api.ts'
import type { Overview, Session } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { initials, passwordMin, useAction, useApi, useTenantCtx } from '../core.ts'
import { setLang, t, useLang, useLanguages, type Lang } from '../i18n.ts'
import { Empty, ErrorBox, Loading, Locked, PageHeader, SaveBar, Sections, type Section } from '../kit.tsx'
import { go, personal, to, type Route } from '../router.ts'
import { SIDEBAR_PREF } from '../prefs.ts'
import { TenantBadge } from '../Shell.tsx'
import { KeysPanel } from '../SettingsPanels.tsx'
import { kindLabel, type NoteKind } from '../notes.ts'
import { setTheme, useTheme, type Mode } from '../theme.ts'

const enc = encodeURIComponent

export function AccountPage({ session, route }: { session: Session; route: Route }) {
  const admin = session.user.is_system_admin
  const section = route.area === 'login' ? undefined : route.section
  const sections: Section[] = [
    { id: 'profile', label: t('Profile'), icon: <UserRound /> },
    { id: 'security', label: t('Sign-in and security'), icon: <KeyRound /> },
    { id: 'notifications', label: t('Notifications'), icon: <Bell /> },
    { id: 'appearance', label: t('Appearance and language'), icon: <Palette /> },
    ...(admin
      ? []
      : [
          { id: 'tenants', label: t('My tenants'), icon: <Building2 />, count: session.memberships.length },
          { id: 'usage', label: t('Usage'), icon: <Gauge /> },
          ...(route.area === 'tenant' ? [{ id: 'keys', label: t('Keys'), icon: <KeySquare /> }] : []),
        ]),
  ]
  const cur = sections.some((s) => s.id === section) ? section! : 'profile'
  const name = session.user.display_name || session.user.username
  return (
    <>
      <PageHeader title={t('Account')} sub={name} />
      <Sections sections={sections} current={cur} href={(id) => personal(route, 'account', id)}>
        {cur === 'profile' && <Profile session={session} />}
        {cur === 'security' && <Security session={session} />}
        {cur === 'notifications' && <NotificationPrefs />}
        {cur === 'appearance' && <Appearance route={route} />}
        {cur === 'tenants' && <MyTenants session={session} />}
        {cur === 'usage' && route.area === 'tenant' && <MyUsage slug={route.tenant} />}
        {cur === 'keys' && route.area === 'tenant' && <KeysPanel level={{ kind: 'me', slug: route.tenant }} />}
      </Sections>
    </>
  )
}

function Profile({ session }: { session: Session }) {
  const u = session.user
  const name = u.display_name || u.username
  const home = session.memberships.find((m) => m.is_home)
  return (
    <div className="grid max-w-2xl gap-6">
      <Card>
        <CardContent className="flex items-center gap-4 pt-6">
          <span className="flex size-16 items-center justify-center rounded-full bg-teal-700 text-xl font-semibold text-white">{initials(name)}</span>
          <div>
            <b className="block text-lg">{name}</b>
            <span className="text-sm text-muted-foreground">{u.is_system_admin ? `${u.username} · Administrator` : `${u.username}@${u.home_tenant_slug}`}</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Details')}</CardTitle>
          <CardDescription>{u.is_system_admin ? t('Another Administrator changes them.') : t('The Tenant Manager of your home tenant changes them.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('Name')}</dt>
            <dd>{u.display_name || '—'}</dd>
            <dt className="text-muted-foreground">{t('Username')}</dt>
            <dd className="font-mono">{u.username}</dd>
            <dt className="text-muted-foreground">{u.is_system_admin ? t('Role') : t('Home tenant')}</dt>
            <dd>{u.is_system_admin ? t('Administrator of the platform') : (home?.name ?? u.home_tenant_slug)}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}

function Security({ session }: { session: Session }) {
  const [pw, setPw] = useState({ old: '', new: '', again: '' })
  const [busy, setBusy] = useState(false)
  const admin = session.user.is_system_admin
  async function save(e: FormEvent) {
    e.preventDefault()
    if (pw.new !== pw.again) return void toast.error(t('The two passwords do not match'))
    setBusy(true)
    try {
      await api('POST', '/api/me/password', { old: pw.old, new: pw.new })
      toast.success(t('Password updated: the other sessions were closed'))
      setPw({ old: '', new: '', again: '' })
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  // the rules of the home tenant (the platform's for the Administrator)
  const min = passwordMin(session.config ?? {})
  const short = pw.new.length > 0 && pw.new.length < min
  const differ = pw.again.length > 0 && pw.again !== pw.new
  return (
    <div className="grid max-w-2xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Change password')}</CardTitle>
          <CardDescription>{admin ? t('The local password of the platform.') : t('The password of your home tenant: it also works in the tenants where you are a guest.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={(e) => void save(e)}>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-old">{t('Current password')}</Label>
              <Input id="pw-old" type="password" autoComplete="current-password" required value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-new">{t('New password')}</Label>
              <Input id="pw-new" type="password" autoComplete="new-password" minLength={min} required aria-describedby="pw-rule" value={pw.new} onChange={(e) => setPw({ ...pw, new: e.target.value })} />
              {/* the rule next to the field, not after sending */}
              <p id="pw-rule" className={cn('text-xs', short ? 'text-destructive' : 'text-muted-foreground')}>
                {t('At least {n} characters, not all the same.', { n: min })}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-again">{t('Repeat the new password')}</Label>
              <Input id="pw-again" type="password" autoComplete="new-password" minLength={min} required aria-invalid={differ} value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
              {differ && <p className="text-xs text-destructive">{t('The two passwords do not match')}</p>}
            </div>
            <Button type="submit" disabled={busy || short || differ} className="justify-self-start">
              {busy && <Loader2 className="animate-spin" />}
              {t('Update password')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('How you sign in')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {admin ? (
            <Locked label={t('Administrator access')} value={t('Local password and second factor (authenticator app)')} hint={t('To register the app again, ask another Administrator to reset the second factor.')} />
          ) : (
            <Locked label={t('Sign-in method')} value={t('Local account of the tenant')} hint={t('If the tenant moves to an identity provider (OIDC), you sign in there.')} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface NotePrefs {
  address: string | null
  mode: string
  own_mode: string | null
  default_mode: string
  digest_hour: number
  kinds: { kind: NoteKind; email: boolean }[]
}

interface PrefsDraft {
  address: string
  mode: string
  kinds: Record<string, boolean>
}

function draftOf(p: NotePrefs): PrefsDraft {
  return { address: p.address ?? '', mode: p.own_mode ?? 'default', kinds: Object.fromEntries(p.kinds.map((k) => [k.kind, k.email])) }
}

/** What arrives by email: the address, at once or in a daily digest, and the kinds. In the app everything
 *  arrives in the bell. */
function NotificationPrefs() {
  const q = useApi<NotePrefs>(['note-prefs'], '/api/me/notifications/prefs')
  const [v, setV] = useState<PrefsDraft | null>(null)
  const save = useAction(
    (d: PrefsDraft) => api('PUT', '/api/me/notifications/prefs', { address: d.address.trim() || null, mode: d.mode === 'default' ? null : d.mode, kinds: d.kinds }),
    { ok: t('Preferences saved'), invalidate: [['note-prefs']] },
  )
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const p = q.data!
  const saved = draftOf(p)
  const d = v ?? saved
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(saved)
  const modeName = (m: string) => ({ off: t('Never'), immediate: t('At once'), digest: t('One summary a day, at {h}:00 (UTC)', { h: String(p.digest_hour) }) })[m] ?? m
  return (
    <div className="grid max-w-2xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('What I receive')}</CardTitle>
          <CardDescription>{t('In the app every notification arrives in the bell; by email only what you choose.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="np-address">{t('Email address')}</Label>
              <Input id="np-address" type="email" autoComplete="email" placeholder="name@example.org" value={d.address} onChange={(e) => setV({ ...d, address: e.target.value })} />
              {!d.address.trim() && <span className="text-xs text-muted-foreground">{t('Without an address nothing arrives by email.')}</span>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-mode">{t('Emails')}</Label>
              <Select value={d.mode} onValueChange={(m) => setV({ ...d, mode: m })}>
                <SelectTrigger id="np-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t('Default: {mode}', { mode: modeName(p.default_mode) })}</SelectItem>
                  {['immediate', 'digest', 'off'].map((m) => (
                    <SelectItem key={m} value={m}>
                      {modeName(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Kind')}</TableHead>
                  <TableHead className="w-28 text-center">{t('In the app')}</TableHead>
                  <TableHead className="w-28 text-center">{t('Email')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.kinds.map(({ kind }) => (
                  <TableRow key={kind}>
                    <TableCell className="font-medium">{kindLabel(kind)}</TableCell>
                    <TableCell className="text-center">
                      <Checkbox checked disabled aria-label={t('{what}: in the app', { what: kindLabel(kind) })} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={d.kinds[kind] ?? false}
                        disabled={d.mode === 'off' || (d.mode === 'default' && p.default_mode === 'off')}
                        onCheckedChange={(on) => setV({ ...d, kinds: { ...d.kinds, [kind]: !!on } })}
                        aria-label={t('{what}: by email', { what: kindLabel(kind) })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => save.mutate(d, { onSuccess: () => setV(null) })} onCancel={() => setV(null)} />
    </div>
  )
}

function Appearance({ route }: { route: Route }) {
  const th = useTheme()
  const lang = useLang()
  const langs = useLanguages()
  const [side, setSide] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_PREF) === '1'
    } catch {
      return false
    }
  })
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Mode')}</CardTitle>
          <CardDescription>{t('It applies only to you, at once. The theme is chosen by whoever manages the tenant.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(
            [
              ['light', t('Light')],
              ['dark', t('Dark')],
              ['auto', t('Automatic (like the system)')],
            ] as [Mode, string][]
          ).map(([m, l]) => (
            <Button key={m} variant={th.mode === m ? 'default' : 'outline'} aria-pressed={th.mode === m} onClick={() => setTheme({ mode: m })}>
              {l}
            </Button>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Language')}</CardTitle>
          <CardDescription>{t('The language of the interface and of the apps.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
            <SelectTrigger className="w-60" aria-label={t('Language')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {langs.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Sidebar')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="flex items-center justify-between gap-4">
            <span>
              <b className="block text-sm">{t('Open at start')}</b>
              <span className="text-xs text-muted-foreground">{t('Otherwise only the icons, with the name below')}</span>
            </span>
            <Switch
              checked={side}
              onCheckedChange={(v) => {
                setSide(v)
                try {
                  localStorage.setItem(SIDEBAR_PREF, v ? '1' : '0')
                } catch {
                  /* storage not available */
                }
              }}
            />
          </label>
          {route.area === 'tenant' && <AppsInSidebar slug={route.tenant} />}
        </CardContent>
      </Card>
    </div>
  )
}

/** The apps shown in the sidebar (preference of the person in the tenant). */
function AppsInSidebar({ slug }: { slug: string }) {
  const qc = useQueryClient()
  const ctx = useTenantCtx(slug)
  const apps = (ctx.data?.plugins ?? []).filter((p) => p.has_ui)
  if (!apps.length) return null
  const hidden = new Set(ctx.data?.prefs.hidden ?? [])
  async function toggle(id: string, show: boolean) {
    const next = new Set(hidden)
    if (show) next.delete(id)
    else next.add(id)
    try {
      await api('PUT', `/api/t/${enc(slug)}/prefs`, { ...ctx.data!.prefs, hidden: [...next] })
      await qc.invalidateQueries({ queryKey: ['ctx', slug] })
    } catch (e) {
      toast.error(errText(e))
    }
  }
  return (
    <div className="grid gap-1 border-t pt-4">
      <b className="text-sm">{t('Apps in the sidebar')}</b>
      <span className="mb-1 text-xs text-muted-foreground">{t('The ones turned off stay in Home and in the search.')}</span>
      {apps.map((p) => (
        <label key={p.id} className="flex items-center justify-between gap-4 py-1.5 text-sm">
          {p.label}
          <Switch checked={!hidden.has(p.id)} onCheckedChange={(v) => void toggle(p.id, v)} aria-label={t('{app} in the sidebar', { app: p.label })} />
        </label>
      ))}
    </div>
  )
}

function MyTenants({ session }: { session: Session }) {
  return (
    <div className="grid max-w-3xl gap-3">
      <p className="text-sm text-muted-foreground">{t('You always sign in to your home tenant; you enter the ones where you are a guest from the switcher at the top.')}</p>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Tenant')}</TableHead>
              <TableHead>{t('As')}</TableHead>
              <TableHead>{t('Role')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {session.memberships.map((m) => (
              <TableRow key={m.slug}>
                <TableCell>
                  <span className="flex items-center gap-2.5 font-medium">
                    <TenantBadge name={m.name} />
                    {m.name}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={m.is_home ? 'default' : 'secondary'} className="font-normal">
                    {m.is_home ? t('home') : t('guest')}
                  </Badge>
                </TableCell>
                <TableCell>{m.role === 'tenant_manager' ? 'Tenant Manager' : 'User'}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => go(to.tenant(m.slug))}>
                    {t('Open')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/** One's own usage in the active tenant. Quotas per tenant are not in the kernel yet: when they
 *  are, this will also show how much is left. */
function MyUsage({ slug }: { slug: string }) {
  const q = useApi<Overview>(['overview', slug], `/api/t/${enc(slug)}/overview`)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const res = q.data!.me.resources
  const bytes = res.reduce((s, r) => s + r.bytes, 0)
  return (
    <div className="grid max-w-3xl gap-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        <div className="rounded-xl border bg-card p-4">
          <span className="text-xs text-muted-foreground">{t('Space you use')}</span>
          <b className="block text-2xl font-semibold tabular-nums">{fmtBytes(bytes)}</b>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <span className="text-xs text-muted-foreground">{t('Your items')}</span>
          <b className="block text-2xl font-semibold tabular-nums">{res.reduce((s, r) => s + r.count, 0)}</b>
        </div>
      </div>
      {res.length === 0 ? (
        <Empty icon={<Gauge />} title={t('No usage')} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Apps')}</TableHead>
                <TableHead>{t('Kind')}</TableHead>
                <TableHead className="text-right">{t('Items')}</TableHead>
                <TableHead className="text-right">{t('Space')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {res.map((r) => (
                <TableRow key={r.plugin_id + r.kind}>
                  <TableCell className="font-medium">{r.plugin}</TableCell>
                  <TableCell className="text-muted-foreground">{r.kind}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBytes(r.bytes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('The Administrator decides the quotas of the tenant: once they exist, you will also see here what is left.')}</p>
    </div>
  )
}
