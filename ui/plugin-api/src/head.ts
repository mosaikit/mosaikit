/** The header of a page of a plugin, the same as the one of the pages of Mosaikit (same height, spacing, type and
 *  border): the title with a line under it at the left, the actions at the right, and under it, if there are any,
 *  the bar of the filters. The header never scrolls: the page below it (`.msk-body`) does. */
export interface PageHead {
  title: string
  /** the line under the title (a count, a path): a node the plugin updates, or a text */
  sub?: Node | string
  /** buttons and menus at the right of the title */
  actions?: Node[]
  /** search and filters, in a bar under the title */
  filters?: Node[]
}

export function pageHead(o: PageHead): HTMLElement {
  const el = (tag: string, cls: string, ...kids: (Node | string)[]) => {
    const e = document.createElement(tag)
    e.className = cls
    e.append(...kids)
    return e
  }
  // the page does not scroll as a whole: the header and the bar stay, `.msk-body` scrolls
  document.documentElement.classList.add('msk-fill')
  const h1 = el('h1', '', o.title)
  const text = el('div', 'msk-ptitle', h1)
  if (o.sub !== undefined) text.append(typeof o.sub === 'string' ? el('div', 'msk-psub', o.sub) : o.sub)
  if (o.sub instanceof HTMLElement) o.sub.classList.add('msk-psub')
  const head = el('div', 'msk-pagehead', text)
  if (o.actions?.length) head.append(el('div', 'msk-pacts msk-toolbar', ...o.actions))
  const wrap = el('div', 'msk-headwrap', head)
  if (o.filters?.length) wrap.append(el('div', 'msk-filterbar', ...o.filters))
  return wrap
}

/** The scrolling part under a `pageHead`. */
export function pageBody(...kids: (Node | string)[]): HTMLElement {
  const e = document.createElement('div')
  e.className = 'msk-body'
  e.append(...kids)
  return e
}
