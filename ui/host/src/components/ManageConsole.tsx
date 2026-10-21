import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, enc, errText, fmtBytes, fmtDate } from '../api.ts'
import type { Group, Invitation, Member, ResourceRow, Role, TenantContext, TenantKpi, TenantSettings } from '../types.ts'
import { useUi } from '../ui-context.ts'
import { TenantKpiView } from './Kpi.tsx'
import { roleLabel } from '../roles.ts'

type Tab = 'members' | 'invitations' | 'groups' | 'resources' | 'kpi' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'members', label: 'Membri' },
  { id: 'invitations', label: 'Inviti' },
  { id: 'groups', label: 'Gruppi' },
  { id: 'resources', label: 'Risorse' },
  { id: 'kpi', label: 'KPI' },
  { id: 'settings', label: 'Impostazioni' },
]

interface Props {
  ctx: TenantContext
  onChanged: () => void
}

export default function ManageConsole({ ctx, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('members')
  const base = `/api/t/${enc(ctx.tenant.slug)}/manage`
  return (
    <div className="console">
      <h1>Gestione di {ctx.tenant.name}</h1>
      <p className="lead">Utenti, inviti, gruppi e policy del tenant. Il gestore vede i metadati e i KPI delle risorse, mai il loro contenuto.</p>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={'tab' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'members' && <Members base={base} />}
      {tab === 'invitations' && <Invitations base={base} />}
      {tab === 'groups' && <Groups base={base} />}
      {tab === 'resources' && <Resources base={base} ctx={ctx} />}
      {tab === 'kpi' && <Kpi base={base} />}
      {tab === 'settings' && <Settings base={base} settings={ctx.tenant.settings} onChanged={onChanged} />}
    </div>
  )
}

function useList<T>(url: string) {
  const [items, setItems] = useState<T[]>([])
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    try {
      setItems(await api<T[]>('GET', url))
      setError('')
    } catch (e) {
      setError(errText(e))
    }
  }, [url])
  useEffect(() => {
    void reload()
  }, [reload])
  return { items, error, reload, setError }
}

function Msg({ text }: { text: string }) {
  return <div className={'msg-line' + (text ? ' err' : '')}>{text}</div>
}

