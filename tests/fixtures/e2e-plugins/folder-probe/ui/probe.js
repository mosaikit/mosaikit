// The bare bridge of a plugin page (no library): `hello`, then the calls the browser test looks at.
const host = new URLSearchParams(location.search).get('host')
let n = 0
const pending = new Map()
window.addEventListener('message', (ev) => {
  const m = ev.data
  if (ev.origin !== host || !m || m.msk !== 1 || !pending.has(m.id)) return
  pending.get(m.id)(m)
  pending.delete(m.id)
})
function call(op, args) {
  return new Promise((resolve) => {
    const id = String(++n)
    pending.set(id, resolve)
    window.parent.postMessage({ msk: 1, id, op, args }, host)
  })
}
const show = (id, text) => (document.getElementById(id).textContent = text)
const answer = (r) => (r.err ? `err:${r.code ?? r.status ?? ''}` : 'ok')

const hello = await call('hello', { api: 1 })
show('at', hello.ok?.at ?? '')
const at = hello.ok?.at ?? ''
// list the Files area of another plugin: files_read is enough
show('list', answer(await call('files.list', { source: 'com.mosaikit.files' })))
// write in it: refused, the manifest has no files_write
show('mkdir', answer(await call('files.mkdir', { name: 'nope', source: 'com.mosaikit.files' })))
// what the folder looks like, when the page was opened at one
const m = /^profile\/([a-z0-9_]+)\/([0-9a-f-]{36})\?source=(.+)$/.exec(at)
if (m) {
  const r = await call('files.profiles', { id: m[2], source: m[3] })
  show('profiles', r.err ? answer(r) : r.ok.suggestions.map((s) => s.profile).join(','))
}
