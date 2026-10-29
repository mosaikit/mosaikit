// Sign-in with two doors, as in the mockup. On the left the brand panel (colours of the theme, mosaic of
// tiles, welcome); on the right language, mode and support, the form and the legal notes.
// Users: tenant from a menu (hidden if there is only one, preselected by #/login/<tenant>) and credentials
// of the tenant. Administrators (#/admin): local password, then the TOTP second factor or, at the first
// sign-in, the registration of the app and the recovery codes.
// The page takes the theme, the identity (name, logo, welcome, legal notes) and the languages of the
// platform, and the ones of the tenant as soon as the tenant is known.
// While the server does not answer it says so and tries again, never "no tenant".

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Contrast, Globe, KeyRound, LifeBuoy, Loader2, LogIn, Moon, Sun } from 'lucide-react'
import { api, ApiError, errText, isUnavailable, setCsrf } from '../api.ts'
import { retryDelay, useBrand, useBrandState } from '../brand.ts'
import type { LoginTenant, PendingLogin, Session, TotpSetup } from '../types.ts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { setLanguageContext, setLang, t, useLang, useLanguages, type Lang } from './i18n.ts'
import { go, to } from './router.ts'
import { AppMark } from './Shell.tsx'
import { registerThemes, setDefaultMode, setPreset, setTheme, useTheme, type CustomTheme, type Mode } from './theme.ts'
import { MaintenanceNotice } from './pages/operations.tsx'
import { applyStyle, styleOf, TEAMS, useBandImage } from './layouts.ts'
import { bandStyle } from './nav.tsx'

const LAST = 'msk_last_login_tenant'

/* The test users of the development environment, for the autocomplete of the Username fields (with the
   password). Only with the Vite development server: a build does not have them. */
interface TestUser {
  tenant: string
  username: string
  password: string
  who: string
}
const TEST_USERS: TestUser[] = import.meta.env.DEV
  ? [
      { tenant: 'comune-roma', username: 'e.ricci', password: 'password-prova-1', who: `Elena Ricci · ${t('Tenant Manager')}` },
      { tenant: 'comune-roma', username: 'm.esposito', password: 'password-prova-1', who: `Marco Esposito · ${t('Tenant Manager')}` },
      { tenant: 'comune-roma', username: 'd.conti', password: 'password-prova-1', who: 'Davide Conti · User, guest in Regione Lazio' },
      { tenant: 'comune-roma', username: 's.greco', password: 'password-prova-1', who: 'Sara Greco · User' },
      { tenant: 'comune-roma', username: 'l.bianchi', password: 'password-prova-1', who: 'Luca Bianchi · User' },
      { tenant: 'regione-lazio', username: 'l.verdi', password: 'password-prova-1', who: `Luca Verdi · ${t('Tenant Manager')}` },
    ]
  : []
const TEST_ADMINS: TestUser[] = import.meta.env.DEV ? [{ tenant: '', username: 'admin', password: 'admin-sviluppo', who: 'Administrator' }] : []

/** The suggestions of the Username field: picking one, the caller fills in the password. */
function TestUsers({ id, users }: { id: string; users: TestUser[] }) {
  if (!users.length) return null
  return (
    <datalist id={id}>
      {users.map((u) => (
        <option key={u.tenant + u.username} value={u.username}>
          {u.who}
        </option>
      ))}
    </datalist>
  )
}

function remembered(): string {
  try {
    return localStorage.getItem(LAST) ?? ''
  } catch {
    return ''
  }
}

