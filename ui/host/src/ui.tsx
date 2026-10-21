// Componenti di interfaccia condivisi: toast, finestre, conferme, tabelle.

import { useEffect, useRef, type ReactNode } from 'react'

export interface Toast {
  id: number
  text: string
  error: boolean
}

export function Toasts({ items }: { items: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={'toast' + (t.error ? ' err' : '')}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function Modal({ title, onClose, children, width }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost small" onClick={onClose} aria-label="Chiudi">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export interface ConfirmRequest {
  message: string
  danger: boolean
  resolve: (v: boolean) => void
}

export function ConfirmDialog({ request, onResolve }: { request: ConfirmRequest | null; onResolve: (v: boolean) => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!request) return
    cancel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onResolve(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [request, onResolve])
  if (!request) return null
  return (
    <div className="modal-backdrop confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onResolve(false)}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-label="Conferma">
        <p className="confirm-msg">{request.message}</p>
        <div className="confirm-actions">
          <button type="button" className="btn ghost" ref={cancel} onClick={() => onResolve(false)}>
            Annulla
          </button>
          <button type="button" className={'btn ' + (request.danger ? 'danger' : 'primary')} onClick={() => onResolve(true)}>
            Conferma
          </button>
        </div>
      </div>
    </div>
  )
}

/** Tabella generica (righe KPI dei plugin). */
export function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="muted">Nessun dato.</p>
  const cols = Object.keys(rows[0])
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c.replace(/_/g, ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} className={typeof r[c] === 'number' ? 'num' : undefined}>
                  {r[c] === null || r[c] === undefined ? '—' : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
