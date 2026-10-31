// UI of the plugin {{label}}: it runs in an iframe on a separate origin and talks to
// the host only through @mosaikit/plugin-api (no direct fetch, no tokens).

import '@mosaikit/plugin-api/style.css'
import { connect, errText, mountCrud, type Msk } from '@mosaikit/plugin-api'
import { texts } from './i18n.ts'

const app = document.getElementById('app')!

function mount(msk: Msk) {
  // generic CRUD driven by the manifest; for a custom UI use msk.crud('{{table}}'),
  // msk.call('{{table}}.summary') and msk.share(id) (share dialog of the host).
  const open = (lang: string | undefined) => {
    const t = texts(lang)
    return mountCrud(app, msk, '{{table}}', {
      title: t.title,
      newLabel: t.newLabel,
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
