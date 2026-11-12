// A board with columns whose cards move by drag and drop (mouse, pen and touch: pointer events) or with the keyboard
// (focus a card, Alt+Arrow Left or Right moves it to the neighbouring column, Alt+Arrow Up or Down reorders it). The
// board only reports the move (`onMove`); the plugin writes it and calls `set` again with the new state.
import { h } from './dom.ts'

export interface KanbanColumn {
  key: string
  label: string
  /** a dot colour from the tokens: `ok`, `err`, `acc` or nothing */
  tone?: 'ok' | 'err' | 'acc' | ''
  /** false: cards cannot be dropped here (a derived column such as «Overdue») */
  droppable?: boolean
}

export interface KanbanOptions<T> {
  label: string
  columns: KanbanColumn[]
  columnOf: (item: T) => string
  id: (item: T) => string
  card: (item: T) => HTMLElement
  /** called after a drop or a keyboard move: the item, the column, the position in it (0-based) and the id of the card it now precedes (null: last) */
  onMove: (item: T, column: string, index: number, before: string | null) => void
  /** false: the card is fixed (no write access) */
  canMove?: (item: T) => boolean
  onOpen?: (item: T) => void
  emptyText?: string
  /** announced when a card moves: `{title}` and `{column}` are replaced */
  movedText?: string
  title?: (item: T) => string
}

export interface Kanban<T> {
  el: HTMLElement
  set(items: T[]): void
}

const THRESHOLD = 5

