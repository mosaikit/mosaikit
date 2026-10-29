// Account: the personal page, the same for every role (docs/refactoring-ui.md §2). Sections: Profile,
// Sign-in and security, Notifications, Appearance and language and, for whoever works in a tenant, My
// tenants and Usage. It is reached from the menu of the person.

import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Building2, Gauge, KeyRound, KeySquare, Loader2, Palette, Trash2, Upload, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { api, errText, fmtBytes } from '../../api.ts'
import type { AdminUser, Overview, Session } from '../../types.ts'
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
import { isApp, passwordMin, useAction, useApi, useTenantCtx } from '../core.ts'
import { setLang, t, useLang, useLanguages, type Lang } from '../i18n.ts'
import { Empty, ErrorBox, FormDialog, Loading, Locked, PageHeader, SaveBar, Sections, type Section, Sliced } from '../kit.tsx'
import { go, personal, to, type Route } from '../router.ts'
import { SIDEBAR_PREF } from '../prefs.ts'
import { TenantBadge } from '../Shell.tsx'
import { KeysPanel } from '../SettingsPanels.tsx'
import { TenantLeft } from '../Quotas.tsx'
import { totals, trashHint } from '../usage.ts'
import { kindLabel, type NoteKind } from '../notes.ts'
import { setTheme, useTheme, type Mode } from '../theme.ts'
import { useSetContrast } from '../personal.ts'
import { PersonPicture } from '../picture.tsx'

const enc = encodeURIComponent

