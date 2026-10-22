// Accesso a due porte, come nel mockup. A sinistra il pannello del marchio (colori del tema, mosaico
// di tessere, benvenuto); a destra lingua, modo e supporto, il modulo e le note legali.
// Utenti: tenant da un menu (nascosto se e' uno solo, preselezionato da #/login/<tenant>) e credenziali
// del tenant. Amministratori (#/admin): password locale, poi il secondo fattore TOTP o, al primo
// accesso, la registrazione dell'app e i codici di recupero.

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Contrast, Globe, KeyRound, LifeBuoy, Loader2, Moon, Sun } from 'lucide-react'
import { api, errText, setCsrf } from '../api.ts'
import { useBrand } from '../brand.ts'
import type { LoginTenant, PendingLogin, Session, TotpSetup } from '../types.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LANGS, setLang, t, useLang, type Lang } from './i18n.ts'
import { go, to } from './router.ts'
import { AppMark } from './Shell.tsx'
import { setTheme, useTheme, type Mode } from './theme.ts'

const LAST = 'msk_last_login_tenant'

/* Gli utenti di prova dell'ambiente di sviluppo, per l'autocompletamento dei campi Utente (con la
   password). Solo con il server di sviluppo di Vite: in una build non ci sono. */
interface TestUser {
  tenant: string
  username: string
  password: string
  who: string
}
const TEST_USERS: TestUser[] = import.meta.env.DEV
  ? [
      { tenant: 'comune-roma', username: 'e.ricci', password: 'password-prova-1', who: 'Elena Ricci · Tenant Manager' },
      { tenant: 'comune-roma', username: 'm.esposito', password: 'password-prova-1', who: 'Marco Esposito · Tenant Manager' },
      { tenant: 'comune-roma', username: 'd.conti', password: 'password-prova-1', who: 'Davide Conti · User, ospite in Regione Lazio' },
      { tenant: 'comune-roma', username: 's.greco', password: 'password-prova-1', who: 'Sara Greco · User' },
      { tenant: 'comune-roma', username: 'l.bianchi', password: 'password-prova-1', who: 'Luca Bianchi · User' },
      { tenant: 'regione-lazio', username: 'l.verdi', password: 'password-prova-1', who: 'Luca Verdi · Tenant Manager' },
    ]
  : []
const TEST_ADMINS: TestUser[] = import.meta.env.DEV ? [{ tenant: '', username: 'admin', password: 'admin-sviluppo', who: 'Administrator' }] : []

/** I suggerimenti del campo Utente: scegliendone uno il chiamante completa la password. */
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
  const brand = useBrand()
  const qc = useQueryClient()
  useLang() // i testi seguono la lingua scelta
  const admin = door === 'admin'
  const enter = (s: Session) => {
    setCsrf(s.csrf)
    qc.setQueryData(['session'], s)
    if (s.user.is_system_admin) go(to.admin())
    else go(to.tenant(s.memberships.find((m) => m.is_home)?.slug ?? s.user.home_tenant_slug))
  }
  return (
    <div className="grid min-h-full bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <Hero admin={admin} name={brand.name} tagline={brand.tagline} version={brand.version} />
      <section className="flex min-h-full flex-col">
        <div className="flex items-center justify-end gap-1 p-4">
          <LanguageSelect />
          <ModeButton />
          {brand.support_url && (
            <a href={brand.support_url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
              <LifeBuoy className="size-4" />
              {t('Supporto')}
            </a>
          )}
        </div>
        <main className="flex flex-1 items-center justify-center px-6 pb-8">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <AppMark className="size-9" />
              <b className="text-lg">{brand.name}</b>
            </div>
            {admin ? <AdminDoor onEnter={enter} /> : <TenantDoor initial={tenant ?? remembered()} onEnter={enter} />}
            {brand.login_message && <p className="mt-6 border-l-2 border-primary pl-3 text-sm">{brand.login_message}</p>}
          </div>
        </main>
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t px-6 py-4 text-xs text-muted-foreground">
          <nav className="flex gap-4" aria-label={t('Note legali')}>
            {['Accessibilità', 'Privacy', 'Note legali'].map((x) => (
              <a key={x} href="#/" onClick={(e) => e.preventDefault()} className="underline-offset-4 hover:text-foreground hover:underline">
                {t(x)}
              </a>
            ))}
          </nav>
        </footer>
      </section>
    </div>
  )
}

