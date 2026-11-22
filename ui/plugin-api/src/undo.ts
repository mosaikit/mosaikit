// The «Deleted - Undo» pattern: the page acts at once (the row disappears), the real destructive call is held back
// for a few seconds and cancelled by Undo. Replaces the confirm dialog in lists.
import { toast } from './kit.ts'

export interface UndoOptions {
  /** the message: «Task deleted» */
  text: string
  /** the button (English `Undo` by default) */
  undoLabel?: string
  /** runs when the time is over (or `commit()` is called, or the page closes): the real delete */
  commit: () => void | Promise<void>
  /** runs when the person presses Undo: put the row back */
  undo: () => void
  /** how long the undo stays possible, ms (6000) */
  ms?: number
}

export interface UndoHandle {
  /** commits now (a second delete should not wait for the first) */
  commit: () => void
  /** cancels, as if Undo was pressed */
  undo: () => void
}

/**
 * Shows a toast with Undo and holds `commit` back. Exactly one of `commit` and `undo` runs, once. A page that is
 * hidden while the toast is up commits (the person meant it).
 */
export function undoToast(opts: UndoOptions): UndoHandle {
  const ms = opts.ms ?? 6000
  let done = false
  let closeToast = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const finish = (what: 'commit' | 'undo') => {
    if (done) return
    done = true
    clearTimeout(timer)
    removeEventListener('pagehide', flush)
    closeToast()
    if (what === 'commit') void opts.commit()
    else opts.undo()
  }
  const flush = () => finish('commit')
  addEventListener('pagehide', flush)
  closeToast = toast(opts.text, { ms: ms + 1000, action: { label: opts.undoLabel ?? 'Undo', onClick: () => finish('undo') } })
  timer = setTimeout(() => finish('commit'), ms)
  return { commit: () => finish('commit'), undo: () => finish('undo') }
}
