// EXAMPLE 2 - UI of the expenses plugin. It has two pages, the ones of `[[nav]]` in the manifest:
//
// - `list`: the expenses, a plain `mountCrud` (list, search, form, sharing);
// - `overview`: a page of our own, drawn with the pieces of @mosaikit/plugin-api: `pageHead`, `pageBody`,
//   `emptyState`, and a chart of ours (chart.ts).
//
// The shell tells the UI which page is open (`msk.at`) and opens the same index.html for both.

import '@mosaikit/plugin-api/style.css'
import { connect, el, emptyState, errText, mountCrud, pageBody, pageHead, type Msk } from '@mosaikit/plugin-api'
import { barChart, type Total } from './chart.ts'
import { categoryLabel, fill, texts } from './i18n.ts'

const app = document.getElementById('app')!

/** STEP 5 - the page of our own. Data comes from the command of the logic (`msk.call`), already added up by the
 *  database for the rows the person may see. */
async function overview(msk: Msk): Promise<() => void> {
  const t = texts(msk.context?.lang)
  const head = pageHead({ title: t.overview })
  const body = pageBody()
  app.replaceChildren(head, body)
  const totals = await msk.call<Total[]>('{{table}}.by_category')
  if (!totals.length) {
    // the empty state of a page: the picture, the title, the text and the main action
    const add = el('button', { class: 'msk-btn primary', type: 'button' }, t.emptyAction)
    // `msk.crud(resource)` is the client of the items: list, get, create, update, remove
    add.addEventListener('click', () => {
      msk
        .crud('{{table}}')
        .create({ title: t.sampleTitle, amount: 3, category: 'food' })
        .then(() => overview(msk))
        .catch((e) => msk.toast(errText(e), true))
    })
    body.append(emptyState({ art: 'generic', title: t.emptyTitle, text: t.emptyText, actions: [add] }))
  } else {
    const items = totals.reduce((n, x) => n + x.items, 0)
    head.querySelector('.msk-ptitle')?.append(el('div', { class: 'msk-psub' }, fill(t.count, { n: items, c: totals.length })))
    body.append(barChart(totals, (c) => categoryLabel(t, c), t.chartName))
  }
  return () => undefined
}

async function mount(msk: Msk) {
  const open = (): Promise<() => void> | (() => void) => {
    if (msk.at === 'overview') return overview(msk)
    const t = texts(msk.context?.lang)
    return mountCrud(app, msk, '{{table}}', {
      title: t.title,
      newLabel: t.newLabel,
      columns: ['title', 'amount', 'category', 'spent_on'],
      empty: { art: 'generic', title: t.emptyTitle, text: t.emptyText },
    })
  }
  let off = await open()
  msk.onContext(() => {
    off()
    void Promise.resolve(open()).then((f) => (off = f))
  })
}

connect()
  .then(mount)
  .catch((e) => {
    app.textContent = texts(undefined).failed + errText(e)
  })
