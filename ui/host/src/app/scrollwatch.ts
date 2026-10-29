// Marks a grid table with `data-scrolls` while its rows overflow, so the CSS shows the scrollbar (and the room the
// header keeps for it) only when it is needed. One observer per document; calling it again does nothing.

const TABLES = '.msk-grid, .msk-gridtable, .fm-table'

let started = false

export function watchTableScroll(doc: Document = document): void {
  if (started || typeof ResizeObserver === 'undefined') return
  started = true
  const seen = new WeakSet<Element>()
  let queued = false
  const ro = new ResizeObserver(() => schedule())
  const check = () => {
    queued = false
    for (const table of doc.querySelectorAll<HTMLElement>(TABLES)) {
      const body = table.querySelector('tbody')
      if (!body) continue
      if (!seen.has(body)) {
        seen.add(body)
        ro.observe(body)
      }
      const scrolls = body.scrollHeight > body.clientHeight + 1
      if (scrolls !== table.hasAttribute('data-scrolls')) table.toggleAttribute('data-scrolls', scrolls)
    }
  }
  const schedule = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(check)
  }
  new MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true })
  schedule()
}
