// A list that draws only the rows in view, on @tanstack/virtual-core (MIT), vanilla DOM. The plugin gives the
// number of rows and a function that draws one; the helper keeps the scroll, the measures and the recycling.
// Rows are `role="listitem"` with aria-setsize/posinset so a screen reader knows the real length.
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from '@tanstack/virtual-core'
import { h } from './dom.ts'

export interface VirtualListOptions {
  count: number
  /** a guess of the height of a row, px; real heights are measured */
  estimateSize: number | ((index: number) => number)
  /** draws row `index` */
  render: (index: number) => HTMLElement
  /** a stable key per row (an id) so a reorder keeps the measures; the index by default */
  getKey?: (index: number) => string | number
  /** rows drawn beyond the view (6) */
  overscan?: number
  /** px between rows */
  gap?: number
  /** accessible name of the list */
  label?: string
}

export interface VirtualList {
  /** the scrolling container: give it a height (a flex child or `height`) */
  el: HTMLElement
  /** a new number of rows (after a filter or a reload); the visible ones are drawn again */
  setCount: (count: number) => void
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'end' | 'auto') => void
  /** draws the rows in view again (a row changed) */
  refresh: () => void
  /** the indexes drawn now */
  visible: () => number[]
  destroy: () => void
}

export function virtualList(opts: VirtualListOptions): VirtualList {
  const inner = h('div', { class: 'msk-vlist-inner', role: 'list' })
  if (opts.label) inner.setAttribute('aria-label', opts.label)
  const el = h('div', { class: 'msk-vlist', tabindex: '-1' }, inner)
  const drawn = new Map<number, HTMLElement>()
  const size = opts.estimateSize
  let count = opts.count
  let queued = false

  const paint = (force = false) => {
    inner.style.height = `${virt.getTotalSize()}px`
    const items = virt.getVirtualItems()
    const keep = new Set(items.map((i) => i.index))
    for (const [i, node] of [...drawn]) {
      if (force || !keep.has(i)) {
        node.remove()
        drawn.delete(i)
      }
    }
    for (const it of items) {
      let node = drawn.get(it.index)
      if (!node) {
        node = opts.render(it.index)
        node.classList.add('msk-vrow')
        node.setAttribute('role', 'listitem')
        node.setAttribute('aria-setsize', String(count))
        node.setAttribute('aria-posinset', String(it.index + 1))
        node.dataset.index = String(it.index)
        inner.append(node)
        drawn.set(it.index, node)
        virt.measureElement(node)
      }
      node.style.transform = `translateY(${it.start}px)`
    }
  }

  const virt = new Virtualizer<HTMLElement, HTMLElement>({
    count,
    getScrollElement: () => el,
    estimateSize: typeof size === 'function' ? size : () => size,
    overscan: opts.overscan ?? 6,
    gap: opts.gap ?? 0,
    getItemKey: opts.getKey ?? ((i) => i),
    scrollToFn: elementScroll,
    observeElementRect,
    observeElementOffset,
    // a measure arrives from the ResizeObserver after the paint: draw again once the browser has laid the rows out
    onChange: () => {
      paint()
      if (!queued) {
        queued = true
        requestAnimationFrame(() => ((queued = false), paint()))
      }
    },
  })
  const cleanup = virt._didMount()
  virt._willUpdate()
  paint()
  return {
    el,
    setCount(n) {
      count = n
      virt.setOptions({ ...virt.options, count: n })
      virt.measure()
      virt._willUpdate()
      paint(true)
    },
    scrollToIndex: (i, align = 'auto') => virt.scrollToIndex(i, { align }),
    refresh: () => paint(true),
    visible: () => [...drawn.keys()].sort((a, b) => a - b),
    destroy() {
      cleanup()
      drawn.clear()
      inner.replaceChildren()
    },
  }
}
