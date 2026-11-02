// The controls the top band shows while a plugin has a resource open on the full page (contextband.ts): the
// View | Edit switch (or the "Read only" label), the people connected and the comments button. Colours are the
// pair of the band itself (`band-foreground` on `band`, or the other way round), so the contrast is the one of
// the band in every theme and in dark mode (contextband.test.ts computes it). Texts of the plugin are
// always React text nodes.

import { Lock, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from './i18n.ts'
import type { BandView } from './contextband.ts'

/** The id the comments panel of the shell takes when it is open (the button points at it). */
export const COMMENTS_PANEL_ID = 'msk-comments-panel'
/** How many avatars are drawn before "+N". */
export const BAND_SHOWN = 3

const focus = 'outline-none focus-visible:ring-2 focus-visible:ring-white/60'

/** The switch: one control (role switch, checked = Edit) drawn as two segments. */
export function ModeSwitch({ mode, onChange }: { mode: NonNullable<BandView['mode']>; onChange: (v: 'view' | 'edit') => void }) {
  if (!mode.canEdit)
    return (
      <span className="msk-band-readonly flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-band-foreground ring-1 ring-white/40">
        <Lock className="size-3.5" aria-hidden="true" />
        {t('Read only')}
      </span>
    )
  const edit = mode.value === 'edit'
  const seg = (on: boolean) => cn('flex h-6 items-center rounded-full px-3 text-[13px] font-medium', on ? 'bg-band-foreground text-band' : 'text-band-foreground')
  return (
    <button
      type="button"
      role="switch"
      aria-checked={edit}
      aria-label={t('Edit mode')}
      title={edit ? t('Editing: switch to view') : t('Viewing: switch to edit')}
      className={cn('msk-band-mode flex h-7 items-center rounded-full p-0.5 ring-1 ring-white/40 hover:ring-white/80', focus)}
      onClick={() => onChange(edit ? 'view' : 'edit')}
    >
      <span aria-hidden="true" className={seg(!edit)}>
        {t('View')}
      </span>
      <span aria-hidden="true" className={seg(edit)}>
        {t('Edit')}
      </span>
    </button>
  )
}

/** The people connected: up to three avatars with their initials, then "+N". Each is labelled with the name. */
export function Presence({ people }: { people: BandView['presence'] }) {
  if (!people.length) return null
  const shown = people.slice(0, BAND_SHOWN)
  const rest = people.slice(BAND_SHOWN)
  const dot = 'flex size-7 items-center justify-center rounded-full bg-band-foreground text-[10px] font-semibold text-band ring-2 ring-band'
  return (
    <div role="group" className="msk-band-presence flex shrink-0 items-center -space-x-1.5 max-[640px]:hidden" aria-label={t('People connected: {n}', { n: String(people.length) })}>
      {shown.map((p) => (
        <span key={p.id} role="img" aria-label={p.name} title={p.name} className={dot}>
          <span aria-hidden="true">{p.initials}</span>
        </span>
      ))}
      {rest.length > 0 && (
        <span role="img" aria-label={t('and {n} more: {names}', { n: String(rest.length), names: rest.map((p) => p.name).join(', ') })} title={rest.map((p) => p.name).join(', ')} className={dot}>
          <span aria-hidden="true">+{rest.length}</span>
        </span>
      )}
    </div>
  )
}

/** The comments button: pressed while the panel is open, with the number of comments in a badge. */
export function CommentsButton({ comments, onToggle }: { comments: NonNullable<BandView['comments']>; onToggle: () => void }) {
  // the panel belongs to the shell and may not exist (yet): point at it only when it is on the page
  const panel = typeof document !== 'undefined' && document.getElementById(COMMENTS_PANEL_ID) ? COMMENTS_PANEL_ID : undefined
  return (
    <button
      type="button"
      className={cn('msk-band-comments relative flex size-8 shrink-0 items-center justify-center rounded-md text-band-foreground hover:bg-band-hover', comments.open && 'bg-band-hover ring-1 ring-white/40', focus)}
      aria-expanded={comments.open}
      aria-controls={panel}
      title={comments.open ? t('Close the comments') : t('Open the comments')}
      onClick={onToggle}
    >
      <MessageSquare className="size-[18px]" aria-hidden="true" />
      <span className="sr-only">{t('Comments')}</span>
      {comments.count !== null && comments.count > 0 && (
        <span className="absolute -top-0.5 -right-1 min-w-4 rounded-full bg-band-foreground px-1 text-center text-[10px] leading-4 font-semibold text-band ring-2 ring-band">
          <span className="sr-only">: </span>
          {comments.count}
        </span>
      )}
    </button>
  )
}