export function kanban<T>(o: KanbanOptions<T>): Kanban<T> {
  const el = h('div', { class: 'msk-kanban', role: 'group', 'aria-label': o.label })
  const live = h('div', { class: 'msk-sr', role: 'status', 'aria-live': 'polite' })
  const lists = new Map<string, HTMLElement>()
  const counts = new Map<string, HTMLElement>()
  let items: T[] = []

  const cols = h('div', { class: 'msk-kcols' })
  for (const c of o.columns) {
    const list = h('div', { class: 'msk-klist', 'data-col': c.key, role: 'list', 'aria-label': c.label })
    const count = h('span', { class: 'msk-colcount' }, '0')
    const head = h('h2', {}, ...(c.tone ? [h('span', { class: 'msk-kdot ' + c.tone })] : []), c.label, count)
    lists.set(c.key, list)
    counts.set(c.key, count)
    cols.append(h('section', { class: 'msk-kcol' + (c.droppable === false ? ' fixed' : ''), 'data-col': c.key }, head, list))
  }
  el.append(cols, live)

  const cardOf = (item: T) => {
    const card = h('div', { class: 'msk-kcard', role: 'listitem', tabindex: '0', 'data-id': o.id(item) }, o.card(item))
    const movable = o.canMove ? o.canMove(item) : true
    if (movable) card.setAttribute('aria-roledescription', 'draggable card')
    card.addEventListener('click', () => !dragging && o.onOpen?.(item))
    card.addEventListener('keydown', (ev) => {
      if (ev.target !== card) return
      if (ev.key === 'Enter' && !ev.altKey) return o.onOpen?.(item)
      if (!movable || !ev.altKey) return
      const col = o.columnOf(item)
      const ci = o.columns.findIndex((c) => c.key === col)
      const siblings = items.filter((x) => o.columnOf(x) === col)
      const at = siblings.indexOf(item)
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        let to = ci + (ev.key === 'ArrowRight' ? 1 : -1)
        while (o.columns[to] && o.columns[to]!.droppable === false) to += ev.key === 'ArrowRight' ? 1 : -1
        const target = o.columns[to]
        if (!target) return
        ev.preventDefault()
        announce(item, target)
        o.onMove(item, target.key, 0, firstOf(target.key))
        refocus(o.id(item))
      } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        const dest = at + (ev.key === 'ArrowDown' ? 1 : -1)
        if (dest < 0 || dest >= siblings.length) return
        ev.preventDefault()
        const before = ev.key === 'ArrowDown' ? (siblings[dest + 1] ? o.id(siblings[dest + 1]!) : null) : o.id(siblings[dest]!)
        o.onMove(item, col, dest, before)
        refocus(o.id(item))
      }
    })
    if (movable) card.addEventListener('pointerdown', (ev) => start(ev, card, item))
    return card
  }
  const firstOf = (col: string) => {
    const first = items.find((x) => o.columnOf(x) === col)
    return first ? o.id(first) : null
  }
  const announce = (item: T, col: KanbanColumn) => {
    const t = (o.movedText ?? '{title} moved to {column}').replace('{title}', o.title?.(item) ?? '').replace('{column}', col.label)
    live.textContent = t
  }
  const refocus = (id: string) => queueMicrotask(() => setTimeout(() => el.querySelector<HTMLElement>(`.msk-kcard[data-id="${CSS.escape(id)}"]`)?.focus(), 0))

  // ------------------------------------------------------------------------------------------------ pointer drag
  let dragging = false
  const start = (ev: PointerEvent, card: HTMLElement, item: T) => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest('input, button, a, select, textarea')) return
    const x0 = ev.clientX
    const y0 = ev.clientY
    let ghost: HTMLElement | null = null
    let target: { col: string; before: string | null } | null = null
    const over = (x: number, y: number) => {
      ghost!.style.visibility = 'hidden'
      const at = document.elementFromPoint(x, y) as HTMLElement | null
      ghost!.style.visibility = ''
      const colEl = at?.closest<HTMLElement>('.msk-kcol')
      el.querySelectorAll('.msk-kcol.over').forEach((c) => c.classList.remove('over'))
      el.querySelectorAll('.msk-kdrop').forEach((c) => c.remove())
      if (!colEl || colEl.classList.contains('fixed')) return (target = null)
      colEl.classList.add('over')
      const list = colEl.querySelector<HTMLElement>('.msk-klist')!
      let before: HTMLElement | null = null
      for (const c of list.querySelectorAll<HTMLElement>('.msk-kcard:not(.dragging)')) {
        const r = c.getBoundingClientRect()
        if (y < r.top + r.height / 2) {
          before = c
          break
        }
      }
      const mark = h('div', { class: 'msk-kdrop' })
      list.insertBefore(mark, before)
      target = { col: colEl.dataset.col!, before: before?.dataset.id ?? null }
    }
    const move = (e: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < THRESHOLD) return
        dragging = true
        card.classList.add('dragging')
        const r = card.getBoundingClientRect()
        ghost = card.cloneNode(true) as HTMLElement
        ghost.classList.add('msk-kghost')
        ghost.removeAttribute('tabindex')
        ghost.style.width = `${r.width}px`
        ghost.style.left = `${r.left}px`
        ghost.style.top = `${r.top}px`
        document.body.append(ghost)
        try {
          card.setPointerCapture(ev.pointerId)
        } catch {
          /* synthetic events have no capture */
        }
      }
      e.preventDefault()
      ghost.style.transform = `translate(${e.clientX - x0}px, ${e.clientY - y0}px) rotate(2deg)`
      over(e.clientX, e.clientY)
    }
    const end = () => {
      card.removeEventListener('pointermove', move)
      card.removeEventListener('pointerup', end)
      card.removeEventListener('pointercancel', cancel)
      const t = target
      cleanup()
      if (t) {
        const col = o.columns.find((c) => c.key === t.col)!
        const same = items.filter((x) => o.columnOf(x) === t.col && x !== item)
        const idx = t.before ? same.findIndex((x) => o.id(x) === t.before) : same.length
        if (o.columnOf(item) !== t.col) announce(item, col)
        o.onMove(item, t.col, idx < 0 ? same.length : idx, t.before)
      }
      setTimeout(() => (dragging = false), 0)
    }
    const cancel = () => {
      card.removeEventListener('pointermove', move)
      card.removeEventListener('pointerup', end)
      card.removeEventListener('pointercancel', cancel)
      target = null
      cleanup()
      setTimeout(() => (dragging = false), 0)
    }
    const cleanup = () => {
      ghost?.remove()
      card.classList.remove('dragging')
      el.querySelectorAll('.msk-kcol.over').forEach((c) => c.classList.remove('over'))
      el.querySelectorAll('.msk-kdrop').forEach((c) => c.remove())
    }
    card.addEventListener('pointermove', move)
    card.addEventListener('pointerup', end)
    card.addEventListener('pointercancel', cancel)
  }

  const set = (next: T[]) => {
    items = next
    for (const c of o.columns) {
      const list = lists.get(c.key)!
      const mine = next.filter((x) => o.columnOf(x) === c.key)
      list.replaceChildren(...(mine.length ? mine.map(cardOf) : [h('div', { class: 'msk-colempty', role: 'listitem' }, o.emptyText ?? '—')]))
      counts.get(c.key)!.textContent = String(mine.length)
    }
  }
  return { el, set }
}
