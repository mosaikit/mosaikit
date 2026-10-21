import { useBrand } from '../brand.ts'
import type { PluginView } from '../types.ts'

export type View = { kind: 'home' } | { kind: 'plugin'; id: string } | { kind: 'manage' } | { kind: 'admin' } | { kind: 'account' }

interface Props {
  plugins: PluginView[]
  view: View
  isManager: boolean
  isAdmin: boolean
  invitations: number
  onSelect: (v: View) => void
}

export default function Rail({ plugins, view, isManager, isAdmin, invitations, onSelect }: Props) {
  const brand = useBrand()
  const active = (v: View) => (view.kind === v.kind && (v.kind !== 'plugin' || (view.kind === 'plugin' && view.id === v.id)) ? ' active' : '')
  return (
    <nav className="rail" aria-label="Navigazione">
      <button type="button" className="rail-brand linklike" style={{ textDecoration: 'none' }} title={`${brand.name} · Panoramica`} onClick={() => onSelect({ kind: 'home' })}>
        {brand.logo ? <img className="rail-logo" src="brand/logo" alt={brand.name} /> : '⬡'}
      </button>
      <div className="rail-tiles">
        {plugins.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={'tile' + active({ kind: 'plugin', id: p.id })}
            style={{ animationDelay: 0.12 + i * 0.06 + 's' }}
            title={p.description || p.label}
            onClick={() => onSelect({ kind: 'plugin', id: p.id })}
          >
            <span className="tile-ic" aria-hidden="true">
              {p.icon}
            </span>
            <span className="tile-label">{p.label}</span>
            {p.dev && <span className="tile-dev">DEV</span>}
          </button>
        ))}
      </div>
      <div className="rail-sep" />
      {isManager && (
        <button type="button" className={'tile' + active({ kind: 'manage' })} title="Gestione del tenant" onClick={() => onSelect({ kind: 'manage' })}>
          <span className="tile-ic" aria-hidden="true">
            🏛
          </span>
          <span className="tile-label">Gestione</span>
        </button>
      )}
      {isAdmin && (
        <button type="button" className={'tile' + active({ kind: 'admin' })} title="Amministrazione di sistema" onClick={() => onSelect({ kind: 'admin' })}>
          <span className="tile-ic" aria-hidden="true">
            🧩
          </span>
          <span className="tile-label">Sistema</span>
        </button>
      )}
      <button type="button" className={'tile' + active({ kind: 'account' })} title="Account e inviti" onClick={() => onSelect({ kind: 'account' })}>
        <span className="tile-ic" aria-hidden="true">
          👤
        </span>
        <span className="tile-label">Account</span>
        {invitations > 0 && <span className="tile-badge">{invitations}</span>}
      </button>
    </nav>
  )
}
