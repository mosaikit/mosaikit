import { describe, expect, it } from 'vitest'
import { OpError, routeOp } from './bridge.ts'

const ID = '8b0f6f3e-2d6a-4c7e-9a51-0c6a3d2b1f10'

describe('routeOp', () => {
  it('limita ogni chiamata al plugin e al tenant dell\'iframe', () => {
    const c = routeOp('alfa', 'com.mosaikit.notes', 'crud.list', { resource: 'notes', filter: 'roma' })
    expect(c).toEqual({ method: 'GET', url: '/api/t/alfa/p/com.mosaikit.notes/r/notes?filter=roma' })
    // il plugin non puo' scegliere un altro plugin: gli argomenti in piu' sono ignorati
    const d = routeOp('alfa', 'com.mosaikit.notes', 'crud.get', { resource: 'notes', id: ID, plugin: 'com.evil.x' })
    expect(d.url).toBe(`/api/t/alfa/p/com.mosaikit.notes/r/notes/${ID}`)
  })

  it('rifiuta identificatori che cambierebbero il percorso', () => {
    expect(() => routeOp('alfa', 'p.x', 'crud.list', { resource: '../../admin' })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'crud.get', { resource: 'notes', id: '1/../../x' })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'call', { name: 'a/b' })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'files.move', { id: ID, parent: 'radice' })).toThrow(OpError)
  })

  it('rifiuta operazioni sconosciute e valori complessi', () => {
    expect(() => routeOp('alfa', 'p.x', 'admin.install', {})).toThrow(/non disponibile/)
    expect(() => routeOp('alfa', 'p.x', 'crud.create', { resource: 'notes', values: { a: { nested: 1 } } })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'files.upload', { name: 'a.txt', file: 'non un blob' })).toThrow(OpError)
  })

  it('costruisce upload e ticket', () => {
    const f = new Blob(['x'])
    const u = routeOp('alfa', 'com.mosaikit.files', 'files.upload', { name: 'a b.txt', parent: ID, replace: true, file: f })
    expect(u.url).toBe(`/api/t/alfa/p/com.mosaikit.files/files/upload?name=a+b.txt&parent=${ID}&replace=1`)
    expect(u.raw).toBe(f)
    const t = routeOp('alfa', 'com.mosaikit.files', 'ticket', { id: ID, download: true })
    expect(t).toMatchObject({ method: 'POST', json: { download: true } })
  })
})
