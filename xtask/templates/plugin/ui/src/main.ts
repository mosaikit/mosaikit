// UI del plugin {{label}}: gira in un iframe su un'origine separata e parla con
// l'host solo tramite @mosaikit/plugin-api (niente fetch diretti, niente token).

import '@mosaikit/plugin-api/style.css'
import { connect, errText, mountCrud } from '@mosaikit/plugin-api'

const app = document.getElementById('app')!

async function main() {
  const msk = await connect()
  // CRUD generico guidato dal manifest; per una UI su misura usa msk.crud('{{table}}'),
  // msk.call('{{table}}.riepilogo') e msk.share(id) (finestra di condivisione dell'host).
  mountCrud(app, msk, '{{table}}', { title: '{{label}}' })
}

main().catch((e) => {
  app.textContent = 'Impossibile avviare la UI del plugin: ' + errText(e)
})
