// Keyboard shortcuts of a plugin page (plugins-review X8): one registration, one help sheet (press `?`), the same
// behaviour in every plugin. Plain keys are ignored while the person types in a field; combos with Ctrl/Meta/Alt
// always work. The help sheet is a dialog of the kit, so it is accessible and closes with Escape.
import { h } from './dom.ts'
import { dialog } from './kit.ts'

export interface Shortcut {
  /** `n`, `/`, `?`, `escape`, `ctrl+k`, `shift+arrowdown`; a sequence of two keys is written with a space: `g i` */
  keys: string
  /** what it does, in the language of the person (shown in the help sheet) */
  label: string
  run: (ev: KeyboardEvent) => void
  /** the heading of the group in the help sheet */
  group?: string
  /** false: the shortcut is off now */
  when?: () => boolean
  /** true: the shortcut works also while a field has the focus (Escape, ctrl+Enter) or a dialog is open */
  inField?: boolean
}

export interface ShortcutOptions {
  /** the texts of the help sheet (English by default) */
  labels?: { title?: string; close?: string; general?: string; then?: string }
  /** where to listen (the document by default) */
  target?: Document | HTMLElement
}

export interface Shortcuts {
  /** opens the help sheet (also bound to `?`) */
  help: () => void
  /** removes the listener and closes the sheet */
  dispose: () => void
}

const isField = (t: EventTarget | null): boolean => {
  const e = t as HTMLElement | null
  if (!e || !e.tagName) return false
  return e.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName) || e.getAttribute?.('role') === 'textbox'
}

/** The normal form of a key event: `ctrl+k`, `shift+arrowdown`, `?`, `escape`. A shifted letter or symbol carries no `shift+` unless it is a named key. */
export function keyName(ev: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  let k = ev.key
  if (k === ' ') k = 'space'
  const named = k.length > 1
  k = k.toLowerCase()
  const mods = [ev.ctrlKey || ev.metaKey ? 'ctrl' : '', ev.altKey ? 'alt' : '', ev.shiftKey && named ? 'shift' : ''].filter(Boolean)
  return [...mods, k].join('+')
}

const KEY_GLYPH: Record<string, string> = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', escape: 'Esc', enter: '↵', space: 'Space' }

const pretty = (keys: string, then: string): HTMLElement[] =>
  keys.split(' ').flatMap((seq, i) => [
    ...(i ? [h('span', { class: 'msk-keysep' }, then)] : []),
    ...seq.split('+').map((k) => h('kbd', { class: 'msk-kbd' }, KEY_GLYPH[k] ?? (k.length === 1 ? k.toUpperCase() : k[0]!.toUpperCase() + k.slice(1)))),
  ])

/** Registers the shortcuts of a page. `?` (when not typing) opens the help sheet listing every one of them. */
export function shortcuts(list: Shortcut[], opts: ShortcutOptions = {}): Shortcuts {
  const target = opts.target ?? document
  const labels = { title: 'Keyboard shortcuts', close: 'Close', general: 'General', then: 'then', ...opts.labels }
  let pending: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let sheet: { close: () => void } | null = null

  const help = () => {
    if (sheet) return
    const groups = new Map<string, Shortcut[]>()
    for (const s of list) {
      const g = s.group ?? labels.general
      groups.set(g, [...(groups.get(g) ?? []), s])
    }
    const body = h('div', { class: 'msk-keyhelp' })
    for (const [g, items] of groups) {
      const dl = h('dl', { class: 'msk-keylist' })
      for (const s of items) dl.append(h('dt', {}, s.label), h('dd', { class: 'msk-keys' }, ...pretty(s.keys, labels.then)))
      body.append(h('section', {}, h('h4', {}, g), dl))
    }
    const ok = h('button', { class: 'msk-btn ghost', type: 'button' }, labels.close)
    const d = dialog({ title: labels.title, body, actions: [ok], onClose: () => (sheet = null) })
    d.el.classList.add('msk-keysheet')
    ok.addEventListener('click', d.close)
    sheet = d
  }

  const helpKey: Shortcut = { keys: '?', label: '', run: help }
  const onKey = (e: Event) => {
    const ev = e as KeyboardEvent
    if (ev.defaultPrevented || ev.isComposing || ['Shift', 'Control', 'Alt', 'Meta'].includes(ev.key)) return
    const name = keyName(ev)
    const typing = isField(ev.target)
    const all = [...list, helpKey]
    let hit: Shortcut | undefined
    if (pending) {
      const seq = `${pending} ${name}`
      pending = null
      clearTimeout(timer)
      hit = all.find((s) => s.keys === seq)
    } else {
      hit = all.find((s) => s.keys === name && (!typing || s.inField || name.includes('ctrl+') || name.includes('alt+')))
      if (!hit && !typing && all.some((s) => s.keys.startsWith(name + ' '))) {
        pending = name
        timer = setTimeout(() => (pending = null), 1200)
        return
      }
    }
    if (!hit || (hit.when && !hit.when())) return
    // a dialog is open (the help sheet included): only `?` and the shortcuts that say so
    if (document.querySelector('dialog[open]') && hit !== helpKey && !hit.inField) return
    ev.preventDefault()
    hit.run(ev)
  }
  target.addEventListener('keydown', onKey)
  return {
    help,
    dispose: () => {
      target.removeEventListener('keydown', onKey)
      clearTimeout(timer)
      sheet?.close()
    },
  }
}
