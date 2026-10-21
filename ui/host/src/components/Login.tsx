import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, errText, setCsrf } from '../api.ts'
import { useBrand } from '../brand.ts'
import type { LoginTenant, PendingLogin, Session, TotpSetup } from '../types.ts'

const TILES = [
  { top: '6%', left: '4%', size: 110, rotate: -10, delay: 0, variant: 'solid' },
  { top: '14%', left: '78%', size: 150, rotate: 8, delay: 1.2, variant: '' },
  { top: '58%', left: '86%', size: 90, rotate: -6, delay: 2.1, variant: 'dark' },
  { top: '72%', left: '8%', size: 130, rotate: 12, delay: 0.7, variant: '' },
  { top: '38%', left: '90%', size: 60, rotate: -14, delay: 1.7, variant: 'solid' },
  { top: '80%', left: '68%', size: 100, rotate: 6, delay: 2.8, variant: '' },
  { top: '4%', left: '44%', size: 70, rotate: 14, delay: 0.4, variant: 'dark' },
  { top: '64%', left: '38%', size: 54, rotate: -8, delay: 3.4, variant: '' },
]

const LAST_TENANT = 'msk_last_login_tenant'

function remembered(): string {
  try {
    return localStorage.getItem(LAST_TENANT) ?? ''
  } catch {
    return ''
  }
}

/** `#/admin`: accesso amministratori; `#/login/<tenant>`: tenant preselezionato. */
function route(): { admin: boolean; tenant: string } {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)
  if (parts[0] === 'admin') return { admin: true, tenant: '' }
  return { admin: false, tenant: parts[0] === 'login' && parts[1] ? parts[1] : remembered() }
}

/**
 * Pagina di accesso. Utenti: scelta del tenant (menu a tendina, nascosto se il tenant
 * e' uno solo) e credenziali del tenant. Administrator (`#/admin`): accesso locale,
 * poi il secondo fattore (TOTP) o, al primo accesso, la registrazione dell'app.
 */
