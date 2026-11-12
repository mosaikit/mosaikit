// The shared UI kit of the plugins (docs/refactoring-ui.md §13): small framework-free components on the tokens of the
// host. Every control has a role and a name, works with the keyboard and respects `prefers-reduced-motion`. The texts
// the components show on their own come in `labels` (English by default): the plugin gives its translation.
import { h } from './dom.ts'
import { avatar } from './items.ts'
import type { DirectoryUser } from './protocol.ts'

const uid = (() => {
  let n = 0
  return (p: string) => `${p}-${++n}`
})()

// ---------------------------------------------------------------------------------------------------------------- toast

let toastHost: HTMLElement | null = null

/** A short message at the bottom of the page, announced to screen readers, gone after `ms` (4 s). `action` adds a button (Undo). */
export function toast(text: string, opts: { tone?: 'ok' | 'err' | ''; ms?: number; action?: { label: string; onClick: () => void } } = {}): () => void {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'msk-toasts', role: 'status', 'aria-live': 'polite' })
    document.body.append(toastHost)
  }
  const t = h('div', { class: 'msk-toast' + (opts.tone ? ' ' + opts.tone : '') }, h('span', {}, text))
  const close = () => {
    t.remove()
    clearTimeout(timer)
  }
  if (opts.action) {
    const b = h('button', { class: 'msk-link', type: 'button' }, opts.action.label)
    b.addEventListener('click', () => {
      opts.action!.onClick()
      close()
    })
    t.append(b)
  }
  toastHost.append(t)
  const timer = setTimeout(close, opts.ms ?? 4000)
  return close
}

// ------------------------------------------------------------------------------------------------------------- skeleton

/** A placeholder in the shape of the content while it loads: `lines` text lines, or `cards` boxes. */
export function skeleton(opts: { kind?: 'lines' | 'cards' | 'rows'; count?: number } = {}): HTMLElement {
  const kind = opts.kind ?? 'lines'
  const n = opts.count ?? (kind === 'lines' ? 3 : 4)
  const e = h('div', { class: 'msk-skel ' + kind, 'aria-hidden': 'true' })
  for (let i = 0; i < n; i++) e.append(h('span', { class: 'msk-skel-i' }))
  return e
}

// ------------------------------------------------------------------------------------------------------------ progress

/** A progress bar or ring (`kind: 'ring'`) of `value` out of `max`, with its accessible value. */
export function progress(opts: { value: number; max: number; label: string; kind?: 'bar' | 'ring' }): HTMLElement {
  const max = Math.max(opts.max, 0)
  const value = Math.min(Math.max(opts.value, 0), max)
  const pct = max === 0 ? 0 : Math.round((value / max) * 100)
  const e = h('span', { class: 'msk-progress ' + (opts.kind ?? 'bar'), role: 'progressbar', 'aria-label': opts.label, 'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': String(value) })
  e.style.setProperty('--pct', String(pct))
  if ((opts.kind ?? 'bar') === 'ring') e.append(h('span', { class: 'msk-progress-n' }, `${pct}`))
  else e.append(h('span', { class: 'msk-progress-fill' }))
  return e
}

// ---------------------------------------------------------------------------------------------------------- segmented

export interface SegmentedOption {
  key: string
  label: string
}

/** A set of exclusive buttons (views, filters). `set(key)` changes the value without calling `onChange`. */
export function segmented(opts: { label: string; options: SegmentedOption[]; value: string; onChange: (key: string) => void }): { el: HTMLElement; set: (key: string) => void } {
  const el = h('div', { class: 'msk-switch', role: 'group', 'aria-label': opts.label })
  const buttons = new Map<string, HTMLButtonElement>()
  const set = (key: string) => buttons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === key)))
  for (const o of opts.options) {
    const b = h('button', { class: 'msk-seg', type: 'button' }, o.label)
    b.addEventListener('click', () => {
      set(o.key)
      opts.onChange(o.key)
    })
    buttons.set(o.key, b)
    el.append(b)
  }
  set(opts.value)
  return { el, set }
}

