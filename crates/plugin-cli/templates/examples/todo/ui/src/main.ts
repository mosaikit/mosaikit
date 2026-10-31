// EXAMPLE 1 - UI of the to-do list. It runs in an iframe on a separate origin and talks to the host only through
// @mosaikit/plugin-api (no direct fetch, no tokens).
//
// `mountCrud` draws the whole page from the manifest: the header with the title and the "new" button, the list
// with the search and the filters, the detail panel with the form, sharing, the trash. This file adds only what is
// specific to tasks: which tasks each page of the navigation shows, how an item looks in the list, and the texts.

import '@mosaikit/plugin-api/style.css'
import { chip, connect, el, errText, mountCrud, type CrudView, type ItemCtx, type Msk, type Row } from '@mosaikit/plugin-api'
import { fill, texts } from './i18n.ts'
import { isDone, isOverdue, pageFilter } from './tasks.ts'

const app = document.getElementById('app')!

function mount(msk: Msk) {
  const t = () => texts(msk.context?.lang)

  // STEP 5 - how a task looks in the list: a check box that completes it, the title, a chip with the due date.
  // `ctx.update` saves a partial change and draws the list again; `ctx.canWrite` is false for a person who
  // may only read the task (it was shared with them read-only).
  const item = (c: ItemCtx): HTMLElement => {
    const done = isDone(c.row.values)
    const box = el('input', { type: 'checkbox', class: 'msk-check', 'aria-label': fill(done ? t().reopen : t().mark, { t: c.text('title') }) })
    box.checked = done
    box.disabled = !c.canWrite
    // the box must not open the detail panel of the item
    box.addEventListener('click', (e) => e.stopPropagation())
    box.addEventListener('change', () => void c.update({ done: box.checked }).catch((e) => msk.toast(errText(e), true)))
    const line = el('div', { class: 'msk-row' }, box, el('strong', {}, c.text('title')))
    const due = c.value('due')
    if (typeof due === 'string' && due) {
      line.append(chip(fill(t().due, { d: due }), isOverdue(c.row.values) ? 'err' : ''))
    }
    return line
  }

  // The views of the items: more than one adds a switch in the header.
  const views = (): CrudView[] => [
    { key: 'list', label: t().list, kind: 'list', item },
    { key: 'cards', label: t().cards, kind: 'cards', item },
  ]

  // The page that is open comes from `[[nav]]` of the manifest (`msk.at`).
  const where = pageFilter(msk.at)

  const open = () =>
    mountCrud(app, msk, '{{table}}', {
      title: t().title,
      newLabel: t().newLabel,
      columns: ['title', 'due', 'priority', 'done'],
      where: (row: Row) => where(row.values),
      views: views(),
      // an empty list is never a bare line: a picture, a title, a text and the main action (the "new" button)
      empty: { art: 'tasks', title: t().emptyTitle, text: t().emptyText },
    })
  let off = open()
  // the texts of the manifest follow the host by themselves; the ones of this file need the page drawn again
  msk.onContext(() => {
    off()
    off = open()
  })
}

connect()
  .then(mount)
  .catch((e) => {
    app.textContent = texts(undefined).failed + errText(e)
  })
