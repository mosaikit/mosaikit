// The comments panel of the shell: the thread of the resource a plugin page shows on the full page, on the
// right of the frame. Comments are plain text, drawn as text nodes. The controller keeps the number of the
// band up to date even while the panel is closed.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { api, enc, errText, fmtDate } from '@/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { t } from './i18n.ts'
import { COMMENTS_PANEL_ID } from './ContextBand.tsx'
import { resetComments, setCommentsCount, setCommentsOpen, useCommentsState, type CommentView } from './comments.ts'

const MAX = 2000
const POLL_MS = 30_000

export default function CommentsController({ tenant, resource }: { tenant: string; resource: string }) {
  const { open, count } = useCommentsState()
  const [items, setItems] = useState<CommentView[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const base = `/api/t/${enc(tenant)}/resources/${enc(resource)}/comments`
  const input = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    try {
      const th = await api<{ comments: CommentView[]; count: number }>('GET', base)
      setItems(th.comments)
      setCommentsCount(th.count)
    } catch {
      // the resource may be gone or not visible: no badge, no panel
      setCommentsCount(null)
    }
  }, [base])

  // a new resource starts closed and empty; the count is read at once and then now and then
  useEffect(() => {
    resetComments()
    setItems([])
    setText('')
    setError('')
    void load()
    const id = window.setInterval(() => void load(), POLL_MS)
    return () => {
      window.clearInterval(id)
      resetComments()
    }
  }, [load])

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  if (!open) return null
  const send = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setError('')
    try {
      await api('POST', base, { body })
      setText('')
      await load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string) => {
    setError('')
    try {
      await api('DELETE', `${base}/${enc(id)}`)
      await load()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <aside
      id={COMMENTS_PANEL_ID}
      aria-label={t('Comments')}
      className="msk-comments-panel fixed top-[50px] right-0 bottom-0 z-30 flex w-[min(360px,100vw)] flex-col border-l bg-background text-foreground shadow-lg"
      onKeyDown={(e) => e.key === 'Escape' && setCommentsOpen(false)}
    >
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-semibold">
          {t('Comments')}
          {count !== null && <span className="ml-1 text-muted-foreground">({count})</span>}
        </h2>
        <Button variant="ghost" size="icon" aria-label={t('Close the comments')} onClick={() => setCommentsOpen(false)}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <ul className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {items.length === 0 && <li className="text-sm text-muted-foreground">{t('No comments yet.')}</li>}
        {items.map((c) => (
          <li key={c.id} className="msk-comment text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{c.author_name}</span>
              <span className="text-xs text-muted-foreground">{fmtDate(c.created_at)}</span>
            </div>
            <p className="mt-0.5 break-words whitespace-pre-wrap">{c.body}</p>
            {c.can_delete && (
              <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive" onClick={() => void remove(c.id)}>
                <Trash2 className="size-3" aria-hidden="true" />
                {t('Delete')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="space-y-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <Textarea ref={input} value={text} maxLength={MAX} rows={3} aria-label={t('Write a comment')} placeholder={t('Write a comment')} onChange={(e) => setText(e.target.value)} />
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {text.length}/{MAX}
          </span>
          <Button type="submit" size="sm" disabled={busy || !text.trim()}>
            {t('Send')}
          </Button>
        </div>
      </form>
    </aside>
  )
}
