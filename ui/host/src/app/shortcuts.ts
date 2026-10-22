// Keyboard shortcuts of the shell (Help › Keyboard shortcuts). A pure reducer, so the sequences
// ("g" then "h") are tested without a browser; Shell.tsx turns the actions into navigation.

export type ShortcutAction = 'search' | 'help' | 'home' | 'notifications' | 'account' | 'trash'

export interface ShortcutState {
  /** the first key of a sequence ("g") and when it was pressed */
  pending: string | null
  at: number
}

/** How long the second key of a sequence may wait, in milliseconds. */
export const SEQUENCE_MS = 1500

/** The shortcuts, as shown in the dialog (keys, what they do). */
export const SHORTCUTS: { keys: string[]; label: string; action: ShortcutAction }[] = [
  { keys: ['Ctrl', 'K'], label: 'Search everywhere', action: 'search' },
  { keys: ['/'], label: 'Search everywhere', action: 'search' },
  { keys: ['?'], label: 'Keyboard shortcuts', action: 'help' },
  { keys: ['G', 'H'], label: 'Go to the Home', action: 'home' },
  { keys: ['G', 'N'], label: 'Go to the notifications', action: 'notifications' },
  { keys: ['G', 'A'], label: 'Go to your account', action: 'account' },
  { keys: ['G', 'T'], label: 'Go to the trash', action: 'trash' },
]

const SECOND: Record<string, ShortcutAction> = { h: 'home', n: 'notifications', a: 'account', t: 'trash' }

/** One key pressed outside a field: the new state and, if a shortcut is complete, its action. */
export function press(state: ShortcutState, key: string, now: number, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}): { state: ShortcutState; action: ShortcutAction | null } {
  const idle: ShortcutState = { pending: null, at: 0 }
  if (mods.ctrl || mods.alt || mods.meta) return { state: idle, action: null }
  if (state.pending === 'g' && now - state.at <= SEQUENCE_MS) {
    const a = SECOND[key.toLowerCase()]
    return { state: idle, action: a ?? null }
  }
  if (key === '?') return { state: idle, action: 'help' }
  if (key === '/') return { state: idle, action: 'search' }
  if (key.toLowerCase() === 'g') return { state: { pending: 'g', at: now }, action: null }
  return { state: idle, action: null }
}

/** Whether a key event comes from a place where the person types (fields, editors). */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')
}
