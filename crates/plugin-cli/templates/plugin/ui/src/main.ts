// UI of the plugin {{label}}: it runs in an iframe on a separate origin and talks to
// the host only through @mosaikit/plugin-api (no direct fetch, no tokens).

import '@mosaikit/plugin-api/style.css'
import { chip, connect, errText, mountCrud, type Msk } from '@mosaikit/plugin-api'
import { texts } from './i18n.ts'

const app = document.getElementById('app')!

function mount(msk: Msk) {
  // A page of the list with a filter, sortable columns and an illustrated empty state. The form of an item
  // is a dialog: it opens with «New» and when you select a row, and closes with Save, Cancel or Escape.
  // The page and its fields come from the manifest (plugin.toml). For a page of your own use
  // msk.crud('{{table}}'), msk.call('{{table}}.summary') and msk.share(id) (share dialog of the host);
  // remove `form: 'modal'` to have the form under the list instead.
  const open = (lang: string | undefined) => {
    const t = texts(lang)
    return mountCrud(app, msk, '{{table}}', {
      title: t.title,
      newLabel: t.newLabel,
      form: 'modal',
      // the status as a coloured chip; every other cell keeps the default
      cell: (field, row, text) => {
        if (field.key !== 'status' || !text) return undefined
        const v = row.values.status
        return chip(text, v === 'active' ? 'ok' : v === 'draft' ? 'acc' : '')
      },
      empty: { art: 'generic', title: t.emptyTitle, text: t.emptyText },
    })
  }
  let off = open(msk.context?.lang)
  // the texts of the manifest follow the host by themselves; ours need the page drawn again
  msk.onContext((ctx) => {
    off()
    off = open(ctx.lang)
  })
}

connect()
  .then(mount)
  .catch((e) => {
    app.textContent = texts(undefined).failed + errText(e)
  })
