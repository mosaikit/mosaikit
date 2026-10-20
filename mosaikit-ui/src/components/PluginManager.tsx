import { useRef, useState } from 'react'
import type { PluginInfo } from '../types.ts'

interface PluginManagerProps {
  plugins: PluginInfo[]
  onClose: () => void
  onActivate: (id: string) => Promise<void>
  onDeactivate: (id: string) => Promise<void>
  onUninstall: (id: string) => Promise<void>
  onInstall: (file: File) => Promise<void>
}

export default function PluginManager({ plugins, onClose, onActivate, onDeactivate, onUninstall, onInstall }: PluginManagerProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [pending, setPending] = useState<string | null>(null)

  const run = async (key: string, fn: () => Promise<void>) => {
    setPending(key)
    setMsg('')
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Gestione plugin">
        <div className="modal-head">
          <h2>🧩 Gestione plugin</h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="plug-list">
          {plugins.length === 0 && <p>Nessun plugin installato.</p>}
          {plugins.map((p) => (
            <div className="plug" key={p.id}>
              <span className="plug-ic" aria-hidden="true">
                {p.icon}
              </span>
              <div className="plug-meta">
                <span className="plug-name">{p.label}</span>{' '}
                <span className="plug-ver">v{p.version}</span>
                <small>
                  <span className={'dot ' + (p.active ? 'on' : 'off')}></span>
                  {p.active ? 'attivo' : 'inattivo'} · {p.id}
                </small>
              </div>
              {p.active ? (
                <button type="button" className="btn ghost" disabled={pending === p.id}
                  onClick={() => run(p.id, () => onDeactivate(p.id))}>
                  Disattiva
                </button>
              ) : (
                <button type="button" className="btn" disabled={pending === p.id}
                  onClick={() => run(p.id, () => onActivate(p.id))}>
                  Attiva
                </button>
              )}
              <button type="button" className="btn danger" disabled={pending === p.id}
                onClick={() => run(p.id, () => onUninstall(p.id))}>
                Disinstalla
              </button>
            </div>
          ))}
        </div>
        <div className="install-row">
          <input ref={fileRef} type="file" accept=".mskp" />
          <button type="button" className="btn" disabled={pending === 'install'}
            onClick={() => {
              const f = fileRef.current?.files?.[0]
              if (!f) {
                setMsg('seleziona un file .mskp')
                return
              }
              run('install', () => onInstall(f))
            }}>
            Installa pacchetto
          </button>
        </div>
        <div className="install-msg">{msg}</div>
      </div>
    </div>
  )
}
