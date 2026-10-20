import { useEffect, useRef } from 'react'

export interface ConfirmRequest {
  message: string
  resolve: (value: boolean) => void
}

interface ConfirmDialogProps {
  request: ConfirmRequest | null
  onResolve: (value: boolean) => void
}

export default function ConfirmDialog({ request, onResolve }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!request) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onResolve(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, onResolve])

  if (!request) return null

  return (
    <div className="modal-backdrop confirm-backdrop" onClick={() => onResolve(false)}>
      <div
        className="modal confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label="Conferma"
      >
        <p className="confirm-msg">{request.message}</p>
        <div className="confirm-actions">
          <button type="button" className="btn ghost" ref={cancelRef} onClick={() => onResolve(false)}>
            Annulla
          </button>
          <button type="button" className="btn danger" onClick={() => onResolve(true)}>
            Conferma
          </button>
        </div>
      </div>
    </div>
  )
}
