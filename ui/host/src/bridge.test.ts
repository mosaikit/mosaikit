import { describe, expect, it } from 'vitest'
import { ApiError } from './api.ts'
import { channelName, checkPluginApi, errorReply, OpError, routeOp, safePage, SHELL_API } from './bridge.ts'

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

  it('routes the embedded page with checked arguments only', () => {
    const c = routeOp('alfa', 'p.dash', 'embed.url', { plugin: 'com.mosaikit.maps', name: 'map', resource: ID, host: 'evil', ticket: 'x' })
    expect(c).toEqual({ method: 'POST', url: '/api/t/alfa/p/p.dash/embed/url', json: { plugin: 'com.mosaikit.maps', name: 'map', resource: ID } })
    for (const bad of [{ plugin: 'x y', name: 'map', resource: ID }, { plugin: 'p.a', name: 'a b', resource: ID }, { plugin: 'p.a', name: 'map', resource: 'nope' }, {}]) expect(() => routeOp('alfa', 'p.dash', 'embed.url', bad)).toThrow(OpError)
  })

  it('routes the schedules of the plugin of the iframe, with the plugin forced', () => {
    const list = routeOp('alfa', 'p.x', 'schedules.list', { plugin: 'p.evil' })
    expect(list).toEqual({ method: 'GET', url: '/api/t/alfa/schedules?plugin=p.x' })
    const made = routeOp('alfa', 'p.x', 'schedules.create', { plugin: 'p.evil', name: 'run', cron: '0 3 * * *', extra: 1, resources: [ID] })
    expect(made).toEqual({ method: 'POST', url: '/api/t/alfa/schedules', json: { plugin: 'p.x', name: 'run', cron: '0 3 * * *', resources: [ID] } })
    expect(routeOp('alfa', 'p.x', 'schedules.update', { id: ID, enabled: false, cron: '5 * * * *', owner: 'x' })).toEqual({ method: 'PATCH', url: `/api/t/alfa/schedules/${ID}?plugin=p.x`, json: { cron: '5 * * * *', enabled: false } })
    expect(routeOp('alfa', 'p.x', 'schedules.run', { id: ID }).url).toBe(`/api/t/alfa/schedules/${ID}/run?plugin=p.x`)
    expect(routeOp('alfa', 'p.x', 'schedules.remove', { id: ID }).method).toBe('DELETE')
    for (const bad of [{ id: 'nope' }, {}]) expect(() => routeOp('alfa', 'p.x', 'schedules.pause', bad)).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'schedules.create', { cron: '* * * * *' })).toThrow(OpError)
  })

  it('routes the directory search with checked arguments only', () => {
    const c = routeOp('alfa', 'p.x', 'directory.search', { kind: 'user', q: 'an', limit: 500, tenant: 'beta', plugin: 'p.evil' })
    expect(c).toEqual({ method: 'POST', url: '/api/t/alfa/p/p.x/directory/search', json: { kind: 'user', q: 'an', limit: 50 } })
    expect(routeOp('alfa', 'p.x', 'directory.search', { kind: 'group', q: 'x' }).json).toEqual({ kind: 'group', q: 'x' })
    for (const bad of [{ q: 'a' }, { kind: 'team', q: 'a' }, { kind: 'user' }, { kind: 'user', q: '' }, { kind: 'user', q: 'x'.repeat(65) }, { kind: 'user', q: 'a', limit: 0 }, { kind: 'user', q: 'a', limit: '5' }]) {
      expect(() => routeOp('alfa', 'p.x', 'directory.search', bad)).toThrow(OpError)
    }
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

  it('builds unzip and the calls on the Files area of another plugin (source)', () => {
    const f = new Blob(['z'])
    const z = routeOp('alfa', 'com.geo.data', 'files.unzip', { file: f, parent: ID, folder: 'city', conflict: 'skip', source: 'com.mosaikit.files' })
    expect(z.method).toBe('POST')
    expect(z.url).toBe(`/api/t/alfa/p/com.geo.data/files/unzip?parent=${ID}&folder=city&conflict=skip&source=com.mosaikit.files`)
    expect(z.raw).toBe(f)
    // an unknown conflict policy is dropped (the server then uses fail), the area of the plugin stays the default
    expect(routeOp('alfa', 'p.x', 'files.unzip', { file: f, conflict: 'drop' }).url).toBe('/api/t/alfa/p/p.x/files/unzip?')
    expect(routeOp('alfa', 'p.x', 'files.list', { parent: ID, source: 'com.mosaikit.files' }).url).toBe(`/api/t/alfa/p/p.x/files?parent=${ID}&source=com.mosaikit.files`)
    expect(routeOp('alfa', 'p.x', 'files.mkdir', { name: 'n', source: 'com.mosaikit.files' }).url).toBe('/api/t/alfa/p/p.x/files/folder?source=com.mosaikit.files')
    expect(routeOp('alfa', 'p.x', 'ticket', { id: ID, source: 'com.mosaikit.files' }).url).toBe(`/api/t/alfa/p/p.x/ticket/${ID}?source=com.mosaikit.files`)
    expect(() => routeOp('alfa', 'p.x', 'files.list', { source: '../x' })).toThrow(OpError)
    expect(routeOp('alfa', 'p.x', 'files.delete', { id: ID })).toEqual({ method: 'DELETE', url: `/api/t/alfa/p/p.x/files/${ID}` })
    expect(routeOp('alfa', 'p.x', 'files.delete', { id: ID, source: 'com.mosaikit.files' }).url).toBe(`/api/t/alfa/p/p.x/files/${ID}?source=com.mosaikit.files`)
    expect(routeOp('alfa', 'p.x', 'files.info', { id: ID, source: 'com.mosaikit.files' })).toEqual({ method: 'GET', url: `/api/t/alfa/p/p.x/files/${ID}/info?source=com.mosaikit.files` })
    expect(routeOp('alfa', 'p.x', 'files.info', { id: ID }).url).toBe(`/api/t/alfa/p/p.x/files/${ID}/info`)
    // the content of a file of another plugin's Files area, and of the own one
    expect(routeOp('alfa', 'p.x', 'files.blob', { id: ID, source: 'com.mosaikit.files' })).toEqual({ method: 'GET', url: `/api/t/alfa/p/p.x/files/${ID}/content?source=com.mosaikit.files`, blob: true })
    expect(routeOp('alfa', 'p.x', 'files.blob', { id: ID }).url).toBe(`/api/t/alfa/p/p.x/files/${ID}/content`)
    expect(() => routeOp('alfa', 'p.x', 'files.blob', { id: ID, source: '../x' })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'files.info', { id: ID, source: '../x' })).toThrow(OpError)
    expect(routeOp('alfa', 'p.x', 'files.profiles', { id: ID, source: 'com.mosaikit.files' })).toMatchObject({ method: 'GET', url: `/api/t/alfa/p/p.x/files/${ID}/profiles?source=com.mosaikit.files` })
  })

  it('builds the calls of an upload in pieces', () => {
    const f = new Blob(['x'])
    expect(routeOp('alfa', 'p.x', 'files.upload.begin', { name: 'big.bin', parent: ID, size: 10, replace: true })).toEqual({
      method: 'POST',
      url: '/api/t/alfa/p/p.x/files/uploads',
      json: { name: 'big.bin', parent: ID, size: 10, replace: true },
    })
    const c = routeOp('alfa', 'p.x', 'files.upload.chunk', { id: ID, offset: 5, file: f, source: 'com.mosaikit.files' })
    expect([c.method, c.url, c.raw]).toEqual(['PUT', `/api/t/alfa/p/p.x/files/uploads/${ID}?offset=5&source=com.mosaikit.files`, f])
    expect(routeOp('alfa', 'p.x', 'files.upload.status', { id: ID }).url).toBe(`/api/t/alfa/p/p.x/files/uploads/${ID}`)
    expect(routeOp('alfa', 'p.x', 'files.upload.finish', { id: ID, source: 'com.mosaikit.files' }).url).toBe(`/api/t/alfa/p/p.x/files/uploads/${ID}/finish?source=com.mosaikit.files`)
    expect(routeOp('alfa', 'p.x', 'files.upload.abort', { id: ID })).toMatchObject({ method: 'DELETE' })
    expect(() => routeOp('alfa', 'p.x', 'files.upload.begin', { name: 'x', size: -1 })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'files.upload.chunk', { id: ID, offset: 1.5, file: f })).toThrow(OpError)
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

describe('error codes', () => {
  it('gives the plugin the code its logic chose, else the code of the server', () => {
    expect(errorReply(new ApiError('the invoice is closed', 400, 'plugin_error', 'invoice_locked'))).toMatchObject({ code: 'invoice_locked', status: 400 })
    expect(errorReply(new ApiError('nope', 403, 'forbidden'))).toMatchObject({ code: 'forbidden' })
  })
})

describe('plugin API handshake (host side)', () => {
  it('speaks the API the package exports', async () => {
    const { API_VERSION } = await import('../../plugin-api/src/version.ts')
    expect(SHELL_API).toBe(API_VERSION)
  })

  it('accepts a plugin of this API, or one that announces nothing (before the handshake)', () => {
    expect(() => checkPluginApi({ api: SHELL_API })).not.toThrow()
    expect(() => checkPluginApi(undefined)).not.toThrow()
    expect(() => checkPluginApi({})).not.toThrow()
  })

  it('refuses a plugin built for a newer API, with a code the plugin can read', () => {
    let err: unknown
    try {
      checkPluginApi({ api: SHELL_API + 1 })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(OpError)
    expect(errorReply(err)).toMatchObject({ code: 'incompatible_api' })
    expect(() => checkPluginApi({ api: 0 })).toThrow(OpError)
    expect(() => checkPluginApi({ api: 'one' })).toThrow(OpError)
  })
})

describe('real-time channels', () => {
  it('sends and sets the state through the plugin and the tenant of the iframe', () => {
    expect(routeOp('alfa', 'p.x', 'rt.send', { resource: ID, name: 'chat', data: { a: 1 } })).toEqual({
      method: 'POST',
      url: `/api/t/alfa/p/p.x/rt/${ID}/chat`,
      json: { data: { a: 1 } },
    })
    const to = '1b0f6f3e-2d6a-4c7e-9a51-0c6a3d2b1f11'
    expect(routeOp('alfa', 'p.x', 'rt.send', { resource: ID, name: 'call', data: 1, to, plugin: 'com.evil.x' }).json).toEqual({ data: 1, to })
    expect(routeOp('alfa', 'p.x', 'rt.state', { resource: ID, name: 'chat', state: { typing: true } })).toEqual({
      method: 'POST',
      url: `/api/t/alfa/p/p.x/rt/${ID}/chat/state`,
      json: { state: { typing: true } },
    })
  })

  it('refuses a bad resource, name or recipient', () => {
    expect(() => routeOp('alfa', 'p.x', 'rt.send', { resource: 'x', name: 'chat', data: 1 })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'rt.send', { resource: ID, name: '../x', data: 1 })).toThrow(OpError)
    expect(() => routeOp('alfa', 'p.x', 'rt.send', { resource: ID, name: 'chat', data: 1, to: 'nobody' })).toThrow(OpError)
    expect(() => channelName('Chat')).toThrow(OpError)
    expect(channelName('doc.1_a-b')).toBe('doc.1_a-b')
  })
})
