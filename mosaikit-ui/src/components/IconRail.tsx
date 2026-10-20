import type { PluginInfo } from '../types.ts'

interface IconRailProps {
  plugins: PluginInfo[]
  currentView: string | null
  onSelect: (plugin: PluginInfo) => void
  onManage: () => void
}

export default function IconRail({ plugins, currentView, onSelect, onManage }: IconRailProps) {
  return (
    <nav className="rail" aria-label="Plugin attivi">
      <div className="rail-brand" aria-hidden="true">
        ⬡
      </div>
      <div className="rail-tiles">
        {plugins.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={'tile' + (currentView === p.view ? ' active' : '')}
            style={{ animationDelay: 0.12 + i * 0.06 + 's' }}
            title={p.label}
            onClick={() => onSelect(p)}
          >
            <span className="tile-ic" aria-hidden="true">
              {p.icon}
            </span>
            <span className="tile-label">{p.label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="tile tile-manage" title="Gestione plugin" onClick={onManage}>
        <span className="tile-ic" aria-hidden="true">
          🧩
        </span>
        <span className="tile-label">Plugin</span>
      </button>
    </nav>
  )
}
