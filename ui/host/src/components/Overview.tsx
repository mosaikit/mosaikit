import { useEffect, useState } from 'react'
import { api, enc, errText, fmtBytes, fmtDate } from '../api.ts'
import { ADMINISTRATOR, roleLabel } from '../roles.ts'
import type { Overview as Data, Session, TenantContext } from '../types.ts'

interface Props {
  session: Session
  ctx: TenantContext
  onOpen: (pluginId: string) => void
  onAccount: () => void
  onManage: () => void
  onAdmin: () => void
}

const LEVEL: Record<string, string> = { read: 'lettura', write: 'modifica', manage: 'gestione' }

/** Azioni registrate negli eventi del kernel, in parole. */
const ACTION: Record<string, string> = {
  login: 'accesso',
  'resource.create': 'hai creato',
  'resource.update': 'hai modificato',
  'resource.delete': 'hai eliminato',
  share: 'hai condiviso',
  unshare: 'hai revocato la condivisione di',
  'owner.transfer': 'hai trasferito la proprietà di',
  'owner.reassign': 'hai riassegnato',
  'link.create': 'hai creato un link pubblico per',
  'link.revoke': 'hai revocato un link pubblico di',
  'file.upload': 'hai caricato',
  'file.delete': 'hai eliminato',
  'content.upload': 'hai pubblicato',
  'member.create': 'hai creato un utente',
  'member.remove': 'hai rimosso un utente',
  'member.role': 'hai cambiato un ruolo',
  'invitation.create': 'hai inviato un invito',
  'invitation.accept': 'hai accettato un invito',
  'invitation.decline': 'hai rifiutato un invito',
  'tenant.settings': 'hai cambiato le impostazioni del tenant',
}

function actionText(a: string): string {
  return ACTION[a] ?? a.replace(/[._]/g, ' ')
}

function Card({ v, l, onClick }: { v: number | string; l: string; onClick?: () => void }) {
  const body = (
    <>
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </>
  )
  return onClick ? (
    <button type="button" className="kpi-card clickable" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="kpi-card">{body}</div>
  )
}

/**
 * Pagina iniziale dopo l'accesso: i numeri che contano per il ruolo dell'utente.
 * User: le proprie risorse e condivisioni; Tenant Manager: anche il tenant;
 * Administrator: anche tutto il sistema.
 */