// -------------------------------------------------------------------------------------------------------- popover, menu

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/** Shows `content` under `anchor`; closes on Escape, on a click outside and on `close()`. The focus goes back to the anchor. */
export function popover(anchor: HTMLElement, content: HTMLElement, opts: { onClose?: () => void } = {}): { close: () => void; el: HTMLElement } {
  const el = h('div', { class: 'msk-popover' })
  el.append(content)
  anchor.setAttribute('aria-expanded', 'true')
  const r = anchor.getBoundingClientRect()
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 240))}px`
  el.style.top = `${r.bottom + 6}px`
  document.body.append(el)
  const close = () => {
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', key, true)
    el.remove()
    anchor.setAttribute('aria-expanded', 'false')
    anchor.focus()
    opts.onClose?.()
  }
  const outside = (ev: Event) => {
    if (!el.contains(ev.target as Node) && !anchor.contains(ev.target as Node)) close()
  }
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation()
      close()
    }
  }
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', key, true)
  return { close, el }
}

/** A menu of actions under `anchor`, with arrow-key navigation. */
export function menu(anchor: HTMLElement, items: MenuItem[]): { close: () => void } {
  const list = h('div', { class: 'msk-menu', role: 'menu' })
  const buttons: HTMLButtonElement[] = []
  const pop = popover(anchor, list)
  for (const it of items) {
    const b = h('button', { class: 'msk-menuitem' + (it.danger ? ' danger' : ''), type: 'button', role: 'menuitem' }, it.label)
    b.disabled = !!it.disabled
    b.addEventListener('click', () => {
      pop.close()
      it.onClick()
    })
    buttons.push(b)
    list.append(b)
  }
  list.addEventListener('keydown', (ev) => {
    const n = buttons.length
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    // the next enabled entry from `from` in direction `dir` (wrapping)
    const go = (from: number, dir: 1 | -1) => {
      ev.preventDefault()
      for (let k = 0; k < n; k++) {
        const b = buttons[(from + dir * k + n * n) % n]!
        if (!b.disabled) return b.focus()
      }
    }
    if (ev.key === 'ArrowDown') go(at + 1, 1)
    else if (ev.key === 'ArrowUp') go(at - 1, -1)
    else if (ev.key === 'Home') go(0, 1)
    else if (ev.key === 'End') go(n - 1, -1)
  })
  buttons.find((b) => !b.disabled)?.focus()
  return { close: pop.close }
}

// ------------------------------------------------------------------------------------------------------------- dialog

export interface DialogOptions {
  title: string
  body: Node
  /** the buttons, last one first in the tab order of the primary action */
  actions?: HTMLElement[]
  onClose?: () => void
}

/** A modal dialog over the page (same look as the form of `mountCrud`). Escape and a click outside close it. */
export function dialog(opts: DialogOptions): { el: HTMLDialogElement; close: () => void } {
  const el = document.createElement('dialog')
  el.className = 'msk-modal'
  const id = uid('msk-dlg')
  el.setAttribute('aria-labelledby', id)
  const box = h('div', { class: 'msk-form' }, h('h3', { id, tabindex: '-1' }, opts.title), opts.body)
  if (opts.actions?.length) box.append(h('div', { class: 'msk-actions' }, ...opts.actions))
  el.append(box)
  const close = () => {
    if (el.open) el.close()
  }
  el.addEventListener('close', () => {
    el.remove()
    opts.onClose?.()
  })
  el.addEventListener('click', (ev) => {
    if (ev.target === el) close()
  })
  document.body.append(el)
  el.showModal()
  return { el, close }
}

/** Asks for a confirmation; resolves true on the primary button. */
export function confirmDialog(opts: { title: string; text: string; ok: string; cancel: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false
    const no = h('button', { class: 'msk-btn ghost', type: 'button' }, opts.cancel)
    const yes = h('button', { class: 'msk-btn' + (opts.danger ? ' danger' : ''), type: 'button' }, opts.ok)
    const d = dialog({ title: opts.title, body: h('p', {}, opts.text), actions: [no, yes], onClose: () => resolve(answer) })
    no.addEventListener('click', d.close)
    yes.addEventListener('click', () => {
      answer = true
      d.close()
    })
    yes.focus()
  })
}

// ------------------------------------------------------------------------------------------------------------ tag input

/** Tags typed as chips: Enter or comma adds, Backspace on an empty box removes the last, the chips have a remove button. */
export function tagInput(opts: { label: string; values: string[]; suggestions?: string[]; placeholder?: string; removeLabel?: string; onChange: (values: string[]) => void }): { el: HTMLElement; set: (v: string[]) => void; get: () => string[] } {
  let values = [...opts.values]
  const el = h('div', { class: 'msk-taginput' })
  const input = h('input', { type: 'text', 'aria-label': opts.label, placeholder: opts.placeholder ?? '' })
  const dl = h('datalist', { id: uid('msk-tags') })
  input.setAttribute('list', dl.id)
  const draw = () => {
    el.replaceChildren()
    for (const v of values) {
      const rm = h('button', { type: 'button', class: 'msk-tagx', 'aria-label': `${opts.removeLabel ?? 'Remove'}: ${v}` }, '×')
      rm.addEventListener('click', () => {
        values = values.filter((x) => x !== v)
        opts.onChange(values)
        draw()
        input.focus()
      })
      el.append(h('span', { class: 'msk-tag' }, v, rm))
    }
    dl.replaceChildren(...(opts.suggestions ?? []).filter((s) => !values.includes(s)).map((s) => h('option', { value: s })))
    el.append(input, dl)
  }
  const add = () => {
    const v = input.value.replace(/,/g, '').trim()
    input.value = ''
    if (v && !values.some((x) => x.toLocaleLowerCase() === v.toLocaleLowerCase())) {
      values = [...values, v]
      opts.onChange(values)
      draw()
      input.focus()
    }
  }
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault()
      add()
    } else if (ev.key === 'Backspace' && !input.value && values.length) {
      values = values.slice(0, -1)
      opts.onChange(values)
      draw()
      input.focus()
    }
  })
  input.addEventListener('blur', add)
  draw()
  return { el, set: (v) => ((values = [...v]), draw()), get: () => values }
}

// --------------------------------------------------------------------------------------------------------- person picker

export interface PersonPickerOptions {
  label: string
  search: (q: string) => Promise<DirectoryUser[]>
  value: DirectoryUser | null
  onChange: (u: DirectoryUser | null) => void
  placeholder?: string
  clearLabel?: string
  noneLabel?: string
}

/** Chooses one person of the tenant (`search` is `(q) => msk.directory.search({ kind: 'user', q })`); shows the avatar and a clear button. */
export function personPicker(opts: PersonPickerOptions): { el: HTMLElement; set: (u: DirectoryUser | null) => void } {
  let value = opts.value
  const el = h('div', { class: 'msk-person' })
  const input = h('input', { type: 'search', 'aria-label': opts.label, placeholder: opts.placeholder ?? '', autocomplete: 'off' })
  const list = h('ul', { class: 'msk-person-list', role: 'listbox', 'aria-label': opts.label })
  list.hidden = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let token = 0
  const chosen = () => {
    el.replaceChildren()
    if (value) {
      const clear = h('button', { type: 'button', class: 'msk-tagx', 'aria-label': `${opts.clearLabel ?? 'Clear'}: ${value.name}` }, '×')
      clear.addEventListener('click', () => pick(null))
      el.append(h('span', { class: 'msk-person-sel' }, avatar(value.name), h('span', {}, value.name), clear))
    } else el.append(input, list)
  }
  const pick = (u: DirectoryUser | null) => {
    value = u
    opts.onChange(u)
    chosen()
    if (!u) input.focus()
  }
  input.addEventListener('input', () => {
    clearTimeout(timer)
    const q = input.value.trim()
    if (!q) {
      list.hidden = true
      return
    }
    timer = setTimeout(async () => {
      const mine = ++token
      let found: DirectoryUser[] = []
      try {
        found = await opts.search(q.slice(0, 64))
      } catch {
        found = []
      }
      if (mine !== token) return
      list.replaceChildren()
      for (const u of found) {
        const b = h('button', { type: 'button', role: 'option', class: 'msk-person-opt' }, avatar(u.name), h('span', {}, u.name), h('span', { class: 'msk-person-user' }, u.username))
        b.addEventListener('click', () => pick(u))
        list.append(h('li', {}, b))
      }
      if (!found.length) list.append(h('li', { class: 'msk-person-none' }, opts.noneLabel ?? 'No one found'))
      list.hidden = false
    }, 180)
  })
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') list.hidden = true
  })
  chosen()
  return { el, set: (u) => ((value = u), chosen()) }
}

// ------------------------------------------------------------------------------------------------------------ date field

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The ISO date `days` from `from` (today by default). */
export function addDays(days: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days)
  return iso(d)
}

/** A date input with shortcuts (today, tomorrow, next week, none). `value` is `YYYY-MM-DD` or ''. */
export function dateField(opts: { label: string; value: string; onChange: (v: string) => void; labels?: { today?: string; tomorrow?: string; nextWeek?: string; none?: string } }): { el: HTMLElement; set: (v: string) => void } {
  const L = { today: 'Today', tomorrow: 'Tomorrow', nextWeek: 'Next week', none: 'No date', ...opts.labels }
  const input = h('input', { type: 'date', 'aria-label': opts.label })
  input.value = opts.value
  const change = (v: string) => {
    input.value = v
    opts.onChange(v)
  }
  input.addEventListener('change', () => opts.onChange(input.value))
  const quick = h('div', { class: 'msk-quick' })
  for (const [text, v] of [
    [L.today, () => addDays(0)],
    [L.tomorrow, () => addDays(1)],
    [L.nextWeek, () => addDays(7)],
    [L.none, () => ''],
  ] as [string, () => string][]) {
    const b = h('button', { type: 'button', class: 'msk-btn ghost mini' }, text)
    b.addEventListener('click', () => change(v()))
    quick.append(b)
  }
  return { el: h('div', { class: 'msk-datefield' }, input, quick), set: (v) => (input.value = v) }
}

// ------------------------------------------------------------------------------------------------------------- timeline

export interface TimelineItem {
  who: string
  when: string
  text: string
}

/** A vertical history (reviews, comments, changes): avatar, who and when, text. */
export function timeline(items: TimelineItem[]): HTMLElement {
  const ol = h('ol', { class: 'msk-timeline' })
  for (const it of items) ol.append(h('li', {}, avatar(it.who), h('div', {}, h('div', { class: 'msk-tl-head' }, h('b', {}, it.who), h('span', { class: 'msk-tl-when' }, it.when)), h('div', { class: 'msk-tl-text' }, it.text))))
  return ol
}

// -------------------------------------------------------------------------------------------------------- avatar stack

/** Overlapping avatars of `names`, at most `max` (4), then a «+N» pill. */
export function avatarStack(names: string[], max = 4): HTMLElement {
  const e = h('span', { class: 'msk-avstack', role: 'img', 'aria-label': names.join(', ') })
  for (const n of names.slice(0, max)) e.append(avatar(n))
  if (names.length > max) e.append(h('span', { class: 'msk-avatar more', 'aria-hidden': 'true' }, `+${names.length - max}`))
  return e
}