export function AccountPage({ session, route }: { session: Session; route: Route }) {
  const admin = session.user.is_system_admin
  const section = route.area === 'login' || route.area === 'reset' ? undefined : route.section
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
  const qc = useQueryClient()
  const u = session.user
  const name = u.display_name || u.username
  const home = session.memberships.find((m) => m.is_home)
  // with an identity provider the name comes from the provider at every sign-in
  const fromProvider = !!session.external
  const [draft, setDraft] = useState(u.display_name)
  const [busy, setBusy] = useState(false)
  const dirty = draft.trim() !== u.display_name && draft.trim() !== ''
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['session'] })
      toast.success(ok)
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Picture')}</CardTitle>
          <CardDescription>{t('SVG, PNG or WebP, at most 512 KB. The people of your tenants see it.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <PersonPicture id={u.user_id} name={name} version={session.picture ?? null} />
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" disabled={busy}>
              <label>
                <Upload />
                {session.picture ? t('Change the picture') : t('Add a picture')}
                <input
                  type="file"
                  accept="image/svg+xml,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void run(() => api('PUT', '/api/me/picture', undefined, { raw: f }), t('Picture saved'))
                  }}
                />
              </label>
            </Button>
            {session.picture && (
              <Button variant="outline" disabled={busy} onClick={() => void run(() => api('DELETE', '/api/me/picture'), t('Picture removed'))}>
                <Trash2 />
                {t('Remove the picture')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Details')}</CardTitle>
          <CardDescription>
            {fromProvider
              ? t('Your name comes from the identity provider of your tenant. The email is changed by the Tenant Manager.')
              : u.is_system_admin
                ? t('You change your name and your email (the email needs your password and, if on, the second factor). Another Administrator can change them too.')
                : t('You change your name; the email is changed by the Tenant Manager of your home tenant.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form
            className="grid gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (dirty) void run(() => api('PUT', '/api/me/profile', { display_name: draft.trim() }), t('Name saved'))
            }}
          >
            <Label htmlFor="me-name">{t('Display name')}</Label>
            <div className="flex flex-wrap gap-2">
              <Input id="me-name" className="w-72 max-w-full" maxLength={120} disabled={fromProvider || busy} value={draft} onChange={(e) => setDraft(e.target.value)} />
              {!fromProvider && (
                <Button type="submit" disabled={!dirty || busy}>
                  {t('Save')}
                </Button>
              )}
            </div>
          </form>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('Username')}</dt>
            <dd className="font-mono">{u.username}</dd>
            {u.is_system_admin && <AdminEmail me={u.user_id} />}
            <dt className="text-muted-foreground">{u.is_system_admin ? t('Role') : t('Home tenant')}</dt>
            <dd>{u.is_system_admin ? t('Administrator of the platform') : (home?.name ?? u.home_tenant_slug)}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}

/** The Administrator changes their own email: current password and, if the second factor is on, a code. */
function AdminEmail({ me }: { me: string }) {
  const q = useApi<AdminUser[]>(['admins'], '/api/admin/administrators')
  const [open, setOpen] = useState(false)
  const self = q.data?.find((a) => a.user_id === me)
  const save = useAction((v: Record<string, string>) => api('PUT', '/api/me/email', { email: v.email, password: v.password, code: v.code || undefined }), {
    ok: t('Email saved'),
    invalidate: [['admins']],
  })
  return (
    <>
      <dt className="text-muted-foreground">{t('Email')}</dt>
      <dd className="flex flex-wrap items-center gap-2">
        <span id="me-email">{self?.email || <span className="text-destructive">{t('No email address')}</span>}</span>
        <Button variant="outline" size="sm" disabled={!self} onClick={() => setOpen(true)}>
          {self?.email ? t('Change email') : t('Add the email')}
        </Button>
      </dd>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('Your email address')}
        description={self?.totp ? t('Confirm with your current password and a code of the authenticator app.') : t('Confirm with your current password.')}
        fields={[
          { name: 'email', label: t('Email'), type: 'email', required: true, initial: self?.email ?? '' },
          { name: 'password', label: t('Current password'), type: 'password', required: true },
          ...(self?.totp ? [{ name: 'code', label: t('Code of the authenticator app'), required: true, hint: t('6 digits') }] : []),
        ]}
        submit={t('Save')}
        onSubmit={(v) => save.mutateAsync(v)}
      />
    </>
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
    <div className="grid gap-6">
      {!session.external && (
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
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('How you sign in')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {admin ? (
            <Locked label={t('Administrator access')} value={t('Local password and second factor (authenticator app)')} hint={t('To register the app again, ask another Administrator to reset the second factor.')} />
          ) : session.external ? (
            <Locked label={t('Sign-in method')} value={t('Identity provider of the tenant (OIDC)')} hint={t('Password and second factor are managed by the provider, not by Mosaikit.')} />
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
    <div className="grid w-full gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('What I receive')}</CardTitle>
          <CardDescription>{t('In the app every notification arrives in the bell; by email only what you choose.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="np-address">{t('Email address')}</Label>
              <Input id="np-address" type="email" autoComplete="email" placeholder="name@example.org" value={d.address} onChange={(e) => setV({ ...d, address: e.target.value })} />
              {!d.address.trim() && <span className="text-xs text-muted-foreground">{t('Without an address nothing arrives by email.')}</span>}
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="np-mode">{t('Emails')}</Label>
              <Select value={d.mode} onValueChange={(m) => setV({ ...d, mode: m })}>
                <SelectTrigger id="np-mode" className="w-full min-w-0">
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
  const setContrast = useSetContrast()
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
    <div className="grid gap-6">
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
        <CardContent>
          <label className="flex items-center justify-between gap-4 border-t pt-4">
            <span>
              <b className="block text-sm">{t('High contrast')}</b>
              <span className="text-xs text-muted-foreground">{t('Sharper colours, for whoever reads with effort. With every theme, on every device you use.')}</span>
            </span>
            <Switch checked={th.contrast} onCheckedChange={(v) => void setContrast(v)} aria-label={t('High contrast')} />
          </label>
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
  const apps = (ctx.data?.plugins ?? []).filter(isApp)
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
    <div className="grid gap-3">
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
                <TableCell>{m.role === 'tenant_manager' ? t('Tenant Manager') : t('User')}</TableCell>
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

/** One's own usage in the active tenant and what is left of the quotas of the tenant (there are no
 *  quotas per person). */
function MyUsage({ slug }: { slug: string }) {
  const q = useApi<Overview>(['overview', slug], `/api/t/${enc(slug)}/overview`)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const res = q.data!.me.resources
  const all = totals(res)
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        <div className="rounded-xl border bg-card p-4">
          <span className="text-xs text-muted-foreground">{t('Space you use')}</span>
          <b className="block text-2xl font-semibold tabular-nums">{fmtBytes(all.bytes)}</b>
          {all.trashBytes > 0 && <span className="text-xs text-muted-foreground">{trashHint(all.trashBytes, 'bytes')}</span>}
        </div>
        <div className="rounded-xl border bg-card p-4">
          <span className="text-xs text-muted-foreground">{t('Your items')}</span>
          <b className="block text-2xl font-semibold tabular-nums">{all.count}</b>
          {all.trashCount > 0 && <span className="text-xs text-muted-foreground">{trashHint(all.trashCount, 'items')}</span>}
        </div>
      </div>
      {res.length === 0 ? (
        <Empty icon={<Gauge />} title={t('No usage')} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Sliced items={res}>{(shown) => (<Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Apps')}</TableHead>
                <TableHead>{t('Kind')}</TableHead>
                <TableHead className="text-right">{t('Items')}</TableHead>
                <TableHead className="text-right">{t('Space')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.plugin_id + r.kind}>
                  <TableCell className="font-medium">{r.plugin}</TableCell>
                  <TableCell className="text-muted-foreground">{r.kind}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBytes(r.bytes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>)}</Sliced>
        </div>
      )}
      <TenantLeft slug={slug} />
    </div>
  )
}