function Members({ base }: { base: string }) {
  const ui = useUi()
  const { items, error, reload, setError } = useList<Member>(`${base}/members`)
  const [form, setForm] = useState({ username: '', display_name: '', password: '', role: 'user' as Role })
  const [removing, setRemoving] = useState<Member | null>(null)
  const [newOwner, setNewOwner] = useState('')

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn()
      ui.toast(ok)
      await reload()
    } catch (e) {
      setError(errText(e))
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    await run(() => api('POST', `${base}/members`, form), `utente ${form.username} creato`)
    setForm({ username: '', display_name: '', password: '', role: 'user' })
  }

  return (
    <>
      <section className="card">
        <h3>Nuovo utente del tenant</h3>
        <form className="form-grid" onSubmit={(e) => void create(e)}>
          <div>
            <label htmlFor="nu">Username</label>
            <input id="nu" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div>
            <label htmlFor="nd">Nome visualizzato</label>
            <input id="nd" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="np">Password iniziale</label>
            <input id="np" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div>
            <label htmlFor="nr">Ruolo</label>
            <select id="nr" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="user">User</option>
              <option value="tenant_manager">Tenant Manager</option>
            </select>
          </div>
          <div>
            <button className="btn primary" type="submit">
              Crea utente
            </button>
          </div>
        </form>
      </section>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Utente</th>
              <th>Tenant di appartenenza</th>
              <th>Ruolo</th>
              <th>Risorse</th>
              <th>Dal</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.user_id}>
                <td>
                  {m.display_name || m.username} <span className="muted mono">{m.username}</span>
                  {m.status !== 'active' && <span className="badge err">disabilitato</span>}
                </td>
                <td>
                  {m.home_tenant}
                  {m.is_guest && <span className="badge acc">ospite</span>}
                </td>
                <td>
                  <select value={m.role} onChange={(e) => void run(() => api('PUT', `${base}/members/${m.user_id}/role`, { role: e.target.value }), 'ruolo aggiornato')} aria-label={`Ruolo di ${m.username}`}>
                    <option value="user">User</option>
                    <option value="tenant_manager">Tenant Manager</option>
                  </select>
                </td>
                <td className="num">{m.owned_resources}</td>
                <td>{fmtDate(m.joined_at)}</td>
                <td className="actions">
                  {!m.is_guest && (
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={async () => {
                        const pw = window.prompt(`Nuova password per ${m.username} (almeno 10 caratteri):`)
                        if (pw) await run(() => api('POST', `${base}/members/${m.user_id}/password`, { password: pw }), 'password reimpostata')
                      }}
                    >
                      Password
                    </button>
                  )}
                  <button type="button" className="btn danger small" onClick={() => setRemoving(m)}>
                    Rimuovi
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {removing && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Rimuovi {removing.username}</h3>
          <p className="muted" style={{ marginBottom: 10 }}>
            {removing.is_guest
              ? 'L\'ospite perde l\'accesso a questo tenant.'
              : 'Questo e\' il suo tenant di appartenenza: l\'account verra\' disabilitato e non potra\' piu\' accedere.'}{' '}
            {removing.owned_resources > 0 && `Possiede ${removing.owned_resources} risorse: scegli a chi riassegnarle.`}
          </p>
          <div className="row">
            {removing.owned_resources > 0 && (
              <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)} style={{ width: 'auto' }} aria-label="Nuovo proprietario">
                <option value="">— nuovo proprietario —</option>
                {items
                  .filter((m) => m.user_id !== removing.user_id && m.status === 'active')
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name || m.username}
                    </option>
                  ))}
              </select>
            )}
            <button
              type="button"
              className="btn danger"
              disabled={removing.owned_resources > 0 && !newOwner}
              onClick={() =>
                void run(
                  () => api('DELETE', `${base}/members/${removing.user_id}${newOwner ? `?new_owner=${newOwner}` : ''}`),
                  `${removing.username} rimosso`,
                ).then(() => {
                  setRemoving(null)
                  setNewOwner('')
                })
              }
            >
              Conferma rimozione
            </button>
            <button type="button" className="btn ghost" onClick={() => setRemoving(null)}>
              Annulla
            </button>
          </div>
        </section>
      )}
      <Msg text={error} />
    </>
  )
}