export default function Login({ door, tenant }: { door: 'tenant' | 'admin'; tenant?: string }) {
  const { brand, status } = useBrandState()
  const qc = useQueryClient()
  useLang() // the texts follow the chosen language
  const admin = door === 'admin'
  // the themes made with the theme editor, before the theme of the platform or of the tenant is applied
  useEffect(() => {
    api<CustomTheme[]>('GET', '/api/auth/themes')
      .then(registerThemes)
      .catch(() => {
        /* older server, or not reachable: the built-in themes */
      })
  }, [])
  // the tenant chosen on the page: its identity and languages, otherwise the platform's
  const [picked, setPicked] = useState<LoginTenant | null>(null)
  const tn = admin ? null : picked
  const langs = JSON.stringify(tn?.languages ?? brand.languages ?? null)
  const language = tn?.language ?? brand.language
  useEffect(() => {
    setLanguageContext({ enabled: (JSON.parse(langs) as string[] | null) ?? undefined, language, locale: brand.locale })
  }, [langs, language, brand.locale])
  useEffect(() => setDefaultMode(brand.mode), [brand.mode])
  // the style of the platform (corners, density, font, tabs, buttons) on the sign-in page too
  const styleKey = JSON.stringify(brand.style ?? {})
  useEffect(() => {
    const raw = JSON.parse(styleKey) as Record<string, string | null>
    const config: Record<string, unknown> = Object.fromEntries(Object.entries(raw).map(([k, v]) => [`style.${k}`, v]))
    applyStyle(styleOf(config, TEAMS), TEAMS)
  }, [styleKey])
  const privacy = tn?.privacy_url || brand.privacy_url
  const legal = tn?.legal_url || brand.legal_url
  const footer = tn?.footer || brand.footer
  const enter = (s: Session) => {
    setCsrf(s.csrf)
    qc.setQueryData(['session'], s)
    if (s.user.is_system_admin) go(to.admin())
    else go(to.tenant(s.memberships.find((m) => m.is_home)?.slug ?? s.user.home_tenant_slug))
  }
  return (
    <div className="grid min-h-full bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <Hero admin={admin} name={tn?.name ?? brand.name} product={brand.name} tagline={tn ? '' : brand.tagline} welcome={tn?.welcome || brand.welcome} version={brand.version} logo={tn && (tn.logo_dark || tn.logo_light) ? `api/auth/tenants/${encodeURIComponent(tn.slug)}/logo/${tn.logo_dark ? 'logo_dark' : 'logo_light'}` : undefined} />
      <section className="flex min-h-full flex-col">
        <div className="flex items-center justify-end gap-1 p-4">
          <LanguageSelect />
          <ModeButton />
          {brand.support_url && (
            <a href={brand.support_url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
              <LifeBuoy className="size-4" />
              {t('Support')}
            </a>
          )}
        </div>
        <main className="flex flex-1 items-center justify-center px-6 pb-8">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <AppMark className="size-9" />
              <b className="text-lg">{brand.name}</b>
            </div>
            <MaintenanceNotice />
            {admin ? (
              status === 'ok' ? (
                <AdminDoor platformTheme={brand.theme} onEnter={enter} />
              ) : (
                <Waiting unavailable={status === 'unavailable'} />
              )
            ) : (
              <TenantDoor initial={tenant ?? remembered()} platformTheme={brand.theme} onEnter={enter} onPick={setPicked} />
            )}
            {brand.login_message && <p className="mt-6 border-l-2 border-primary pl-3 text-sm">{brand.login_message}</p>}
          </div>
        </main>
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t px-6 py-4 text-xs text-muted-foreground">
          {footer && <span className="mr-auto">{footer}</span>}
          <nav className="flex gap-4" aria-label={t('Legal notes')}>
            {(
              [
                ['Accessibility', ''],
                ['Privacy', privacy ?? ''],
                ['Legal notes', legal ?? ''],
              ] as [string, string][]
            ).map(([x, url]) =>
              url ? (
                <a key={x} href={url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-foreground hover:underline">
                  {t(x)}
                </a>
              ) : (
                <a key={x} href="#/" onClick={(e) => e.preventDefault()} className="underline-offset-4 hover:text-foreground hover:underline">
                  {t(x)}
                </a>
              ),
            )}
          </nav>
        </footer>
      </section>
    </div>
  )
}

/** The tiles of the mosaic, always the same for the same seed. */
function mosaic(seed: number) {
  let v = seed
  const rnd = () => {
    v = (v * 9301 + 49297) % 233280
    return v / 233280
  }
  return Array.from({ length: 96 }, (_, i) => ({ i, o: rnd(), accent: rnd() > 0.82, delay: rnd() * 6 }))
}

/** The brand panel: colours of the band of the theme and a mosaic of tiles that moves slowly. */
function Hero({ admin, name, product, tagline, welcome, version, logo }: { admin: boolean; name: string; product: string; tagline: string; welcome?: string; version: string; logo?: string }) {
  const tiles = useMemo(() => mosaic(admin ? 7 : 3), [admin])
  // the band image of the platform under the panel, darkened as the band
  const brand = useBrand()
  const bandImage = useBandImage(brand.band_image ? `brand/band?v=${brand.band_image.v ?? ''}` : null)
  const features = admin
    ? ['Tenants, users and managers', 'Signed plugins, catalog and KPIs', 'Second factor at every sign-in']
    : ['The apps of the tenant, with everyone’s permissions', 'Shares, public links and activity in one place', 'Accessible according to WCAG 2.1 AA']
  return (
    <section
      aria-label={name}
      className="band-surface relative overflow-hidden bg-band bg-[linear-gradient(160deg,var(--band)_0%,color-mix(in_srgb,var(--band)_78%,black)_100%)] text-band-foreground max-lg:hidden"
      {...bandStyle(bandImage)}
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 grid h-[60%] grid-cols-8 content-start gap-3 overflow-hidden p-6 [mask-image:radial-gradient(ellipse_75%_90%_at_100%_0%,black_25%,transparent_72%)]"
      >
        {tiles.map((x) => (
          <span
            key={x.i}
            className={x.accent ? 'login-tile rounded-xl bg-[#F0B23A]' : 'login-tile rounded-xl bg-white'}
            style={{ opacity: x.accent ? 0.55 : 0.04 + x.o * 0.14, animationDelay: `${x.delay}s` }}
          />
        ))}
      </div>
      <div className="relative flex h-full min-h-[640px] flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          {logo ? <img src={logo} alt="" className="size-12 object-contain" /> : <AppMark variant="negative" className="size-12" />}
          <div>
            <b className="block text-xl">{name}</b>
            <span className="text-sm text-band-muted">{admin ? t('Platform') : tagline || t('Workspace')}</span>
          </div>
        </div>
        <div className="max-w-md">
          <h2 className="text-4xl leading-tight font-bold">{admin ? t('The platform, in one place') : t('Your work, in one place')}</h2>
          <p className="mt-4 text-lg text-band-muted">
            {admin ? t('Tenants, plugins and administrators: the whole platform from here.') : welcome || t('The apps of your tenant, for the people who work in it every day.')}
          </p>
          <ul className="mt-8 grid gap-3">
            {features.map((f) => (
              <li key={f} className="flex items-center gap-3">
                <span className="flex size-6 items-center justify-center rounded-full bg-white/15">
                  <Check className="size-3.5" />
                </span>
                {t(f)}
              </li>
            ))}
          </ul>
        </div>
        {/* on the same line as the legal links on the right: as tall as that footer */}
        <p className="absolute bottom-0 left-12 flex h-12 items-center text-xs text-band-muted">{version && `${product} ${version}`}</p>
        <span aria-hidden="true" />
      </div>
    </section>
  )
}

function LanguageSelect() {
  const lang = useLang()
  const langs = useLanguages()
  if (langs.length < 2) return null
  return (
    <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
      <SelectTrigger size="sm" className="w-auto gap-2 border-0 shadow-none hover:bg-accent" aria-label={t('Language')}>
        <Globe className="size-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {langs.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ModeButton() {
  const { mode } = useTheme()
  const next: Record<Mode, Mode> = { light: 'dark', dark: 'auto', auto: 'light' }
  const label = { light: t('Light'), dark: t('Dark'), auto: t('Automatic') }[mode]
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Contrast
  return (
    <Button variant="ghost" size="icon" aria-label={t('Mode: {m}', { m: label })} title={t('Mode: {m}', { m: label })} onClick={() => setTheme({ mode: next[mode] })}>
      <Icon />
    </Button>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="min-h-5 text-sm text-destructive">
      {text}
    </p>
  )
}

/** Waiting for the server: a spinner and, while it does not answer, the notice that it is tried again. */
function Waiting({ unavailable }: { unavailable: boolean }) {
  return (
    <div className="grid justify-items-center gap-3 text-center text-sm text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      {unavailable && <p role="status">{t('The server is not responding. Trying again…')}</p>}
    </div>
  )
}

function Title({ icon, title, sub }: { icon?: ReactNode; title: string; sub: ReactNode }) {
  return (
    <div className="mb-2">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        {icon}
        {title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
    </div>
  )
}

function TenantDoor({ initial, platformTheme, onEnter, onPick }: { initial: string; platformTheme?: string; onEnter: (s: Session) => void; onPick: (t: LoginTenant | null) => void }) {
  const [tenants, setTenants] = useState<LoginTenant[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [tenant, setTenant] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  // back from the identity provider with an error: `?oidc_error=<code>` before the hash
  const [error, setError] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('oidc_error')
    return code ? errText(new ApiError('', 0, code)) : ''
  })
  const [busy, setBusy] = useState(false)
  const [remember, setRemember] = useState(false)
  // "Forgot your password?": the form of the request replaces the sign-in form
  const [forgot, setForgot] = useState(false)

  useEffect(() => {
    // the code of the error is read once: a reload shows the clean page
    if (window.location.search.includes('oidc_error=')) window.history.replaceState(null, '', window.location.pathname + window.location.hash)
  }, [])

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = (attempt: number) =>
      api<LoginTenant[]>('GET', '/api/auth/tenants')
        .then((list) => {
          if (!live) return
          setUnavailable(false)
          setTenants(list)
          const w = initial.trim().toLowerCase()
          setTenant(list.length === 1 ? list[0].slug : list.some((x) => x.slug === w) ? w : '')
        })
        .catch((e) => {
          if (!live) return
          // the server does not answer (restarting, unreachable): say so and try again
          if (isUnavailable(e)) {
            setUnavailable(true)
            timer = setTimeout(() => void load(attempt + 1), retryDelay(attempt))
            return
          }
          setTenants([])
          setError(errText(e))
        })
    void load(0)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [initial])

  // the theme of the tenant as soon as it is known (address, only tenant, choice), else the platform's
  const picked = tenants?.find((x) => x.slug === tenant) ?? null
  const tenantTheme = picked?.theme
  useEffect(() => setPreset(tenantTheme ?? platformTheme), [tenantTheme, platformTheme])
  useEffect(() => onPick(picked), [picked, onPick])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!tenant) return setError(t('Choose your tenant'))
    setBusy(true)
    try {
      const s = await api<Session>('POST', '/api/auth/login', { tenant, username, password, remember: remember && !!picked?.remember })
      try {
        localStorage.setItem(LAST, tenant)
      } catch {
        /* storage not available */
      }
      onEnter(s)
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!tenants) return <Waiting unavailable={unavailable} />
  const only = tenants.length === 1 ? tenants[0] : null
  return (
    <>
      {tenants.length === 0 ? (
        <div className="grid gap-2">
          <Title title={t('Sign in')} sub={t('No tenant available. First start: sign in as an administrator and create one.')} />
          <ErrorLine text={error} />
        </div>
      ) : forgot && picked && picked.auth !== 'oidc' ? (
        <ForgotForm tenant={picked} who={username} onBack={() => setForgot(false)} />
      ) : (
        <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
          <Title
            title={t('Sign in')}
            sub={
              only ? (
                <>
                  {t('to the tenant')} <b className="text-foreground">{only.name}</b>
                </>
              ) : (
                t('with the credentials of your tenant')
              )
            }
          />
          {!only && (
            <Field id="lt" label={t('Tenant')}>
              <Select value={tenant} onValueChange={setTenant}>
                <SelectTrigger id="lt" className="w-full">
                  <SelectValue placeholder={t('Choose your tenant…')} />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((x) => (
                    <SelectItem key={x.slug} value={x.slug}>
                      {x.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {picked?.auth === 'oidc' ? (
            <OidcButton tenant={picked} remember={remember && !!picked.remember} />
          ) : (
            <>
              <Field id="lu" label={t('Username')}>
                <Input
                  id="lu"
                  autoComplete="username"
                  list="test-users"
                  value={username}
                  onChange={(e) => {
                    const v = e.target.value
                    setUsername(v)
                    const u = TEST_USERS.find((x) => x.username === v && (only || !tenant || x.tenant === tenant)) ?? TEST_USERS.find((x) => x.username === v)
                    if (u && tenants.some((x) => x.slug === u.tenant)) {
                      setTenant(u.tenant)
                      setPassword(u.password)
                    }
                  }}
                  required
                />
                <TestUsers id="test-users" users={TEST_USERS.filter((u) => tenants.some((x) => x.slug === u.tenant) && (only || !tenant || u.tenant === tenant))} />
              </Field>
              {TEST_USERS.length > 0 && <p className="-mt-2 text-xs text-muted-foreground">{t('Development: pick a test user in the Username field, the password fills in by itself.')}</p>}
              <Field id="lp" label={t('Password')}>
                <Input id="lp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
            </>
          )}
          {picked?.remember && (
            <label className="-mt-1 flex items-center gap-2 text-sm">
              <Checkbox checked={remember} onCheckedChange={(on) => setRemember(on === true)} />
              {t('Remember me on this device')}
            </label>
          )}
          {picked?.auth !== 'oidc' && (
            <Button type="submit" size="lg" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {t('Sign in')}
            </Button>
          )}
          {picked && picked.auth !== 'oidc' && (
            <button type="button" className="-mt-2 justify-self-start text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline" onClick={() => setForgot(true)}>
              {t('Forgot your password?')}
            </button>
          )}
          {picked?.auth === 'oidc' && <p className="-mt-2 text-xs text-muted-foreground">{t('Forgot your password? It is managed by the identity provider of your organization: use its password recovery.')}</p>}
          <ErrorLine text={error} />
          <p className="-mt-2 text-xs text-muted-foreground">{t('Invited to other tenants? Sign in to your own, then switch from the top bar.')}</p>
        </form>
      )}
      <div className="mt-6 border-t pt-4 text-center">
        <a href="#/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
          <KeyRound className="size-3.5" />
          {t('Administrator access')}
        </a>
      </div>
    </>
  )
}

/** The tenant signs in through its identity provider: the browser goes there and comes back signed in. */
/** "Forgot your password?": asks for the username or the email address and says the same whatever the account. */
function ForgotForm({ tenant, who, onBack }: { tenant: LoginTenant; who: string; onBack: () => void }) {
  const [value, setValue] = useState(who)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState<{ mail: boolean } | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      setAnswer(await api<{ mail: boolean }>('POST', '/api/auth/forgot', { tenant: tenant.slug, who: value }))
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
      <Title title={t('Forgot your password?')} sub={t('We send a link to choose a new one to the email address of the account.')} />
      {answer ? (
        <p role="status" className="text-sm">
          {answer.mail
            ? t('If an account with these details exists, we sent a message to its email address with the link to choose a new password. The link works once.')
            : t('This installation cannot send email. Ask the Tenant Manager of your tenant for a link to choose a new password.')}
        </p>
      ) : (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="fp-who">{t('Username or email address')}</Label>
            <Input id="fp-who" autoComplete="username" required value={value} onChange={(e) => setValue(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('Tenant: {name}', { name: tenant.name })}</p>
          </div>
          <Button type="submit" size="lg" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {t('Send the link')}
          </Button>
          <ErrorLine text={error} />
        </>
      )}
      <Button type="button" variant="ghost" onClick={onBack}>
        ← {t('Back to sign-in')}
      </Button>
    </form>
  )
}

function OidcButton({ tenant, remember }: { tenant: LoginTenant; remember: boolean }) {
  const name = tenant.button || t('your identity provider')
  return (
    <div className="grid gap-2">
      <Button asChild size="lg">
        <a href={`api/auth/oidc/${encodeURIComponent(tenant.slug)}/start${remember ? '?remember=1' : ''}`}>
          <LogIn />
          {t('Sign in with {name}', { name })}
        </a>
      </Button>
      <p className="text-xs text-muted-foreground">{t('{tenant} signs in through its identity provider: the password is asked there, never by Mosaikit.', { tenant: tenant.name })}</p>
    </div>
  )
}

type Step = { kind: 'password' } | { kind: 'totp' } | { kind: 'setup'; setup: TotpSetup | null } | { kind: 'codes'; codes: string[]; session: Session }

function AdminDoor({ platformTheme, onEnter }: { platformTheme?: string; onEnter: (s: Session) => void }) {
  useEffect(() => setPreset(platformTheme), [platformTheme])
  const [step, setStep] = useState<Step>({ kind: 'password' })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = (fn: () => Promise<void>) => async (e?: FormEvent) => {
    e?.preventDefault()
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const signIn = run(async () => {
    const r = await api<Session | PendingLogin>('POST', '/api/auth/admin/login', { username, password })
    if ('user' in r) return onEnter(r)
    setCsrf(r.csrf)
    setPassword('')
    setCode('')
    if (r.pending === 'totp') return setStep({ kind: 'totp' })
    setStep({ kind: 'setup', setup: null })
    setStep({ kind: 'setup', setup: await api<TotpSetup>('POST', '/api/auth/totp/setup') })
  })
  const verify = run(async () => onEnter(await api<Session>('POST', '/api/auth/totp/verify', { code })))
  const enable = run(async () => {
    const s = await api<Session & { recovery_codes: string[] }>('POST', '/api/auth/totp/enable', { code })
    setStep({ kind: 'codes', codes: s.recovery_codes, session: s })
  })
  const back =
    step.kind === 'password' ? (
      <a href="#/" className="text-sm text-muted-foreground hover:text-primary">
        ← {t('Sign-in of the tenants')}
      </a>
    ) : step.kind !== 'codes' ? (
      <button type="button" className="text-sm text-muted-foreground hover:text-primary" onClick={() => setStep({ kind: 'password' })}>
        ← {t('Start again')}
      </button>
    ) : null

  if (step.kind === 'codes')
    return (
      <div className="grid gap-4">
        <Title title={t('Recovery codes')} sub={t('Two-step verification is on. Keep these codes: each one works once, if you lose your phone. They will not be shown again.')} />
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-muted p-3 font-mono text-sm" aria-label={t('Recovery codes')}>
          {step.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(step.codes.join('\n'))}>
          {t('Copy the codes')}
        </Button>
        <Button size="lg" onClick={() => onEnter(step.session)}>
          {t('I saved the codes: continue')}
        </Button>
      </div>
    )

  return (
    <form className="grid gap-4" onSubmit={step.kind === 'password' ? signIn : step.kind === 'totp' ? verify : enable}>
      <Title
        icon={<KeyRound className="size-5 text-primary" />}
        title={step.kind === 'password' ? t('Administrator access') : step.kind === 'totp' ? t('Second step') : t('Register the app')}
        sub={
          step.kind === 'password'
            ? t('Always with the local password and the second factor, whatever the tenants use.')
            : step.kind === 'totp'
              ? t('The code of your authenticator app, or a recovery code.')
              : t('First sign-in: scan the code with Google or Microsoft Authenticator, FreeOTP or similar.')
        }
      />
      {step.kind === 'password' && (
        <>
          <Field id="au" label={t('Username')}>
            <Input
              id="au"
              autoComplete="username"
              list="test-admins"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                const u = TEST_ADMINS.find((x) => x.username === e.target.value)
                if (u) setPassword(u.password)
              }}
              required
            />
            <TestUsers id="test-admins" users={TEST_ADMINS} />
          </Field>
          <Field id="ap" label={t('Password')}>
            <Input id="ap" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
        </>
      )}
      {step.kind === 'setup' &&
        (step.setup ? (
          <>
            <div
              className="mx-auto w-44 rounded-md border bg-white p-1.5 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
              role="img"
              aria-label={t('QR code to scan with the app')}
              dangerouslySetInnerHTML={{ __html: step.setup.qr_svg }}
            />
            <p className="text-xs text-muted-foreground">
              {t('Or type the key by hand:')} <code className="select-all break-all font-mono">{step.setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </p>
          </>
        ) : (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ))}
      {step.kind !== 'password' && (
        <Field id="ac" label={step.kind === 'setup' ? t('Code shown by the app') : t('Code')}>
          <Input
            id="ac"
            className="text-center font-mono text-lg tracking-widest"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </Field>
      )}
      <Button type="submit" size="lg" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        {step.kind === 'password' ? t('Sign in') : step.kind === 'setup' ? t('Turn on and sign in') : t('Confirm')}
      </Button>
      <ErrorLine text={error} />
      {step.kind === 'password' && (
        <p className="-mt-2 text-xs text-muted-foreground">
          {t('First start: user')} <code className="font-mono">admin</code>.
        </p>
      )}
      <div className="border-t pt-4 text-center">{back}</div>
    </form>
  )
}
