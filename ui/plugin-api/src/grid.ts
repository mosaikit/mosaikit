// The table of the lists of the plugins, the twin of the `ListTable` of the host: the page does not scroll, the header row
// stays where it is and ONLY the rows scroll (the scrollbar starts under the header row); the titles of the columns sort the
// rows (ascending, descending, the order of the source); the foot of the list (the button «Load more») is the last row
// of the rows that scroll, so more rows load only when the end comes into view.

export interface GridCol<T> {
  key: string
  title: string
  /** a CSS grid track (`3rem`, `minmax(8rem,2fr)`); the default is `minmax(7rem,1fr)` */
  width?: string
  align?: 'right'
  /** the value the column sorts by; without it the title is not a button */
  sort?: (r: T) => string | number | null | undefined
  cell: (r: T) => Node | string
  className?: string
}

export interface GridOptions<T> {
  columns: GridCol<T>[]
  /** the accessible name of the table */
  label: string
  /** called for every row drawn: classes, listeners, tabindex */
  decorate?: (r: T, tr: HTMLTableRowElement) => void
}

export interface Grid<T> {
  /** the card that holds the table */
  el: HTMLElement
  /** draws the rows; `foot` (the button that loads more) goes as the last row; `empty` is the text of a table without rows */
  set(rows: T[], foot?: HTMLElement | null, empty?: string): void
  /** the scrolling part: the root of the observer of the infinite scroll */
  scroller: HTMLElement
  /** other columns (the fields are known only after the first load) */
  columns(cols: GridCol<T>[]): void
}

/** Numbers sort as numbers, text by the language and with numbers inside as numbers; empty values go last. */
export function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const x = a ?? null
  const y = b ?? null
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
  if (typeof x === 'number' && typeof y === 'number') return x - y
  return String(x).localeCompare(String(y), undefined, { numeric: true })
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', role?: string, ...kids: (Node | string)[]) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (role) e.setAttribute('role', role)
  e.append(...kids)
  return e
}

export function gridTable<T>(o: GridOptions<T>): Grid<T> {
  let cols = o.columns
  let sort: { key: string; dir: 1 | -1 } | null = null
  let rows: T[] = []
  let foot: HTMLElement | null = null
  let empty = ''
  const thead = el('thead', '', 'rowgroup')
  const tbody = el('tbody', '', 'rowgroup')
  tbody.dataset.listscroll = ''
  const table = el('table', 'msk-grid', 'table', thead, tbody)
  table.setAttribute('aria-label', o.label)
  table.style.setProperty('--cols', cols.map((c) => c.width ?? 'minmax(7rem,1fr)').join(' '))
  const wrap = el('div', 'msk-gridwrap', undefined, table)

  function head() {
    const tr = el('tr', '', 'row')
    for (const c of cols) {
      const th = el('th', c.align === 'right' ? 'right' : '', 'columnheader')
      if (c.sort) {
        const on = sort?.key === c.key
        th.setAttribute('aria-sort', on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none')
        const b = el('button', 'msk-sorthead')
        b.type = 'button'
        // the arrow is drawn by the style (data-mark): the text of the title stays the title
        b.dataset.mark = on ? (sort!.dir === 1 ? '▲' : '▼') : '↕'
        b.append(c.title)
        b.addEventListener('click', () => {
          sort = sort?.key !== c.key ? { key: c.key, dir: 1 } : sort.dir === 1 ? { key: c.key, dir: -1 } : null
          head()
          body()
          // the focus stays on the title that was clicked
          thead.querySelectorAll<HTMLElement>('button.msk-sorthead')[cols.filter((x) => x.sort).findIndex((x) => x.key === c.key)]?.focus()
        })
        th.append(b)
      } else th.append(c.title)
      tr.append(th)
    }
    thead.replaceChildren(tr)
  }

  function body() {
    const col = sort ? cols.find((c) => c.key === sort!.key) : undefined
    const list = col?.sort && sort ? [...rows].sort((a, b) => sort!.dir * compare(col.sort!(a), col.sort!(b))) : rows
    const trs = list.map((r) => {
      const tr = el('tr', '', 'row')
      for (const c of cols) {
        const td = el('td', [c.align === 'right' ? 'right' : '', c.className ?? ''].join(' ').trim(), 'cell')
        td.append(c.cell(r))
        tr.append(td)
      }
      o.decorate?.(r, tr)
      return tr
    })
    if (!trs.length) trs.push(el('tr', '', 'row', el('td', 'empty', 'cell', empty)))
    if (foot) {
      const tr = el('tr', '', 'row', el('td', 'foot', 'cell', foot))
      tr.dataset.foot = ''
      trs.push(tr)
    }
    tbody.replaceChildren(...trs)
  }

  head()
  return {
    el: wrap,
    scroller: tbody,
    columns(c) {
      cols = c
      if (sort && !c.some((x) => x.key === sort!.key)) sort = null
      table.style.setProperty('--cols', c.map((x) => x.width ?? 'minmax(7rem,1fr)').join(' '))
      head()
    },
    set(r, f = null, e = '') {
      rows = r
      foot = f
      empty = e
      body()
    },
  }
}
