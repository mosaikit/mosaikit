import { fmtBytes } from '../api.ts'
import type { GlobalKpi, PluginKpi, ResourceStat, TenantKpi } from '../types.ts'
import { DataTable } from '../ui.tsx'

function Card({ v, l }: { v: number | string; l: string }) {
  return (
    <div className="kpi-card">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  )
}

function Resources({ rows }: { rows: ResourceStat[] }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Plugin</th>
            <th>Tipo</th>
            <th>Risorse</th>
            <th>Spazio</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="empty" colSpan={4}>
                Nessuna risorsa.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.plugin_id + r.kind}>
              <td>{r.plugin}</td>
              <td className="mono">{r.kind}</td>
              <td className="num">{r.count}</td>
              <td className="num">{fmtBytes(r.bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Plugins({ items }: { items: PluginKpi[] }) {
  if (!items.length) return null
  return (
    <>
      {items.map((p) => (
        <section className="card" key={p.plugin_id + p.view}>
          <h3>
            {p.plugin} · {p.label}
          </h3>
          <DataTable rows={p.rows} />
        </section>
      ))}
    </>
  )
}

export function TenantKpiView({ k }: { k: TenantKpi }) {
  const c = k.core
  const total = c.resources.reduce((s, r) => s + r.count, 0)
  const bytes = c.resources.reduce((s, r) => s + r.bytes, 0)
  const max = Math.max(1, ...c.activity.map((d) => d.events))
  return (
    <>
      <div className="kpi-cards">
        <Card v={c.members} l="membri" />
        <Card v={c.guests} l="ospiti" />
        <Card v={c.active_users_30d} l="utenti attivi (30 gg)" />
        <Card v={total} l="risorse" />
        <Card v={fmtBytes(bytes)} l="spazio occupato" />
        <Card v={c.shares} l="condivisioni" />
        <Card v={c.public_links} l="link pubblici attivi" />
        <Card v={c.link_views} l="visite ai link" />
      </div>
      <section className="card">
        <h3>Attività degli ultimi 30 giorni</h3>
        <div className="bars" role="img" aria-label="Eventi per giorno">
          {c.activity.map((d) => (
            <span key={d.day} title={`${d.day}: ${d.events} eventi, ${d.users} utenti`} style={{ height: `${(d.events / max) * 100}%` }} />
          ))}
        </div>
      </section>
      <section className="card">
        <h3>Risorse per plugin</h3>
        <Resources rows={c.resources} />
      </section>
      <Plugins items={k.plugins} />
    </>
  )
}

export function GlobalKpiView({ k }: { k: GlobalKpi }) {
  return (
    <>
      <section className="card">
        <h3>Tenant</h3>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Stato</th>
                <th>Membri</th>
                <th>Ospiti</th>
                <th>Attivi 30 gg</th>
                <th>Risorse</th>
                <th>Spazio</th>
                <th>Condivisioni</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {k.tenants.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.name} <span className="muted mono">{t.slug}</span>
                  </td>
                  <td>{t.status === 'active' ? <span className="badge ok">attivo</span> : <span className="badge err">sospeso</span>}</td>
                  <td className="num">{t.members}</td>
                  <td className="num">{t.guests}</td>
                  <td className="num">{t.active_users_30d}</td>
                  <td className="num">{t.resources}</td>
                  <td className="num">{fmtBytes(t.bytes)}</td>
                  <td className="num">{t.shares}</td>
                  <td className="num">{t.public_links}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h3>Risorse per plugin (tutti i tenant)</h3>
        <Resources rows={k.resources} />
      </section>
      <Plugins items={k.plugins} />
    </>
  )
}