export default function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const brand = useBrand()
  const [r, setR] = useState(route)
  useEffect(() => {
    const on = () => setR(route())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  return (
    <div className="login-screen">
      <div className="login-tiles" aria-hidden="true">
        {TILES.map((t, i) => (
          <span
            key={i}
            className={'lt' + (t.variant ? ' ' + t.variant : '')}
            style={{ top: t.top, left: t.left, width: t.size, height: t.size, rotate: t.rotate + 'deg', animationDelay: t.delay + 's' }}
          />
        ))}
      </div>
      <div className="login-card">
        <div className="brand">
          {brand.logo ? (
            <img className="brand-logo" src="brand/logo" alt="" />
          ) : (
            <span className="brand-mark" aria-hidden="true">
              ⬡
            </span>
          )}
          {brand.name}
        </div>
        {brand.tagline && <p className="tagline">{brand.tagline}</p>}
        {r.admin ? <AdminLogin key="admin" onLogin={onLogin} /> : <TenantLogin key="tenant" initial={r.tenant} onLogin={onLogin} />}
        {brand.login_message && <p className="login-message">{brand.login_message}</p>}
        <p className="login-footer">
          {brand.footer || brand.name} {brand.version && <span className="mono">v{brand.version}</span>}
        </p>
      </div>
    </div>
  )
}

function TenantLogin({ initial, onLogin }: { initial: string; onLogin: (s: Session) => void }) {
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
        const wanted = initial.trim().toLowerCase()
        setTenant(list.length === 1 ? list[0].slug : list.some((t) => t.slug === wanted) ? wanted : '')
      })
      .catch((e) => {
        setTenants([])
        setError(errText(e))
      })
  }, [initial])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const s = await api<Session>('POST', '/api/auth/login', { tenant, username, password })
      try {
        localStorage.setItem(LAST_TENANT, tenant)
      } catch {
        /* storage non disponibile */
      }
      onLogin(s)
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  if (tenants === null) return <p className="sub">caricamento…</p>
  const only = tenants.length === 1 ? tenants[0] : null
  return (
    <>
      {tenants.length === 0 ? (
        <>
          <p className="sub">Nessun tenant disponibile.</p>
          <div className="login-err" role="alert">
            {error}
          </div>
          <p className="demo-hint">Primo avvio: entra come amministratore e crea un tenant.</p>
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <p className="sub">
            {only ? (
              <>
                Accedi a <b>{only.name}</b>
              </>
            ) : (
              'Accedi con le credenziali del tuo tenant'
            )}
          </p>
          {!only && (
            <>
              <label className="f-label" htmlFor="lt">
                Tenant
              </label>
              <select id="lt" value={tenant} onChange={(e) => setTenant(e.target.value)} required>
                <option value="" disabled>
                  Scegli il tenant…
                </option>
                {tenants.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <label className="f-label" htmlFor="lu">
            Utente
          </label>
          <input id="lu" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <label className="f-label" htmlFor="lp">
            Password
          </label>
          <input id="lp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn primary block" type="submit" disabled={busy}>
            {busy ? 'Accesso…' : 'Accedi'}
          </button>
          <div className="login-err" role="alert">
            {error}
          </div>
        </form>
      )}
      <p className="login-switch">
        <a href="#/admin">Accesso amministratori</a>
      </p>
    </>
  )
}

type Step = { kind: 'password' } | { kind: 'totp' } | { kind: 'setup'; setup: TotpSetup | null } | { kind: 'codes'; codes: string[]; session: Session }

function AdminLogin({ onLogin }: { onLogin: (s: Session) => void }) {
  const [step, setStep] = useState<Step>({ kind: 'password' })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
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

  const signIn = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const r = await api<Session | PendingLogin>('POST', '/api/auth/admin/login', { username, password })
      if ('user' in r) return onLogin(r)
      setCsrf(r.csrf)
      setPassword('')
      setCode('')
      if (r.pending === 'totp') return setStep({ kind: 'totp' })
      setStep({ kind: 'setup', setup: null })
      setStep({ kind: 'setup', setup: await api<TotpSetup>('POST', '/api/auth/totp/setup') })
    })
  }

  const verify = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => onLogin(await api<Session>('POST', '/api/auth/totp/verify', { code })))
  }

  const enable = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const s = await api<Session & { recovery_codes: string[] }>('POST', '/api/auth/totp/enable', { code })
      setStep({ kind: 'codes', codes: s.recovery_codes, session: s })
    })
  }

  const restart = () => {
    setStep({ kind: 'password' })
    setCode('')
    setError('')
  }

  const err = (
    <div className="login-err" role="alert">
      {error}
    </div>
  )
  const back: ReactNode = (
    <p className="login-switch">
      {step.kind === 'password' ? (
        <a href="#/">← Accesso utenti</a>
      ) : step.kind !== 'codes' ? (
        <button type="button" className="linklike" onClick={restart}>
          ← Ricomincia
        </button>
      ) : null}
    </p>
  )

  if (step.kind === 'totp')
    return (
      <form onSubmit={verify}>
        <p className="sub">Verifica in due passaggi: inserisci il codice dell'app di autenticazione.</p>
        <label className="f-label" htmlFor="lc">
          Codice
        </label>
        <input id="lc" className="code-input" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />
        <p className="demo-hint">Senza telefono: usa uno dei codici di recupero (es. abcd-efgh).</p>
        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? 'Verifica…' : 'Conferma'}
        </button>
        {err}
        {back}
      </form>
    )

  if (step.kind === 'setup')
    return (
      <form onSubmit={enable}>
        <p className="sub">Primo accesso: registra questo account in un'app di autenticazione (Google o Microsoft Authenticator, FreeOTP…).</p>
        {step.setup ? (
          <>
            <div className="totp-qr" aria-label="QR code da inquadrare con l'app" role="img" dangerouslySetInnerHTML={{ __html: step.setup.qr_svg }} />
            <p className="demo-hint">
              Oppure inserisci a mano la chiave: <code className="totp-secret">{step.setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </p>
          </>
        ) : (
          <p className="demo-hint">preparazione…</p>
        )}
        <label className="f-label" htmlFor="lc">
          Codice mostrato dall'app
        </label>
        <input id="lc" className="code-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
        <button className="btn primary block" type="submit" disabled={busy || !step.setup}>
          {busy ? 'Verifica…' : 'Attiva e accedi'}
        </button>
        {err}
        {back}
      </form>
    )

  if (step.kind === 'codes')
    return (
      <div>
        <p className="sub">
          Verifica in due passaggi attiva. Conserva questi <b>codici di recupero</b> in un posto sicuro: ognuno vale una volta, se perdi il telefono. Non verranno più
          mostrati.
        </p>
        <ul className="recovery-codes" aria-label="Codici di recupero">
          {step.codes.map((c) => (
            <li key={c} className="mono">
              {c}
            </li>
          ))}
        </ul>
        <button type="button" className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(step.codes.join('\n'))}>
          Copia i codici
        </button>
        <button type="button" className="btn primary block" onClick={() => onLogin(step.session)}>
          Ho salvato i codici: continua
        </button>
      </div>
    )

  return (
    <form onSubmit={signIn}>
      <p className="sub">Accesso amministratori</p>
      <label className="f-label" htmlFor="lu">
        Utente
      </label>
      <input id="lu" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      <label className="f-label" htmlFor="lp">
        Password
      </label>
      <input id="lp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button className="btn primary block" type="submit" disabled={busy}>
        {busy ? 'Accesso…' : 'Accedi'}
      </button>
      {err}
      <p className="demo-hint">
        Primo avvio: utente <code>admin</code>.
      </p>
      {back}
    </form>
  )
}