function Invitations({ base }: { base: string }) {
  const ui = useUi()
  const { items, error, reload, setError } = useList<Invitation>(`${base}/invitations`)
  const [form, setForm] = useState({ tenant: '', username: '', role: 'user' as Role })
  async function invite(e: FormEvent) {
    e.preventDefault()
    try {
      await api('POST', `${base}/invitations`, form)
      ui.toast(`invito inviato a ${form.username}@${form.tenant}`)
      setForm({ tenant: '', username: '', role: 'user' })
      await reload()
    } catch (err) {
      setError(errText(err))
    }
  }
  return (
    <>
      <section className="card">
        <h3>Invita un utente di un altro tenant</h3>
        <p className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
          L'utente continua ad autenticarsi sul proprio tenant di appartenenza; dopo aver accettato vedra' questo tenant nel selettore.
        </p>
        <form className="form-grid" onSubmit={(e) => void invite(e)}>
          <div>
            <label htmlFor="it">Tenant di appartenenza</label>
            <input id="it" required value={form.tenant} onChange={(e) => setForm({ ...form, tenant: e.target.value })} />
          </div>
          <div>
            <label htmlFor="iu">Username</label>
            <input id="iu" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div>
            <label htmlFor="ir">Ruolo</label>
            <select id="ir" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="user">User</option>
              <option value="tenant_manager">Tenant Manager</option>
            </select>
          </div>
          <div>
            <button className="btn primary" type="submit">
              Invita
            </button>
          </div>
        </form>
      </section>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Utente</th>
              <th>Ruolo</th>
              <th>Stato</th>
              <th>Invitato da</th>
              <th>Scade</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td className="empty" colSpan={6}>
                  Nessun invito.
                </td>
              </tr>
            )}
            {items.map((i) => (
              <tr key={i.id}>
                <td className="mono">{i.user}</td>
                <td>{roleLabel(i.role)}</td>
                <td>
                  <span className={'badge' + (i.status === 'accepted' ? ' ok' : i.status === 'pending' ? ' acc' : '')}>{i.status}</span>
                </td>
                <td>{i.invited_by ?? '—'}</td>
                <td>{fmtDate(i.expires_at)}</td>
                <td className="actions">
                  {i.status === 'pending' && (
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() =>
                        void api('DELETE', `${base}/invitations/${i.id}`)
                          .then(reload)
                          .catch((e) => setError(errText(e)))
                      }
                    >
                      Revoca
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Msg text={error} />
    </>
  )
}

function Groups({ base }: { base: string }) {
  const ui = useUi()
  const { items, error, reload, setError } = useList<Group>(`${base}/groups`)
  const members = useList<Member>(`${base}/members`)
  const [name, setName] = useState('')
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <>
      <section className="card">
        <h3>Nuovo gruppo</h3>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => api('POST', `${base}/groups`, { name })).then(() => setName(''))
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Ufficio tecnico" required style={{ maxWidth: 320 }} aria-label="Nome del gruppo" />
          <button className="btn primary" type="submit">
            Crea
          </button>
        </form>
      </section>
      {items.map((g) => (
        <section className="card" key={g.id}>
          <div className="row" style={{ marginBottom: 10 }}>
            <b>👥 {g.name}</b>
            <span className="muted">{g.members.length} membri</span>
            <span className="grow" />
            <select
              value=""
              onChange={(e) => e.target.value && void run(() => api('PUT', `${base}/groups/${g.id}/members/${e.target.value}`))}
              style={{ width: 'auto' }}
              aria-label={`Aggiungi a ${g.name}`}
            >
              <option value="">＋ aggiungi membro</option>
              {members.items
                .filter((m) => !g.members.some((x) => x.user_id === m.user_id))
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name || m.username}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="btn danger small"
              onClick={async () => {
                if (await ui.confirm(`Eliminare il gruppo ${g.name}? Le condivisioni con il gruppo verranno revocate.`, true)) {
                  await run(() => api('DELETE', `${base}/groups/${g.id}`))
                }
              }}
            >
              Elimina
            </button>
          </div>
          <div className="row">
            {g.members.length === 0 && <span className="muted">nessun membro</span>}
            {g.members.map((m) => (
              <span className="badge" key={m.user_id}>
                {m.display_name || m.username}{' '}
                <button type="button" className="linklike" aria-label={`Togli ${m.username}`} onClick={() => void run(() => api('DELETE', `${base}/groups/${g.id}/members/${m.user_id}`))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        </section>
      ))}
      <Msg text={error || members.error} />
    </>
  )
}

function Resources({ base, ctx }: { base: string; ctx: TenantContext }) {
  const ui = useUi()
  const members = useList<Member>(`${base}/members`)
  const [filter, setFilter] = useState({ owner: '', plugin: '', q: '' })
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString()
  const { items, error, reload, setError } = useList<ResourceRow>(`${base}/resources${qs ? '?' + qs : ''}`)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const pluginLabel = (id: string) => ctx.plugins.find((p) => p.id === id)?.label ?? id
  return (
    <>
      <section className="card">
        <h3>Filtri</h3>
        <div className="form-grid">
          <div>
            <label htmlFor="fo">Proprietario</label>
            <select id="fo" value={filter.owner} onChange={(e) => setFilter({ ...filter, owner: e.target.value })}>
              <option value="">tutti</option>
              {members.items.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name || m.username}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fp">Plugin</label>
            <select id="fp" value={filter.plugin} onChange={(e) => setFilter({ ...filter, plugin: e.target.value })}>
              <option value="">tutti</option>
              {ctx.plugins.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {ctx.tenant.settings.managers_see_titles && (
            <div>
              <label htmlFor="fq">Titolo</label>
              <input id="fq" type="search" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
            </div>
          )}
        </div>
      </section>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Risorsa</th>
              <th>Plugin</th>
              <th>Proprietario</th>
              <th>Dimensione</th>
              <th>Condivisioni</th>
              <th>Link</th>
              <th>Modificata</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td className="empty" colSpan={7}>
                  Nessuna risorsa.
                </td>
              </tr>
            )}
            {items.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.title || <span className="muted">(titolo nascosto)</span>} <span className="muted mono">{r.kind}</span>
                </td>
                <td>{pluginLabel(r.plugin_id)}</td>
                <td>
                  {r.owner_name}
                  {!r.owner_active && <span className="badge err">uscito</span>}
                </td>
                <td className="num">{fmtBytes(r.size_bytes)}</td>
                <td className="num">{r.shares}</td>
                <td className="num">{r.public_links}</td>
                <td>{fmtDate(r.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h3>Riassegna tutte le risorse di un utente</h3>
        <div className="row">
          <select value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} aria-label="Da">
            <option value="">— da —</option>
            {[...new Map(items.map((r) => [r.owner_id, r.owner_name])).entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <span className="muted">→</span>
          <select value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} aria-label="A">
            <option value="">— a —</option>
            {members.items
              .filter((m) => m.status === 'active')
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name || m.username}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="btn primary"
            disabled={!from || !to || from === to}
            onClick={async () => {
              try {
                const r = await api<{ reassigned: number }>('POST', `${base}/resources/reassign`, { from, to })
                ui.toast(`${r.reassigned} risorse riassegnate`)
                await reload()
              } catch (e) {
                setError(errText(e))
              }
            }}
          >
            Riassegna
          </button>
        </div>
      </section>
      <Msg text={error} />
    </>
  )
}

function Kpi({ base }: { base: string }) {
  const [k, setK] = useState<TenantKpi | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<TenantKpi>('GET', `${base}/kpi`).then(setK).catch((e) => setError(errText(e)))
  }, [base])
  return (
    <>
      {k ? <TenantKpiView k={k} /> : <p className="muted">caricamento…</p>}
      <Msg text={error} />
    </>
  )
}

function Settings({ base, settings, onChanged }: { base: string; settings: TenantSettings; onChanged: () => void }) {
  const ui = useUi()
  const [s, setS] = useState(settings)
  const [error, setError] = useState('')
  return (
    <section className="card" style={{ maxWidth: 640 }}>
      <h3>Policy del tenant</h3>
      <div className="field">
        <label>
          <input type="checkbox" checked={s.public_links_enabled} onChange={(e) => setS({ ...s, public_links_enabled: e.target.checked })} /> Link pubblici consentiti
        </label>
      </div>
      <div className="field">
        <label htmlFor="md">Durata massima dei link (giorni, 0 = nessun limite)</label>
        <input id="md" type="number" min={0} max={3650} value={s.public_link_max_days} onChange={(e) => setS({ ...s, public_link_max_days: Number(e.target.value) })} style={{ maxWidth: 160 }} />
      </div>
      <div className="field">
        <label>
          <input type="checkbox" checked={s.managers_see_titles} onChange={(e) => setS({ ...s, managers_see_titles: e.target.checked })} /> I gestori vedono i titoli delle risorse
        </label>
      </div>
      <button
        type="button"
        className="btn primary"
        onClick={async () => {
          try {
            await api('PUT', `${base}/settings`, s)
            ui.toast('impostazioni salvate')
            onChanged()
          } catch (e) {
            setError(errText(e))
          }
        }}
      >
        Salva
      </button>
      <Msg text={error} />
    </section>
  )
}
