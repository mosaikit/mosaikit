import { useCallback, useEffect, useState } from 'react'
import { api, enc, errText, fmtDate } from '../api.ts'
import type { Grant, Level, LinkInfo, Principal, ResourceMeta, TenantContext } from '../types.ts'
import { Modal } from '../ui.tsx'
import { useUi } from '../ui-context.ts'

const LEVELS: { v: Level; label: string; hint: string }[] = [
  { v: 'read', label: 'Lettura', hint: 'vede il contenuto' },
  { v: 'write', label: 'Scrittura', hint: 'modifica il contenuto' },
  { v: 'manage', label: 'Gestione', hint: 'condivide, sposta, elimina' },
]

interface Props {
  ctx: TenantContext
  resourceId: string
  onClose: () => void
}

/** Finestra di condivisione dell'host: la stessa per tutti i plugin. */
export default function ShareDialog({ ctx, resourceId, onClose }: Props) {
  const ui = useUi()
  const t = enc(ctx.tenant.slug)
  const base = `/api/t/${t}/resources/${resourceId}`
  const [res, setRes] = useState<ResourceMeta | null>(null)
  const [grants, setGrants] = useState<Grant[]>([])
  const [links, setLinks] = useState<LinkInfo[]>([])
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Principal[]>([])
  const [pick, setPick] = useState<Principal | null>(null)
  const [level, setLevel] = useState<Level>('read')
  const [days, setDays] = useState(ctx.tenant.settings.public_link_max_days || 7)
  const [pw, setPw] = useState('')
  const [created, setCreated] = useState<LinkInfo | null>(null)
  const [owner, setOwner] = useState<Principal | null>(null)
  const linksEnabled = ctx.tenant.settings.public_links_enabled

  const load = useCallback(async () => {
    try {
      const g = await api<{ resource: ResourceMeta; grants: Grant[] }>('GET', `${base}/grants`)
      setRes(g.resource)
      setGrants(g.grants)
      if (linksEnabled) setLinks(await api<LinkInfo[]>('GET', `${base}/links`))
    } catch (e) {
      setError(errText(e))
    }
  }, [base, linksEnabled])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!q.trim()) {
      setFound([])
      return
    }
    const h = setTimeout(() => {
      api<Principal[]>('GET', `/api/t/${t}/directory?q=${enc(q.trim())}`)
        .then(setFound)
        .catch(() => setFound([]))
    }, 200)
    return () => clearTimeout(h)
  }, [q, t])

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setError('')
    try {
      await fn()
      if (ok) ui.toast(ok)
      await load()
    } catch (e) {
      setError(errText(e))
    }
  }

  const setGrant = (p: { principal_type: string; principal_id: string }, l: Level | null) =>
    run(() => api('PUT', `${base}/grants`, { ...p, level: l }), l ? 'condivisione aggiornata' : 'accesso revocato')

  const candidates = found.filter((p) => p.id !== res?.owner_id && !grants.some((g) => g.principal_id === p.id))

  return (
    <Modal title="Condivisione" onClose={onClose} width={760}>
      {res && (
        <p className="muted" style={{ marginBottom: 14 }}>
          <b style={{ color: 'var(--fg)' }}>{res.title || '(senza titolo)'}</b> · proprietario {res.owner_name}
        </p>
      )}
      <div className="share-grid">
        <section className="card">
          <h3>Persone e gruppi del tenant</h3>
          <div className="row">
            <div className="picker grow">
              <input
                type="search"
                placeholder="Cerca utenti o gruppi…"
                value={pick ? `${pick.name} (${pick.detail})` : q}
                onChange={(e) => {
                  setPick(null)
                  setQ(e.target.value)
                }}
                aria-label="Cerca utenti o gruppi"
              />
              {!pick && candidates.length > 0 && (
                <div className="picker-list">
                  {candidates.map((p) => (
                    <button
                      type="button"
                      key={p.kind + p.id}
                      onClick={() => {
                        setPick(p)
                        setFound([])
                      }}
                    >
                      <span>
                        {p.kind === 'group' ? '👥 ' : '👤 '}
                        {p.name}
                      </span>
                      <span className="muted mono">{p.detail}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select value={level} onChange={(e) => setLevel(e.target.value as Level)} style={{ width: 'auto' }} aria-label="Livello">
              {LEVELS.map((l) => (
                <option key={l.v} value={l.v}>
                  {l.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn primary"
              disabled={!pick}
              onClick={() =>
                pick &&
                void setGrant({ principal_type: pick.kind, principal_id: pick.id }, level).then(() => {
                  setPick(null)
                  setQ('')
                })
              }
            >
              Condividi
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {LEVELS.map((l) => `${l.label}: ${l.hint}`).join(' · ')}. Chi non appartiene al tenant va prima invitato dal Tenant Manager.
          </p>
          <div className="tbl-wrap" style={{ marginTop: 10 }}>
            <table className="tbl">
              <tbody>
                {grants.length === 0 && (
                  <tr>
                    <td className="empty">Non condiviso con nessuno.</td>
                  </tr>
                )}
                {grants.map((g) => (
                  <tr key={g.principal_type + g.principal_id}>
                    <td>
                      {g.principal_type === 'group' ? '👥 ' : '👤 '}
                      {g.name} <span className="muted mono">{g.detail}</span>
                    </td>
                    <td className="actions">
                      <select
                        value={g.level}
                        onChange={(e) => void setGrant(g, e.target.value as Level)}
                        aria-label={`Livello di ${g.name}`}
                      >
                        {LEVELS.map((l) => (
                          <option key={l.v} value={l.v}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn ghost small" onClick={() => void setGrant(g, null)}>
                        Revoca
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h3>Link pubblico (sola lettura)</h3>
          {!linksEnabled ? (
            <p className="muted">I link pubblici sono disattivati per questo tenant.</p>
          ) : (
            <>
              <div className="form-grid">
                <div>
                  <label htmlFor="ld">Scadenza (giorni)</label>
                  <input
                    id="ld"
                    type="number"
                    min={1}
                    max={ctx.tenant.settings.public_link_max_days || 3650}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label htmlFor="lpw">Password (facoltativa)</label>
                  <input id="lpw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                </div>
                <div>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() =>
                      void run(async () => {
                        const l = await api<LinkInfo>('POST', `${base}/links`, { days, password: pw || null })
                        setCreated(l)
                        setPw('')
                      }, 'link creato')
                    }
                  >
                    Crea link
                  </button>
                </div>
              </div>
              {created?.url && (
                <div style={{ marginTop: 12 }}>
                  <div className="link-box">
                    <input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} aria-label="Link pubblico" />
                    <button type="button" className="btn ghost" onClick={() => void navigator.clipboard?.writeText(created.url!).then(() => ui.toast('link copiato'))}>
                      Copia
                    </button>
                  </div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Il link e' mostrato solo ora: il server ne conserva solo un'impronta. Per rivederlo creane uno nuovo.
                  </p>
                </div>
              )}
              {links.length > 0 && (
                <div className="tbl-wrap" style={{ marginTop: 12 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Creato</th>
                        <th>Scade</th>
                        <th>Visite</th>
                        <th>Password</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {links.map((l) => (
                        <tr key={l.id}>
                          <td>
                            {fmtDate(l.created_at)} <span className="muted">{l.created_by}</span>
                          </td>
                          <td>{l.expires_at ? fmtDate(l.expires_at) : 'mai'}{!l.active && <span className="badge err">scaduto</span>}</td>
                          <td className="num">{l.view_count}</td>
                          <td>{l.has_password ? 'sì' : 'no'}</td>
                          <td className="actions">
                            <button type="button" className="btn ghost small" onClick={() => void run(() => api('DELETE', `/api/t/${t}/links/${l.id}`), 'link revocato')}>
                              Revoca
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>

        {res && (res.is_owner || ctx.tenant.role === 'tenant_manager') && (
          <section className="card">
            <h3>Proprieta'</h3>
            <div className="row">
              <div className="picker grow">
                <input
                  type="search"
                  placeholder="Nuovo proprietario…"
                  value={owner ? `${owner.name} (${owner.detail})` : ''}
                  onChange={(e) => {
                    setOwner(null)
                    setQ(e.target.value)
                  }}
                  aria-label="Nuovo proprietario"
                />
              </div>
              <select
                value={owner?.id ?? ''}
                onChange={(e) => setOwner(found.find((f) => f.id === e.target.value) ?? null)}
                style={{ width: 'auto' }}
                aria-label="Scegli il nuovo proprietario"
              >
                <option value="">— cerca sopra —</option>
                {found
                  .filter((p) => p.kind === 'user' && p.id !== res.owner_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.detail})
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="btn danger"
                disabled={!owner}
                onClick={async () => {
                  if (!owner || !(await ui.confirm(`Trasferire la proprieta' a ${owner.name}?`, true))) return
                  await run(() => api('POST', `${base}/owner`, { user_id: owner.id }), 'proprieta\' trasferita')
                  setOwner(null)
                }}
              >
                Trasferisci
              </button>
            </div>
          </section>
        )}
      </div>
      <div className={'msg-line' + (error ? ' err' : '')}>{error}</div>
    </Modal>
  )
}
