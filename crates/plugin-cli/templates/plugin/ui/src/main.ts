// UI of the plugin {{label}}: it runs in an iframe on a separate origin and talks to
// the host only through @mosaikit/plugin-api (no direct fetch, no tokens).

import '@mosaikit/plugin-api/style.css'
import { connect, errText, mountCrud } from '@mosaikit/plugin-api'

const app = document.getElementById('app')!

async function main() {
  const msk = await connect()
  // generic CRUD driven by the manifest; for a custom UI use msk.crud('{{table}}'),
  // msk.call('{{table}}.summary') and msk.share(id) (share dialog of the host).
  mountCrud(app, msk, '{{table}}', { title: '{{label}}' })
}

main().catch((e) => {
  app.textContent = 'Cannot start the UI of the plugin: ' + errText(e)
})
