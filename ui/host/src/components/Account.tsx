import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, errText, fmtDate } from '../api.ts'
import type { Invitation, Membership, Session } from '../types.ts'
import { useUi } from '../ui-context.ts'
import { roleLabel } from '../roles.ts'

export default function Account({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const ui = useUi()
  const [invites, setInvites] = useState<Invitation[]>([])
  const [pw, setPw] = useState({ old: '', new: '', again: '' })
  const [error, setError] = useState('')
  const reload = useCallback(() => api<Invitation[]>('GET', '/api/me/invitations').then(setInvites).catch((e) => setError(errText(e))), [])
  useEffect(() => {
    void reload()
  }, [reload])

  async function changePassword(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (pw.new !== pw.again) {
      setError('le due password non coincidono')
      return
    }
    try {
      await api('POST', '/api/me/password', { old: pw.old, new: pw.new })
      ui.toast('password aggiornata: le altre sessioni sono state chiuse')
      setPw({ old: '', new: '', again: '' })
    } catch (err) {
      setError(errText(err))
    }
  }

  async function answer(id: string, accept: boolean) {
    try {
      await api('POST', `/api/me/invitations/${id}/${accept ? 'accept' : 'decline'}`)
      ui.toast(accept ? 'invito accettato' : 'invito rifiutato')
      await reload()
      onChanged()
    } catch (e) {
      setError(errText(e))
    }
  }

  const u = session.user
  const admin = u.is_system_admin
  return (
    <div className="console">
      <h1>Account</h1>
      {admin ? (
        <p className="lead">
          {u.display_name || u.username} · <span className="mono">{u.username}</span> — account Administrator: accedi da <b>Accesso amministratori</b>, con il
          secondo fattore.
        </p>
      ) : (
        <p className="lead">
          {u.display_name || u.username} · <span className="mono">{u.username}@{u.home_tenant_slug}</span> — ti autentichi sempre sul tenant{' '}
          <b>{u.home_tenant_slug}</b>.
        </p>
      )}
      {!admin && <TenantsAndInvites invites={invites} memberships={session.memberships} onAnswer={(id, accept) => void answer(id, accept)} />}
      <section className="card" style={{ maxWidth: 520 }}>
        <h3>Cambia password</h3>
        <form onSubmit={(e) => void changePassword(e)}>
          <div className="field">
            <label htmlFor="po">Password attuale</label>
            <input id="po" type="password" autoComplete="current-password" required value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pn">Nuova password (almeno 10 caratteri)</label>
            <input id="pn" type="password" autoComplete="new-password" minLength={10} required value={pw.new} onChange={(e) => setPw({ ...pw, new: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pa">Ripeti la nuova password</label>
            <input id="pa" type="password" autoComplete="new-password" required value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
          </div>
          <button className="btn primary" type="submit">
            Aggiorna password
          </button>
        </form>
      </section>
      <div className={'msg-line' + (error ? ' err' : '')}>{error}</div>
    </div>
  )
}

/** Inviti ricevuti e tenant dell'utente (non per gli Administrator, che non sono membri di nessun tenant). */
function TenantsAndInvites({ invites, memberships, onAnswer }: { invites: Invitation[]; memberships: Membership[]; onAnswer: (id: string, accept: boolean) => void }) {
  return (
    <>
      <section className="card">
        <h3>Inviti ricevuti</h3>
        {invites.length === 0 ? (
          <p className="muted">Nessun invito in attesa.</p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <b>{i.tenant_name}</b> <span className="muted mono">{i.tenant_slug}</span>
                      <div className="muted" style={{ fontSize: 12 }}>
                        come {roleLabel(i.role)} · da {i.invited_by ?? '—'} · scade {fmtDate(i.expires_at)}
                      </div>
                    </td>
                    <td className="actions">
                      <button type="button" className="btn primary small" onClick={() => onAnswer(i.id, true)}>
                        Accetta
                      </button>
                      <button type="button" className="btn ghost small" onClick={() => onAnswer(i.id, false)}>
                        Rifiuta
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card">
        <h3>I tuoi tenant</h3>
        <div className="row">
          {memberships.map((m) => (
            <span key={m.slug} className={'badge' + (m.is_home ? ' acc' : '')}>
              {m.name} · {roleLabel(m.role)}
              {m.is_home ? ' · appartenenza' : ' · ospite'}
            </span>
          ))}
        </div>
      </section>
    </>
  )
}
