import { useState, type FormEvent } from 'react'
import { api, errText } from '../api.ts'
import { useBrand } from '../brand.ts'
import type { Session } from '../types.ts'

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

export default function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const brand = useBrand()
  const [tenant, setTenant] = useState(remembered)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const s = await api<Session>('POST', '/api/auth/login', { tenant, username, password })
      try {
        localStorage.setItem(LAST_TENANT, tenant.trim().toLowerCase())
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
      <form className="login-card" onSubmit={(e) => void submit(e)}>
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
        <p className="sub">Accedi con le credenziali del tuo tenant</p>
        <label className="f-label" htmlFor="lt">
          Tenant
        </label>
        <input id="lt" autoComplete="organization" placeholder="es. comune-roma" value={tenant} onChange={(e) => setTenant(e.target.value)} required />
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
        {brand.login_message && <p className="login-message">{brand.login_message}</p>}
        <p className="demo-hint">
          Primo avvio: tenant <code>system</code>, utente <code>admin</code>.
        </p>
        <p className="login-footer">
          {brand.footer || brand.name} {brand.version && <span className="mono">v{brand.version}</span>}
        </p>
      </form>
    </div>
  )
}