export default function Overview({ session, ctx, onOpen, onAccount, onManage, onAdmin }: Props) {
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const slug = ctx.tenant.slug

  useEffect(() => {
    let live = true
    api<Data>('GET', `/api/t/${enc(slug)}/overview`)
      .then((x) => live && (setD(x), setError('')))
      .catch((e) => live && setError(errText(e)))
    return () => {
      live = false
    }
  }, [slug])

  const name = session.user.display_name || session.user.username
  const role = session.user.is_system_admin ? ADMINISTRATOR : roleLabel(ctx.tenant.role)
  const mine = d?.me.resources.reduce((s, r) => s + r.count, 0) ?? 0
  const mineBytes = d?.me.resources.reduce((s, r) => s + r.bytes, 0) ?? 0
  const tenantTotal = d?.tenant?.resources.reduce((s, r) => s + r.count, 0) ?? 0
  const tenantBytes = d?.tenant?.resources.reduce((s, r) => s + r.bytes, 0) ?? 0
  const max = Math.max(1, ...(d?.tenant?.activity ?? []).map((x) => x.events))

  return (
    <div className="console overview">
      <h1>Panoramica</h1>
      <p className="lead">
        Ciao {name} · <span className="badge acc">{role}</span>
        {session.user.is_system_admin && ctx.tenant.role === 'tenant_manager' && <> e {roleLabel(ctx.tenant.role)}</>} in <strong>{ctx.tenant.name}</strong>
      </p>

      {session.invitations > 0 && (
        <section className="card">
          <div className="row">
            <span>
              Hai {session.invitations} {session.invitations === 1 ? 'invito' : 'inviti'} in attesa per altri tenant.
            </span>
            <button type="button" className="btn primary small" onClick={onAccount}>
              Vedi inviti
            </button>
          </div>
        </section>
      )}

      {error && <div className="msg-line err">{error}</div>}
      {!d && !error && <p className="muted">caricamento…</p>}

      {d && (
        <>
          <h2 className="ov-title">Il tuo spazio</h2>
          <div className="kpi-cards">
            <Card v={mine} l="risorse tue" />
            <Card v={fmtBytes(mineBytes)} l="spazio occupato" />
            <Card v={d.me.shared_by_me} l="condivisioni che hai fatto" />
            <Card v={d.me.shared_with_me} l="risorse condivise con te" />
            <Card v={d.me.public_links} l="link pubblici attivi" />
            <Card v={d.me.link_views} l="visite ai tuoi link" />
          </div>

          <div className="ov-grid">
            <section className="card">
              <h3>Condivise con te di recente</h3>
              {d.me.recent_shares.length === 0 ? (
                <p className="muted">Nessuna risorsa condivisa con te in questo tenant.</p>
              ) : (
                <ul className="ov-list">
                  {d.me.recent_shares.map((s) => (
                    <li key={s.resource_id}>
                      <button type="button" className="linklike" onClick={() => onOpen(s.plugin_id)}>
                        {s.title || '(senza titolo)'}
                      </button>
                      <span className="muted">
                        {' '}
                        · {s.plugin} · da {s.owner} · {LEVEL[s.level] ?? s.level} · {fmtDate(s.granted_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card">
              <h3>La tua attività recente</h3>
              {d.me.activity.length === 0 ? (
                <p className="muted">Ancora nessuna attività in questo tenant.</p>
              ) : (
                <ul className="ov-list">
                  {d.me.activity.map((a, i) => (
                    <li key={i}>
                      <span>{actionText(a.action)}</span>
                      {a.title && <strong> {a.title}</strong>}
                      <span className="muted">
                        {a.plugin ? ` · ${a.plugin}` : ''} · {fmtDate(a.ts)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {d.tenant && (
            <>
              <h2 className="ov-title">
                Il tenant {ctx.tenant.name}{' '}
                <button type="button" className="btn ghost small" onClick={onManage}>
                  Gestione
                </button>
              </h2>
              <div className="kpi-cards">
                <Card v={d.tenant.members} l="membri" />
                <Card v={d.tenant.guests} l="ospiti" />
                <Card v={d.tenant.active_users_30d} l="utenti attivi (30 gg)" />
                <Card v={tenantTotal} l="risorse" />
                <Card v={fmtBytes(tenantBytes)} l="spazio occupato" />
                <Card v={d.tenant.shares} l="condivisioni" />
                <Card v={d.tenant.public_links} l="link pubblici attivi" />
              </div>
              <section className="card">
                <h3>Attività del tenant negli ultimi 30 giorni</h3>
                <div className="bars" role="img" aria-label="Eventi per giorno">
                  {d.tenant.activity.map((x) => (
                    <span key={x.day} title={`${x.day}: ${x.events} eventi, ${x.users} utenti`} style={{ height: `${(x.events / max) * 100}%` }} />
                  ))}
                </div>
              </section>
            </>
          )}

          {d.system && (
            <>
              <h2 className="ov-title">
                Il sistema{' '}
                <button type="button" className="btn ghost small" onClick={onAdmin}>
                  Amministrazione
                </button>
              </h2>
              <div className="kpi-cards">
                <Card v={`${d.system.active_tenants}/${d.system.tenants}`} l="tenant attivi" />
                <Card v={d.system.users} l="utenti attivi" />
                <Card v={d.system.active_users_30d} l="utenti attivi (30 gg)" />
                <Card v={d.system.administrators} l="Administrator" />
                <Card v={d.system.resources} l="risorse" />
                <Card v={fmtBytes(d.system.bytes)} l="spazio occupato" />
                <Card v={`${d.system.plugins_active}/${d.system.plugins_installed}`} l="plugin attivi" />
              </div>
            </>
          )}
        </>
      )}

      <h2 className="ov-title">Applicazioni</h2>
      <div className="kpi-cards">
        {ctx.plugins.map((p) => (
          <button key={p.id} type="button" className="kpi-card clickable" onClick={() => onOpen(p.id)}>
            <div className="v" aria-hidden="true">
              {p.icon}
            </div>
            <div style={{ fontWeight: 600 }}>{p.label}</div>
            <div className="l">{p.description}</div>
          </button>
        ))}
        {ctx.plugins.length === 0 && <p className="muted">Nessun plugin attivo: un Administrator puo' installarli e attivarli.</p>}
      </div>
    </div>
  )
}
