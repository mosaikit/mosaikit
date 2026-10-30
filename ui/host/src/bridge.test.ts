import { describe, expect, it } from 'vitest'
import { ApiError } from './api.ts'
import { errorReply, OpError, routeOp, safePage } from './bridge.ts'

const ID = '8b0f6f3e-2d6a-4c7e-9a51-0c6a3d2b1f10'

describe('routeOp', () => {
  it('limits every call to the plugin and the tenant of the iframe', () => {
    const c = routeOp('alfa', 'com.mosaikit.notes', 'crud.list', { resource: 'notes', filter: 'roma' })
    expect(c).toEqual({ method: 'GET', url: '/api/t/alfa/p/com.mosaikit.notes/r/notes?filter=roma' })
    // the plugin cannot choose another plugin: the extra arguments are ignored
    const d = routeOp('alfa', 'com.mosaikit.notes', 'crud.get', { resource: 'notes', id: ID, plugin: 'com.evil.x' })
    expect(d.url).toBe(`/api/t/alfa/p/com.mosaikit.notes/r/notes/${ID}`)
  })

  it('passes a page of the list, bounded', () => {
    const c = routeOp('alfa', 'p.x', 'crud.list', { resource: 'notes', limit: 100, cursor: 'a|b' })
    expect(c.url).toBe('/api/t/alfa/p/p.x/r/notes?limit=100&cursor=a%7Cb')
    // at most 500 rows a page; a limit that is not a positive integer is ignored
    expect(routeOp('alfa', 'p.x', 'crud.list', { resource: 'notes', limit: 9999 }).url).toBe('/api/t/alfa/p/p.x/r/notes?limit=500')
    expect(routeOp('alfa', 'p.x', 'crud.list', { resource: 'notes', limit: -1 }).url).toBe('/api/t/alfa/p/p.x/r/notes')
    // the sort of the whole list: a plain field name and a direction, nothing else reaches the server
    expect(routeOp('alfa', 'p.x', 'crud.list', { resource: 'notes', limit: 5, sort: 'title', dir: 'desc' }).url).toBe('/api/t/alfa/p/p.x/r/notes?limit=5&sort=title&dir=desc')
    expect(routeOp('alfa', 'p.x', 'crud.list', { resource: 'notes', sort: 'title; drop', dir: 'desc' }).url).toBe('/api/t/alfa/p/p.x/r/notes')
    expect(routeOp('alfa', 'p.x', 'crud.list', { resource: 'notes', sort: 'title', dir: 'up' }).url).toBe('/api/t/alfa/p/p.x/r/notes?sort=title')
  })

  it('refuses identifiers that would change the path', () => {
    expect(() => routeOp('alfa', 'p.x', 'crud.list', { resource: '../../admin' })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'crud.get', { resource: 'notes', id: '1/../../x' })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'call', { name: 'a/b' })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'files.move', { id: ID, parent: 'radice' })).toThrow(OpError)
  })

  it('refuses unknown operations and complex values', () => {
    expect(() => routeOp('alfa', 'p.x', 'admin.install', {})).toThrow(/not available/)
    expect(() => routeOp('alfa', 'p.x', 'crud.create', { resource: 'notes', values: { a: { nested: 1 } } })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'files.upload', { name: 'a.txt', file: 'not a blob' })).toThrow(OpError)
  })

  it('costruisce upload e ticket', () => {
    const f = new Blob(['x'])
    const u = routeOp('alfa', 'com.mosaikit.files', 'files.upload', { name: 'a b.txt', parent: ID, replace: true, file: f })
    expect(u.url).toBe(`/api/t/alfa/p/com.mosaikit.files/files/upload?name=a+b.txt&parent=${ID}&replace=1`)
    expect(u.raw).toBe(f)
    const t = routeOp('alfa', 'com.mosaikit.files', 'ticket', { id: ID, download: true })
    expect(t).toMatchObject({ method: 'POST', json: { download: true } })
  })

  it('builds the notifications of the plugin, limited to the plugin and without recipients', () => {
    const n = routeOp('alfa', 'com.mosaikit.notes', 'notify', { title: 'Due today', body: 'Plan', at: 'notes/1', resource: ID, to: 'everybody' })
    expect(n).toEqual({ method: 'POST', url: '/api/t/alfa/p/com.mosaikit.notes/notify', json: { title: 'Due today', body: 'Plan', at: 'notes/1', resource: ID } })
    expect(routeOp('alfa', 'p.x', 'notify', { title: 'Hi' }).json).toEqual({ title: 'Hi' })
    expect(() => routeOp('alfa', 'p.x', 'notify', {})).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'notify', { title: 'x'.repeat(161) })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'notify', { title: 'Hi', resource: 'not-an-id' })).toThrow(OpError)
  })
  it('builds the operations of the extensions, on the items of the plugin of the iframe', () => {
    const N = '/api/t/alfa/p/com.mosaikit.notes'
    expect(routeOp('alfa', 'com.mosaikit.notes', 'ext.list', { resource: 'notes' })).toEqual({ method: 'GET', url: `${N}/ext/notes` })
    expect(routeOp('alfa', 'com.mosaikit.notes', 'ext.values', { resource: 'notes', ids: [ID] })).toEqual({ method: 'POST', url: `${N}/ext/notes/values`, json: { ids: [ID] } })
    expect(routeOp('alfa', 'com.mosaikit.notes', 'ext.set', { resource: 'notes', id: ID, extension: 'com.x.review', values: { ok: true } })).toEqual({
      method: 'PUT',
      url: `${N}/ext/notes/${ID}/com.x.review`,
      json: { values: { ok: true } },
    })
    expect(routeOp('alfa', 'com.mosaikit.notes', 'ext.action', { resource: 'notes', id: ID, extension: 'com.x.review', action: 'approve' }).url).toBe(`${N}/ext/notes/${ID}/com.x.review/approve`)
    expect(() => routeOp('alfa', 'p.x', 'ext.set', { resource: 'notes', id: ID, extension: '../admin', values: {} })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'ext.values', { resource: 'notes', ids: ['x'] })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'ext.action', { resource: 'notes', id: ID, extension: 'com.x.y', action: 'a/b' })).toThrow(OpError)
  })
})

describe('errorReply', () => {
  it('carries the stable code, the status and the message of the server', () => {
    const r = errorReply(new ApiError('quota exceeded: storage', 409, 'quota_exceeded'))
    expect(r.code).toBe('quota_exceeded')
    expect(r.status).toBe(409)
    expect(r.message).toBe('quota exceeded: storage')
    expect(typeof r.err).toBe('string')
  })
  it('keeps the message of a plugin under its own code', () => {
    const r = errorReply(new ApiError('invalid email: x', 400, 'plugin_error'))
    expect(r.err).toBe('invalid email: x')
  })
  it('sends only the text for an error that is not of the server', () => {
    expect(errorReply(new OpError('unknown operation'))).toEqual({ err: 'unknown operation' })
  })
})

describe('safePage', () => {
  it('accepts only an .html file of the UI of the extension', () => {
    expect(safePage('tab.html')).toBe('tab.html')
    expect(safePage('tabs/review.html')).toBe('tabs/review.html')
    for (const bad of ['../notes/index.html', '/tab.html', 'tab.js', 'a/./b.html', 'https://evil.x/a.html', 'tab.html?x=1', 'a\\b.html', '']) {
      expect(() => safePage(bad), bad).toThrow(OpError)
    }
  })
})
