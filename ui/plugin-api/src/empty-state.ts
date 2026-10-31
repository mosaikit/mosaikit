// The empty state of a plugin page, the twin of `Empty` of the host (docs/refactoring-ui.md, rule «Empty states»): a list
// or a page with nothing in it shows, centred in the content area, a picture of soft rounded tiles, a bold title, a short
// grey text and the buttons of what to do (the primary action of the page is repeated). Never a bare «no items» line.
// A filter that matches nothing is NOT an empty state: `filtered` gives the small plain message with «Clear filters».

/** The pictures of the plugins (the pages of the host have their own). */
export type ArtName = 'documents' | 'maps' | 'notes' | 'tasks' | 'contacts' | 'apps' | 'generic'

/** The symbol of each picture: paths on a 24x24 grid, drawn in white on the big tile. */
const GLYPHS: Record<ArtName, string[]> = {
  documents: ['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h6', 'M10 17h4'],
  maps: ['M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z', 'M12 8.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z'],
  notes: ['M5 4h14v16H5z', 'M8 9h8', 'M8 13h8', 'M8 17h5'],
  tasks: ['M4 12.5l4.5 4.5L20 6.5'],
  contacts: ['M12 5.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5'],
  apps: ['M4 4h6.5v6.5H4z', 'M13.5 4H20v6.5h-6.5z', 'M4 13.5h6.5V20H4z', 'M13.5 13.5H20V20h-6.5z'],
  generic: ['M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'],
}

const NS = 'http://www.w3.org/2000/svg'
const svg = (tag: string, attrs: Record<string, string | number>, ...kids: Element[]) => {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  e.append(...kids)
  return e
}

let counter = 0

/** The picture: three tilted tiles (two small ones of other colours behind the accent one that carries the symbol). */
export function emptyArt(name: ArtName = 'generic'): SVGElement {
  const id = `msk-eg-${++counter}`
  const tile = (x: number, y: number, s: number, r: number, rot: number, fill: string) =>
    svg(
      'g',
      { transform: `rotate(${rot} ${x + s / 2} ${y + s / 2})` },
      svg('rect', { x, y: y + 3, width: s, height: s, rx: r, fill: '#000', opacity: 0.1 }),
      svg('rect', { x, y, width: s, height: s, rx: r, fill }),
      svg('rect', { x, y, width: s, height: s, rx: r, fill: `url(#${id})` }),
    )
  const grad = svg(
    'linearGradient',
    { id, x1: 0, y1: 0, x2: 1, y2: 1 },
    svg('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.38 }),
    svg('stop', { offset: 0.55, 'stop-color': '#fff', 'stop-opacity': 0 }),
    svg('stop', { offset: 1, 'stop-color': '#000', 'stop-opacity': 0.16 }),
  )
  const glyph = svg(
    'g',
    { transform: 'translate(86 40) scale(1.333)', fill: 'none', stroke: 'var(--on-acc, #fff)', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    ...(GLYPHS[name] ?? GLYPHS.generic).map((d) => svg('path', { d })),
  )
  const root = svg(
    'svg',
    { viewBox: '0 0 200 132', class: 'msk-emptyart', 'aria-hidden': 'true', 'data-art': name },
    svg('defs', {}, grad),
    svg('circle', { cx: 30, cy: 30, r: 5, fill: 'hsl(190 60% 48%)', opacity: 0.55 }),
    svg('circle', { cx: 176, cy: 102, r: 6, fill: 'hsl(150 45% 48%)', opacity: 0.5 }),
    svg('circle', { cx: 168, cy: 26, r: 3.5, fill: 'hsl(330 60% 62%)', opacity: 0.6 }),
    tile(30, 44, 46, 14, -14, 'hsl(190 60% 48%)'),
    tile(126, 40, 44, 14, 12, 'hsl(262 52% 62%)'),
    tile(70, 24, 64, 20, 0, 'var(--acc)'),
    glyph,
    svg('rect', { x: 64, y: 104, width: 72, height: 7, rx: 3.5, fill: 'currentColor', opacity: 0.08 }),
  )
  return root as SVGElement
}

export interface EmptyStateOptions {
  art?: ArtName
  title: string
  /** one short line under the title */
  text?: string
  /** the buttons of what to do; the primary action of the page goes here too */
  actions?: HTMLElement[]
}

/** The illustrated empty state, to put where the list would be. */
export function emptyState(o: EmptyStateOptions): HTMLElement {
  const box = document.createElement('section')
  box.className = 'msk-emptystate'
  box.dataset.testid = 'empty-state'
  const title = document.createElement('h2')
  title.textContent = o.title
  box.append(emptyArt(o.art), title)
  if (o.text) {
    const p = document.createElement('p')
    p.textContent = o.text
    box.append(p)
  }
  if (o.actions?.length) {
    const row = document.createElement('div')
    row.className = 'msk-emptyacts'
    row.append(...o.actions)
    box.append(row)
  }
  return box
}

/** A filter that matches nothing: a small plain message and «Clear filters» (never the big picture). */
export function filteredEmpty(message: string, clearLabel: string, onClear: () => void): HTMLElement {
  const box = document.createElement('div')
  box.className = 'msk-emptyfiltered'
  box.setAttribute('role', 'status')
  box.dataset.testid = 'empty-filtered'
  const span = document.createElement('span')
  span.textContent = message
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'msk-link'
  b.textContent = clearLabel
  b.addEventListener('click', onClear)
  box.append(span, b)
  return box
}
