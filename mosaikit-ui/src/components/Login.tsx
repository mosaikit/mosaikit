import { useState } from 'react'
import type { FormEvent } from 'react'
import { api, errText } from '../api.ts'

interface LoginProps {
  onSuccess: (username: string) => void
}

interface DecoTile {
  top: string
  left: string
  size: number
  rotate: number
  delay: number
  variant: '' | 'solid' | 'dark'
}

const TILES: DecoTile[] = [
  { top: '6%', left: '4%', size: 110, rotate: -10, delay: 0, variant: 'solid' },
  { top: '14%', left: '78%', size: 150, rotate: 8, delay: 1.2, variant: '' },
  { top: '58%', left: '86%', size: 90, rotate: -6, delay: 2.1, variant: 'dark' },
  { top: '72%', left: '8%', size: 130, rotate: 12, delay: 0.7, variant: '' },
  { top: '38%', left: '90%', size: 60, rotate: -14, delay: 1.7, variant: 'solid' },
  { top: '80%', left: '68%', size: 100, rotate: 6, delay: 2.8, variant: '' },
  { top: '4%', left: '44%', size: 70, rotate: 14, delay: 0.4, variant: 'dark' },
  { top: '64%', left: '38%', size: 54, rotate: -8, delay: 3.4, variant: '' },
  { top: '30%', left: '12%', size: 48, rotate: 18, delay: 2.4, variant: 'dark' },
  { top: '88%', left: '30%', size: 62, rotate: -12, delay: 1.5, variant: 'solid' },
]

export default function Login({ onSuccess }: LoginProps) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const r = await api<{ token: string; username: string }>('POST', '/login', {
        username,
        password,
      })
      localStorage.setItem('msk_token', r.token)
      localStorage.setItem('msk_user', r.username)
      onSuccess(r.username)
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
            style={{
              top: t.top,
              left: t.left,
              width: t.size,
              height: t.size,
              rotate: t.rotate + 'deg',
              animationDelay: t.delay + 's',
            }}
          />
        ))}
      </div>
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⬡
          </span>
          Mosaikit
        </div>
        <p className="sub">Accedi per gestire plugin e risorse</p>
        <label className="f-label" htmlFor="lu">
          Utente
        </label>
        <input
          id="lu"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label className="f-label" htmlFor="lp">
          Password
        </label>
        <input
          id="lp"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? 'Accesso…' : 'Accedi'}
        </button>
        <div className="login-err" role="alert">
          {error}
        </div>
        <p className="demo-hint">
          demo: <code>admin/mosaikit2026!</code> · <code>user/demo1234</code>
        </p>
      </form>
    </div>
  )
}
