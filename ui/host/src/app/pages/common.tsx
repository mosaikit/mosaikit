// Account: la pagina personale, uguale per tutti i ruoli (docs/refactoring-ui.md §2). Sezioni: Profilo,
// Accesso e sicurezza, Notifiche, Aspetto e lingua e, per chi lavora in un tenant, I miei tenant e
// Consumi. Ci si arriva dal menu della persona.

import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Building2, Gauge, KeyRound, Loader2, Palette, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { api, errText, fmtBytes } from '../../api.ts'
import type { Overview, Session } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { initials, useApi, useTenantCtx } from '../core.ts'
import { LANGS, setLang, t, useLang, type Lang } from '../i18n.ts'
import { Empty, ErrorBox, Loading, Locked, PageHeader, Sections, type Section } from '../kit.tsx'
import { go, personal, to, type Route } from '../router.ts'
import { SIDEBAR_PREF } from '../prefs.ts'
import { TenantBadge } from '../Shell.tsx'
import { setTheme, useTheme, type Mode } from '../theme.ts'

const enc = encodeURIComponent

export function AccountPage({ session, route }: { session: Session; route: Route }) {
  const admin = session.user.is_system_admin
  const section = route.area === 'login' ? undefined : route.section
  const sections: Section[] = [
    { id: 'profile', label: t('Profilo'), icon: <UserRound /> },
    { id: 'security', label: t('Accesso e sicurezza'), icon: <KeyRound /> },
    { id: 'notifications', label: t('Notifiche'), icon: <Bell /> },
    { id: 'appearance', label: t('Aspetto e lingua'), icon: <Palette /> },
    ...(admin
      ? []
      : [
          { id: 'tenants', label: t('I miei tenant'), icon: <Building2 />, count: session.memberships.length },
          { id: 'usage', label: t('Consumi'), icon: <Gauge /> },
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
        {cur === 'notifications' && <NotificationPrefs admin={admin} />}
        {cur === 'appearance' && <Appearance route={route} />}
        {cur === 'tenants' && <MyTenants session={session} />}
        {cur === 'usage' && route.area === 'tenant' && <MyUsage slug={route.tenant} />}
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
          <CardTitle>{t('Dati')}</CardTitle>
          <CardDescription>{u.is_system_admin ? t('Li cambia un altro Administrator.') : t('Li cambia il Tenant Manager del tuo tenant di appartenenza.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('Nome')}</dt>
            <dd>{u.display_name || '—'}</dd>
            <dt className="text-muted-foreground">{t('Username')}</dt>
            <dd className="font-mono">{u.username}</dd>
            <dt className="text-muted-foreground">{u.is_system_admin ? t('Ruolo') : t('Tenant di appartenenza')}</dt>
            <dd>{u.is_system_admin ? t('Administrator della piattaforma') : (home?.name ?? u.home_tenant_slug)}</dd>
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
    if (pw.new !== pw.again) return void toast.error(t('Le due password non coincidono'))
    setBusy(true)
    try {
      await api('POST', '/api/me/password', { old: pw.old, new: pw.new })
      toast.success(t('Password aggiornata: le altre sessioni sono state chiuse'))
      setPw({ old: '', new: '', again: '' })
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  const short = pw.new.length > 0 && pw.new.length < 10
  const differ = pw.again.length > 0 && pw.again !== pw.new
  return (
    <div className="grid max-w-2xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Cambia password')}</CardTitle>
          <CardDescription>{admin ? t('La password locale della piattaforma.') : t('La password del tuo tenant di appartenenza: vale anche nei tenant in cui sei ospite.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={(e) => void save(e)}>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-old">{t('Password attuale')}</Label>
              <Input id="pw-old" type="password" autoComplete="current-password" required value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-new">{t('Nuova password')}</Label>
              <Input id="pw-new" type="password" autoComplete="new-password" minLength={10} required aria-describedby="pw-rule" value={pw.new} onChange={(e) => setPw({ ...pw, new: e.target.value })} />
              {/* la regola accanto al campo, non dopo l'invio */}
              <p id="pw-rule" className={cn('text-xs', short ? 'text-destructive' : 'text-muted-foreground')}>
                {t('Almeno 10 caratteri, non tutti uguali.')}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-again">{t('Ripeti la nuova password')}</Label>
              <Input id="pw-again" type="password" autoComplete="new-password" minLength={10} required aria-invalid={differ} value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
              {differ && <p className="text-xs text-destructive">{t('Le due password non coincidono')}</p>}
            </div>
            <Button type="submit" disabled={busy || short || differ} className="justify-self-start">
              {busy && <Loader2 className="animate-spin" />}
              {t('Aggiorna password')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Come accedi')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {admin ? (
            <Locked label={t('Accesso amministratori')} value={t('Password locale e secondo fattore (app di autenticazione)')} hint={t('Per registrare di nuovo l’app, chiedi a un altro Administrator di reimpostare il secondo fattore.')} />
          ) : (
            <Locked label={t('Modo di autenticazione')} value={t('Account locale del tenant')} hint={t('Se il tenant passa a un provider di identità (OIDC), accedi da lì.')} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function NotificationPrefs({ admin }: { admin: boolean }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t('Cosa ricevo')}</CardTitle>
        <CardDescription>{t('Le notifiche arrivano nella campanella in alto. L’invio per email arriverà con il server di posta della piattaforma.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1">
        {(admin
          ? [[t('Avvisi della piattaforma'), t('Aggiornamenti dei plugin, errori dei servizi')]]
          : [
              [t('Inviti in altri tenant'), t('Un Tenant Manager ti invita come ospite')],
              [t('Menzioni e scadenze delle app'), t('Quando le app le pubblicano')],
            ]
        ).map(([l, d]) => (
          <div key={l} className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
            <span>
              <b className="block text-sm">{l}</b>
              <span className="text-xs text-muted-foreground">{d}</span>
            </span>
            <span className="flex items-center gap-4 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                {t('Nell’app')}
                <Switch checked disabled aria-label={t('{what}: nell’app', { what: l })} />
              </label>
              <label className="flex items-center gap-2">
                {t('Email')}
                <Switch checked={false} disabled aria-label={t('{what}: per email', { what: l })} />
              </label>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function Appearance({ route }: { route: Route }) {
  const th = useTheme()
  const lang = useLang()
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
          <CardTitle>{t('Tonalità')}</CardTitle>
          <CardDescription>{t('Vale solo per te, subito. Il tema lo sceglie chi gestisce il tenant.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(
            [
              ['light', t('Chiaro')],
              ['dark', t('Scuro')],
              ['auto', t('Automatico (come il sistema)')],
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
          <CardTitle>{t('Lingua')}</CardTitle>
          <CardDescription>{t('La lingua dell’interfaccia e delle app.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
            <SelectTrigger className="w-60" aria-label={t('Lingua')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGS.map((l) => (
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
              <b className="block text-sm">{t('Aperta all’avvio')}</b>
              <span className="text-xs text-muted-foreground">{t('Altrimenti solo le icone, con il nome sotto')}</span>
            </span>
            <Switch
              checked={side}
              onCheckedChange={(v) => {
                setSide(v)
                try {
                  localStorage.setItem(SIDEBAR_PREF, v ? '1' : '0')
                } catch {
                  /* storage non disponibile */
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

/** Le app che compaiono nella sidebar (preferenza della persona nel tenant). */
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
      <b className="text-sm">{t('App nella sidebar')}</b>
      <span className="mb-1 text-xs text-muted-foreground">{t('Quelle spente restano nella Home e nella ricerca.')}</span>
      {apps.map((p) => (
        <label key={p.id} className="flex items-center justify-between gap-4 py-1.5 text-sm">
          {p.label}
          <Switch checked={!hidden.has(p.id)} onCheckedChange={(v) => void toggle(p.id, v)} aria-label={t('{app} nella sidebar', { app: p.label })} />
        </label>
      ))}
    </div>
  )
}

function MyTenants({ session }: { session: Session }) {
  return (
    <div className="grid max-w-3xl gap-3">
      <p className="text-sm text-muted-foreground">{t('Accedi sempre dal tenant di appartenenza; in quelli in cui sei ospite entri dal selettore in alto.')}</p>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Tenant')}</TableHead>
              <TableHead>{t('Come')}</TableHead>
              <TableHead>{t('Ruolo')}</TableHead>
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
                    {m.is_home ? t('appartenenza') : t('ospite')}
                  </Badge>
                </TableCell>
                <TableCell>{m.role === 'tenant_manager' ? 'Tenant Manager' : 'User'}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => go(to.tenant(m.slug))}>
                    {t('Apri')}
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

/** I propri consumi nel tenant attivo. Le quote per tenant non sono ancora nel kernel: quando ci
 *  saranno, qui si vedra' anche quanto resta. */
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
          <span className="text-xs text-muted-foreground">{t('Spazio usato da te')}</span>
          <b className="block text-2xl font-semibold tabular-nums">{fmtBytes(bytes)}</b>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <span className="text-xs text-muted-foreground">{t('Elementi tuoi')}</span>
          <b className="block text-2xl font-semibold tabular-nums">{res.reduce((s, r) => s + r.count, 0)}</b>
        </div>
      </div>
      {res.length === 0 ? (
        <Empty icon={<Gauge />} title={t('Nessun consumo')} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('App')}</TableHead>
                <TableHead>{t('Tipo')}</TableHead>
                <TableHead className="text-right">{t('Elementi')}</TableHead>
                <TableHead className="text-right">{t('Spazio')}</TableHead>
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
      <p className="text-xs text-muted-foreground">{t('Le quote del tenant le decide l’Administrator: quando ci saranno, qui vedrai anche quanto resta.')}</p>
    </div>
  )
}
