import '@mosaikit/plugin-api/style.css'
import { connect, mountCrud } from '@mosaikit/plugin-api'

const msk = await connect()
mountCrud(document.getElementById('app')!, msk, 'items', { title: 'Items' })
