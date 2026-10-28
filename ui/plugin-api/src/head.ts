/** The header of a page of a plugin, the same as the one of the pages of Mosaikit (same height, spacing, type and
 *  border): the title with a line under it at the left; at the right, in the same row, the filters and the actions. The header never scrolls: the page below it (`.msk-body`) does. */
export interface PageHead {
  /** the page (the entry of the navigation of the shell) */
  title: string
  /** the page of the navigation that is open inside it (a subsection): shown after the title, «Page › Subsection» */
  section?: string
  /** the line under the title (a count, a path): a node the plugin updates, or a text */
  sub?: Node | string
  /** buttons and menus at the right of the title, after the filters (the primary action last) */
  actions?: Node[]
  /** the search and the filters: in the first row of the header, at the right, just before the actions (they wrap
   *  under the title on a phone) */
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
  const line = el('div', 'msk-pline', h1)
  if (o.section) {
    h1.classList.add('parent')
    line.append(el('span', 'msk-psep', '›'), el('span', 'msk-psection', o.section))
  }
  const text = el('div', 'msk-ptitle', line)
  if (o.sub !== undefined) text.append(typeof o.sub === 'string' ? el('div', 'msk-psub', o.sub) : o.sub)
  if (o.sub instanceof HTMLElement) o.sub.classList.add('msk-psub')
  const head = el('div', 'msk-pagehead', text)
  // one row: title at the left; filters and actions at the right, the filter just left of the primary action
  if (o.filters?.length || o.actions?.length) head.append(el('div', 'msk-pacts msk-toolbar', ...(o.filters ?? []), ...(o.actions ?? [])))
  return el('div', 'msk-headwrap', head)
}

/** The scrolling part under a `pageHead`. */
export function pageBody(...kids: (Node | string)[]): HTMLElement {
  const e = document.createElement('div')
  e.className = 'msk-body'
  e.append(...kids)
  return e
}