/** Le tessere del mosaico, sempre le stesse per lo stesso seme. */
function mosaic(seed: number) {
  let v = seed
  const rnd = () => {
    v = (v * 9301 + 49297) % 233280
    return v / 233280
  }
  return Array.from({ length: 96 }, (_, i) => ({ i, o: rnd(), accent: rnd() > 0.82, delay: rnd() * 6 }))
}

/** Il pannello del marchio: colori della barra del tema e un mosaico di tessere che si muove piano. */
function Hero({ admin, name, tagline, version }: { admin: boolean; name: string; tagline: string; version: string }) {
  const tiles = useMemo(() => mosaic(admin ? 7 : 3), [admin])
  const features = admin
    ? ['Tenant, utenti e gestori', 'Plugin firmati, catalogo e KPI', 'Secondo fattore per ogni accesso']
    : ['Le app del tenant, con i permessi di ciascuno', 'Condivisioni, link pubblici e attività in un posto solo', 'Accessibile secondo le WCAG 2.1 AA']
  return (
    <section
      aria-label={name}
      className="relative overflow-hidden bg-band bg-[linear-gradient(160deg,var(--band)_0%,color-mix(in_srgb,var(--band)_78%,black)_100%)] text-band-foreground max-lg:hidden"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 grid h-[60%] grid-cols-8 content-start gap-3 overflow-hidden p-6 [mask-image:radial-gradient(ellipse_75%_90%_at_100%_0%,black_25%,transparent_72%)]"
      >
        {tiles.map((x) => (
          <span
            key={x.i}
            className={x.accent ? 'login-tile rounded-xl bg-primary' : 'login-tile rounded-xl bg-white'}
            style={{ opacity: x.accent ? 0.55 : 0.04 + x.o * 0.14, animationDelay: `${x.delay}s` }}
          />
        ))}
      </div>
      <div className="relative flex h-full min-h-[640px] flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <AppMark className="size-12 ring-2 ring-white/20 rounded-[10px]" />
          <div>
            <b className="block text-xl">{name}</b>
            <span className="text-sm text-band-muted">{admin ? t('Piattaforma') : tagline || t('Spazio di lavoro')}</span>
          </div>
        </div>
        <div className="max-w-md">
          <h2 className="text-4xl leading-tight font-bold">{admin ? t('La piattaforma, in un posto solo') : t('Il tuo lavoro, in un posto solo')}</h2>
          <p className="mt-4 text-lg text-band-muted">
            {admin ? t('Tenant, plugin e amministratori: tutta la piattaforma da qui.') : t('Le app del tuo tenant, per le persone che ci lavorano ogni giorno.')}
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
        {/* sulla stessa riga dei link legali a destra: alta quanto quel piede */}
        <p className="absolute bottom-0 left-12 flex h-12 items-center text-xs text-band-muted">{version && `${name} ${version}`}</p>
        <span aria-hidden="true" />
      </div>
    </section>
  )
}

