import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, errText, fmtBytes, fmtDate } from '../api.ts'
import { ROLE_LABEL } from '../roles.ts'
import type { AdminPlugin, AdminUser, CatalogItem, GlobalKpi, Member, Role, Session, TenantInfo } from '../types.ts'
import { useUi } from '../ui-context.ts'
import { GlobalKpiView } from './Kpi.tsx'

type Tab = 'tenants' | 'admins' | 'plugins' | 'kpi'

export default function AdminConsole({ session, onPluginsChanged }: { session: Session; onPluginsChanged: () => void }) {
  const [tab, setTab] = useState<Tab>('tenants')
  return (
    <div className="console">
      <h1>Amministrazione di sistema</h1>
      <p className="lead">Tenant e loro gestori, Administrator, plugin installati e KPI di tutta l'installazione. Anche qui: metadati e aggregati, mai i contenuti.</p>
      <div className="tabs" role="tablist">
        {(
          [
            ['tenants', 'Tenant'],
            ['admins', 'Administrator'],
            ['plugins', 'Plugin'],
            ['kpi', 'KPI globali'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={'tab' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'tenants' && <Tenants />}
      {tab === 'admins' && <Admins me={session.user.user_id} />}
      {tab === 'plugins' && <Plugins onChanged={onPluginsChanged} />}
      {tab === 'kpi' && <Kpi />}
    </div>
  )
}

/** Account Administrator: del tenant di sistema, con accesso a parte e secondo fattore. */
function Admins({ me }: { me: string }) {
  const ui = useUi()
  const [items, setItems] = useState<AdminUser[]>([])
  const [error, setError] = useState('')
  const [f, setF] = useState({ username: '', display_name: '', password: '' })
  const [resetFor, setResetFor] = useState<string | null>(null)
  const [newPw, setNewPw] = useState('')
  const reload = useCallback(() => api<AdminUser[]>('GET', '/api/admin/administrators').then(setItems).catch((e) => setError(errText(e))), [])
  useEffect(() => {
    void reload()
  }, [reload])

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError('')
    try {
      const r = await fn()
      if (Array.isArray(r)) setItems(r as AdminUser[])
      ui.toast(ok)
      return true
    } catch (e) {
      setError(errText(e))
      return false
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (await run(() => api('POST', '/api/admin/administrators', f), `Administrator ${f.username} creato`)) setF({ username: '', display_name: '', password: '' })
  }

  async function resetPassword(e: FormEvent, a: AdminUser) {
    e.preventDefault()
    if (await run(() => api('POST', `/api/admin/administrators/${a.user_id}/password`, { password: newPw }), `password di ${a.username} reimpostata`)) {
      setResetFor(null)
      setNewPw('')
    }
  }

  return (
    <>
      <section className="card">
        <h3>Nuovo Administrator</h3>
        <p className="muted">
          Gli Administrator sono account di piattaforma: accedono da <b>Accesso amministratori</b>, sempre con utente e password locali e il secondo fattore, e non
          lavorano nei tenant. Chi e' anche Tenant Manager o User di un tenant usa la' un account separato.
        </p>
        <form className="form-grid" onSubmit={(e) => void add(e)}>
          <div>
            <label htmlFor="aa-u">Username</label>
            <input id="aa-u" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
          </div>
          <div>
            <label htmlFor="aa-n">Nome</label>
            <input id="aa-n" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="aa-p">Password iniziale</label>
            <input id="aa-p" type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
          </div>
          <div>
            <button type="submit" className="btn primary">
              Crea
            </button>
          </div>
        </form>
      </section>
      <section className="card">
        <h3>Administrator</h3>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Utente</th>
                <th>Stato</th>
                <th>Secondo fattore</th>
                <th>Creato</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.user_id}>
                  <td>
                    {a.display_name || a.username} <span className="muted mono">{a.username}</span>
                    {a.user_id === me && <span className="badge acc">tu</span>}
                  </td>
                  <td>{a.status === 'active' ? <span className="badge ok">attivo</span> : <span className="badge err">disabilitato</span>}</td>
                  <td>{a.totp ? <span className="badge ok">attivo</span> : <span className="badge">da registrare</span>}</td>
                  <td>{fmtDate(a.created_at)}</td>
                  <td className="actions">
                    {a.user_id !== me && (
                      <>
                        {resetFor === a.user_id ? (
                          <form className="inline-form" onSubmit={(e) => void resetPassword(e, a)}>
                            <input
                              type="password"
                              autoComplete="new-password"
                              minLength={10}
                              placeholder="nuova password"
                              aria-label={`Nuova password di ${a.username}`}
                              value={newPw}
                              onChange={(e) => setNewPw(e.target.value)}
                              required
                            />
                            <button type="submit" className="btn primary small">
                              Salva
                            </button>
                            <button type="button" className="btn ghost small" onClick={() => setResetFor(null)}>
                              Annulla
                            </button>
                          </form>
                        ) : (
                          <button type="button" className="btn ghost small" onClick={() => (setResetFor(a.user_id), setNewPw(''))}>
                            Reimposta password
                          </button>
                        )}
                        {a.totp && (
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={async () => {
                              if (await ui.confirm(`Togliere il secondo fattore a ${a.username}? Al prossimo accesso registrera' di nuovo l'app.`, true))
                                await run(() => api('DELETE', `/api/admin/administrators/${a.user_id}/totp`), `secondo fattore di ${a.username} rimosso`)
                            }}
                          >
                            Reimposta 2FA
                          </button>
                        )}
                        <button
                          type="button"
                          className={'btn small ' + (a.status === 'active' ? 'danger' : 'ghost')}
                          onClick={async () => {
                            const active = a.status !== 'active'
                            if (!active && !(await ui.confirm(`Disabilitare ${a.username}? Le sue sessioni verranno chiuse.`, true))) return
                            await run(() => api('PUT', `/api/admin/administrators/${a.user_id}/status`, { active }), active ? `${a.username} riattivato` : `${a.username} disabilitato`)
                          }}
                        >
                          {a.status === 'active' ? 'Disabilita' : 'Riattiva'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className={'msg-line' + (error ? ' err' : '')}>{error}</div>
    </>
  )
}

/**
 * Utenti di un tenant visti dall'Administrator: ruoli e accesso, mai i contenuti. Serve a
 * nominare o sostituire un Tenant Manager e a sbloccare una password.
 */
function TenantUsers({ tenant, onChanged }: { tenant: TenantInfo; onChanged: () => void }) {
  const ui = useUi()
  const [items, setItems] = useState<Member[]>([])
  const [error, setError] = useState('')
  const [f, setF] = useState({ username: '', display_name: '', password: '' })
  const [resetFor, setResetFor] = useState<string | null>(null)
  const [newPw, setNewPw] = useState('')
  const base = `/api/admin/tenants/${tenant.id}`
  const reload = useCallback(() => api<Member[]>('GET', `${base}/members`).then(setItems).catch((e) => setError(errText(e))), [base])
  useEffect(() => {
    void reload()
  }, [reload])

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError('')
    try {
      const r = await fn()
      if (Array.isArray(r)) setItems(r as Member[])
      ui.toast(ok)
      onChanged()
      return true
    } catch (e) {
      setError(errText(e))
      return false
    }
  }

  return (
    <div className="tenant-users">
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Utente</th>
              <th>Ruolo</th>
              <th>Stato</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.user_id}>
                <td>
                  {m.display_name || m.username} <span className="muted mono">{m.username}@{m.home_tenant}</span>
                  {m.is_guest && <span className="badge">ospite</span>}
                </td>
                <td>
                  <select
                    value={m.role}
                    aria-label={`Ruolo di ${m.username}`}
                    onChange={(e) => void run(() => api('PUT', `${base}/members/${m.user_id}/role`, { role: e.target.value }), `ruolo di ${m.username} aggiornato`)}
                  >
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{m.status === 'active' ? <span className="badge ok">attivo</span> : <span className="badge err">disabilitato</span>}</td>
                <td className="actions">
                  {!m.is_guest &&
                    (resetFor === m.user_id ? (
                      <form
                        className="inline-form"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void run(() => api('POST', `${base}/members/${m.user_id}/password`, { password: newPw }), `password di ${m.username} reimpostata`).then(
                            (ok) => ok && setResetFor(null),
                          )
                        }}
                      >
                        <input
                          type="password"
                          autoComplete="new-password"
                          minLength={10}
                          placeholder="nuova password"
                          aria-label={`Nuova password di ${m.username}`}
                          value={newPw}
                          onChange={(e) => setNewPw(e.target.value)}
                          required
                        />
                        <button type="submit" className="btn primary small">
                          Salva
                        </button>
                        <button type="button" className="btn ghost small" onClick={() => setResetFor(null)}>
                          Annulla
                        </button>
                      </form>
                    ) : (
                      <button type="button" className="btn ghost small" onClick={() => (setResetFor(m.user_id), setNewPw(''))}>
                        Reimposta password
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => api('POST', `${base}/managers`, f), `Tenant Manager ${f.username} creato`).then((ok) => ok && setF({ username: '', display_name: '', password: '' }))
        }}
      >
        <div>
          <label htmlFor={`nm-u-${tenant.id}`}>Nuovo Tenant Manager: username</label>
          <input id={`nm-u-${tenant.id}`} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
        </div>
        <div>
          <label htmlFor={`nm-n-${tenant.id}`}>Nome</label>
          <input id={`nm-n-${tenant.id}`} value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`nm-p-${tenant.id}`}>Password iniziale</label>
          <input
            id={`nm-p-${tenant.id}`}
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
            required
          />
        </div>
        <div>
          <button type="submit" className="btn primary">
            Crea
          </button>
        </div>
      </form>
      <div className={'msg-line' + (error ? ' err' : '')}>{error}</div>
    </div>
  )
}

function Tenants() {
  const ui = useUi()
  const [items, setItems] = useState<TenantInfo[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [f, setF] = useState({ slug: '', name: '', manager_username: '', manager_display_name: '', manager_password: '' })
  const reload = useCallback(() => api<TenantInfo[]>('GET', '/api/admin/tenants').then(setItems).catch((e) => setError(errText(e))), [])
  useEffect(() => {
    void reload()
  }, [reload])
  async function create(e: FormEvent) {
    e.preventDefault()
    try {
      await api('POST', '/api/admin/tenants', f)
      ui.toast(`tenant ${f.slug} creato`)
      setF({ slug: '', name: '', manager_username: '', manager_display_name: '', manager_password: '' })
      await reload()
    } catch (err) {
      setError(errText(err))
    }
  }
  return (
    <>
      <section className="card">
        <h3>Nuovo tenant con il suo Tenant Manager</h3>
        <form className="form-grid" onSubmit={(e) => void create(e)}>
          <div>
            <label htmlFor="ts">Slug</label>
            <input id="ts" required pattern="[a-z0-9][a-z0-9-]{1,39}" placeholder="es. comune-roma" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />
          </div>
          <div>
            <label htmlFor="tn">Nome</label>
            <input id="tn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="tm">Username del Tenant Manager</label>
            <input id="tm" required value={f.manager_username} onChange={(e) => setF({ ...f, manager_username: e.target.value })} />
          </div>
          <div>
            <label htmlFor="td">Nome del Tenant Manager</label>
            <input id="td" value={f.manager_display_name} onChange={(e) => setF({ ...f, manager_display_name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="tp">Password del Tenant Manager</label>
            <input id="tp" type="password" autoComplete="new-password" minLength={10} required value={f.manager_password} onChange={(e) => setF({ ...f, manager_password: e.target.value })} />
          </div>
          <div>
            <button className="btn primary" type="submit">
              Crea tenant
            </button>
          </div>
        </form>
      </section>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Membri</th>
              <th>Ospiti</th>
              <th>Risorse</th>
              <th>Spazio</th>
              <th>Creato</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td className="empty" colSpan={7}>
                  Nessun tenant: creane uno qui sopra.
                </td>
              </tr>
            )}
            {items.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <td>
                    {t.name} <span className="muted mono">{t.slug}</span>
                    {t.status === 'suspended' && <span className="badge err">sospeso</span>}
                  </td>
                  <td className="num">{t.members}</td>
                  <td className="num">{t.guests}</td>
                  <td className="num">{t.resources}</td>
                  <td className="num">{fmtBytes(t.bytes)}</td>
                  <td>{fmtDate(t.created_at)}</td>
                  <td className="actions">
                    <button type="button" className="btn ghost small" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
                      Utenti e gestori
                    </button>
                    <button
                      type="button"
                      className={'btn small ' + (t.status === 'active' ? 'danger' : 'ghost')}
                      onClick={async () => {
                        const next = t.status === 'active' ? 'suspended' : 'active'
                        if (next === 'suspended' && !(await ui.confirm(`Sospendere ${t.name}? I suoi utenti non potranno piu' accedere.`, true))) return
                        try {
                          await api('PUT', `/api/admin/tenants/${t.id}/status`, { status: next })
                          await reload()
                        } catch (e) {
                          setError(errText(e))
                        }
                      }}
                    >
                      {t.status === 'active' ? 'Sospendi' : 'Riattiva'}
                    </button>
                  </td>
                </tr>
                {open === t.id && (
                  <tr className="row-detail">
                    <td colSpan={7}>
                      <TenantUsers tenant={t} onChanged={() => void reload()} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className={'msg-line' + (error ? ' err' : '')}>{error}</div>
    </>
  )
}

function Plugins({ onChanged }: { onChanged: () => void }) {
  const ui = useUi()
  const [items, setItems] = useState<AdminPlugin[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    try {
      setItems(await api<AdminPlugin[]>('GET', '/api/admin/plugins'))
      setCatalog(await api<CatalogItem[]>('GET', '/api/admin/catalog'))
    } catch (e) {
      setError(errText(e))
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  async function run(fn: () => Promise<unknown>, ok: string) {
    setError('')
    try {
      await fn()
      ui.toast(ok)
      await reload()
      onChanged()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Plugin</th>
              <th>Versione</th>
              <th>Stato</th>
              <th>Firma</th>
              <th>Permessi</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td className="empty" colSpan={6}>
                  Nessun plugin installato.
                </td>
              </tr>
            )}
            {items.map((p) => (
              <tr key={p.id}>
                <td>
                  <span aria-hidden="true">{p.icon}</span> {p.name} <span className="muted mono">{p.id}</span>
                  {p.dev && <span className="badge acc">sviluppo</span>}
                </td>
                <td className="mono">{p.version}</td>
                <td>
                  <span className={'badge ' + (p.status === 'active' ? 'ok' : p.status === 'blocked' ? 'err' : '')}>{p.status}</span>
                </td>
                <td className="mono" title={p.signed_by ?? ''}>
                  {p.signed_by ? p.signed_by.slice(0, 10) + '…' : p.dev ? '—' : 'non firmato'}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {[
                    p.has_logic && 'logica WASM',
                    p.permissions.hooks.length > 0 && `hook: ${p.permissions.hooks.join(', ')}`,
                    p.permissions.files && 'file',
                    p.permissions.content && 'contenuti',
                    p.permissions.network.length > 0 && `rete: ${p.permissions.network.join(', ')}`,
                    p.permissions.frame_src.length > 0 && `iframe: ${p.permissions.frame_src.join(', ')}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
                <td className="actions">
                  {p.status === 'active' ? (
                    <button type="button" className="btn ghost small" onClick={() => void run(() => api('POST', `/api/admin/plugins/${p.id}/deactivate`), `${p.name} disattivato`)}>
                      Disattiva
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn primary small"
                      disabled={p.status === 'blocked'}
                      onClick={() => void run(() => api('POST', `/api/admin/plugins/${p.id}/activate`), `${p.name} attivato`)}
                    >
                      Attiva
                    </button>
                  )}
                  {!p.dev && (
                    <button
                      type="button"
                      className="btn danger small"
                      onClick={async () => {
                        if (await ui.confirm(`Disinstallare ${p.name}? Tutte le sue risorse, in tutti i tenant, verranno eliminate.`, true)) {
                          await run(() => api('DELETE', `/api/admin/plugins/${p.id}`), `${p.name} disinstallato`)
                        }
                      }}
                    >
                      Disinstalla
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h3>Installa o aggiorna da pacchetto .mskp</h3>
        <div className="install-row">
          <input type="file" accept=".mskp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Pacchetto .mskp" />
          <button type="button" className="btn primary" disabled={!file} onClick={() => file && void run(() => api('POST', '/api/admin/plugins', undefined, { raw: file }), `${file.name} installato`)}>
            Installa
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Il pacchetto deve essere firmato da un editore fidato (trusted_keys). Il plugin installato resta disattivo finche' non lo attivi.
        </p>
      </section>
      {catalog.length > 0 && (
        <section className="card">
          <h3>Catalogo (registry)</h3>
          <div className="tbl-wrap">
            <table className="tbl">
              <tbody>
                {catalog.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span aria-hidden="true">{c.icon}</span> {c.name} <span className="muted mono">{c.id}</span>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {c.description}
                      </div>
                    </td>
                    <td className="mono">{c.installed ? `${c.installed} → ${c.latest}` : c.latest}</td>
                    <td className="actions">
                      {(!c.installed || c.update_available) && (
                        <button type="button" className="btn primary small" onClick={() => void run(() => api('POST', `/api/admin/catalog/${c.id}/install`), `${c.name} ${c.latest} installato`)}>
                          {c.installed ? 'Aggiorna' : 'Installa'}
                        </button>
                      )}
                      {c.installed && !c.update_available && <span className="badge ok">aggiornato</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className={'msg-line' + (error ? ' err' : '')}>{error}</div>
    </>
  )
}

function Kpi() {
  const [k, setK] = useState<GlobalKpi | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<GlobalKpi>('GET', '/api/admin/kpi').then(setK).catch((e) => setError(errText(e)))
  }, [])
  return (
    <>
      {k ? <GlobalKpiView k={k} /> : <p className="muted">caricamento…</p>}
      <div className={'msg-line' + (error ? ' err' : '')}>{error}</div>
    </>
  )
}