function LanguageSelect() {
  const lang = useLang()
  return (
    <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
      <SelectTrigger size="sm" className="w-auto gap-2 border-0 shadow-none hover:bg-accent" aria-label={t('Lingua')}>
        <Globe className="size-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {LANGS.map((l) => (
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
  const label = { light: t('Chiaro'), dark: t('Scuro'), auto: t('Automatico') }[mode]
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Contrast
  return (
    <Button variant="ghost" size="icon" aria-label={t('Modo: {m}', { m: label })} title={t('Modo: {m}', { m: label })} onClick={() => setTheme({ mode: next[mode] })}>
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

function TenantDoor({ initial, onEnter }: { initial: string; onEnter: (s: Session) => void }) {
  const [tenants, setTenants] = useState<LoginTenant[] | null>(null)
  const [tenant, setTenant] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<LoginTenant[]>('GET', '/api/auth/tenants')
      .then((list) => {
        setTenants(list)
        const w = initial.trim().toLowerCase()
        setTenant(list.length === 1 ? list[0].slug : list.some((x) => x.slug === w) ? w : '')
      })
      .catch((e) => {
        setTenants([])
        setError(errText(e))
      })
  }, [initial])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!tenant) return setError(t('Scegli il tenant'))
    setBusy(true)
    try {
      const s = await api<Session>('POST', '/api/auth/login', { tenant, username, password })
      try {
        localStorage.setItem(LAST, tenant)
      } catch {
        /* storage non disponibile */
      }
      onEnter(s)
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!tenants) return <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
  const only = tenants.length === 1 ? tenants[0] : null
  return (
    <>
      {tenants.length === 0 ? (
        <div className="grid gap-2">
          <Title title={t('Accedi')} sub={t('Nessun tenant disponibile. Primo avvio: entra come amministratore e crea un tenant.')} />
          <ErrorLine text={error} />
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
          <Title
            title={t('Accedi')}
            sub={
              only ? (
                <>
                  {t('al tenant')} <b className="text-foreground">{only.name}</b>
                </>
              ) : (
                t('con le credenziali del tuo tenant')
              )
            }
          />
          {!only && (
            <Field id="lt" label={t('Tenant')}>
              <Select value={tenant} onValueChange={setTenant}>
                <SelectTrigger id="lt" className="w-full">
                  <SelectValue placeholder={t('Scegli il tenant…')} />
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
          <Field id="lu" label={t('Utente')}>
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
          {TEST_USERS.length > 0 && <p className="-mt-2 text-xs text-muted-foreground">{t('Sviluppo: scegli un utente di prova dal campo Utente, la password si compila da sola.')}</p>}
          <Field id="lp" label={t('Password')}>
            <Input id="lp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {t('Accedi')}
          </Button>
          <ErrorLine text={error} />
          <p className="-mt-2 text-xs text-muted-foreground">{t('Invitato in altri tenant? Entra dal tuo, poi cambia tenant dalla barra in alto.')}</p>
        </form>
      )}
      <div className="mt-6 border-t pt-4 text-center">
        <a href="#/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
          <KeyRound className="size-3.5" />
          {t('Accesso amministratori')}
        </a>
      </div>
    </>
  )
}

type Step = { kind: 'password' } | { kind: 'totp' } | { kind: 'setup'; setup: TotpSetup | null } | { kind: 'codes'; codes: string[]; session: Session }

function AdminDoor({ onEnter }: { onEnter: (s: Session) => void }) {
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
        ← {t('Accesso utenti')}
      </a>
    ) : step.kind !== 'codes' ? (
      <button type="button" className="text-sm text-muted-foreground hover:text-primary" onClick={() => setStep({ kind: 'password' })}>
        ← {t('Ricomincia')}
      </button>
    ) : null

  if (step.kind === 'codes')
    return (
      <div className="grid gap-4">
        <Title title={t('Codici di recupero')} sub={t('La verifica in due passaggi è attiva. Conserva questi codici: ognuno vale una volta, se perdi il telefono. Non verranno più mostrati.')} />
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-muted p-3 font-mono text-sm" aria-label={t('Codici di recupero')}>
          {step.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(step.codes.join('\n'))}>
          {t('Copia i codici')}
        </Button>
        <Button size="lg" onClick={() => onEnter(step.session)}>
          {t('Ho salvato i codici: continua')}
        </Button>
      </div>
    )

  return (
    <form className="grid gap-4" onSubmit={step.kind === 'password' ? signIn : step.kind === 'totp' ? verify : enable}>
      <Title
        icon={<KeyRound className="size-5 text-primary" />}
        title={step.kind === 'password' ? t('Accesso amministratori') : step.kind === 'totp' ? t('Secondo passaggio') : t('Registra l’app')}
        sub={
          step.kind === 'password'
            ? t('Sempre con la password locale e il secondo fattore, qualunque cosa usino i tenant.')
            : step.kind === 'totp'
              ? t('Il codice dell’app di autenticazione, oppure un codice di recupero.')
              : t('Primo accesso: inquadra il codice con Google o Microsoft Authenticator, FreeOTP o simili.')
        }
      />
      {step.kind === 'password' && (
        <>
          <Field id="au" label={t('Utente')}>
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
              aria-label={t("QR code da inquadrare con l'app")}
              dangerouslySetInnerHTML={{ __html: step.setup.qr_svg }}
            />
            <p className="text-xs text-muted-foreground">
              {t('Oppure la chiave a mano:')} <code className="select-all break-all font-mono">{step.setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </p>
          </>
        ) : (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ))}
      {step.kind !== 'password' && (
        <Field id="ac" label={step.kind === 'setup' ? t('Codice mostrato dall’app') : t('Codice')}>
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
        {step.kind === 'password' ? t('Accedi') : step.kind === 'setup' ? t('Attiva e accedi') : t('Conferma')}
      </Button>
      <ErrorLine text={error} />
      {step.kind === 'password' && (
        <p className="-mt-2 text-xs text-muted-foreground">
          {t('Primo avvio: utente')} <code className="font-mono">admin</code>.
        </p>
      )}
      <div className="border-t pt-4 text-center">{back}</div>
    </form>
  )
}
