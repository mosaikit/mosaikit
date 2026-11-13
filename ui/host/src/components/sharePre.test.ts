import { describe, expect, it } from 'vitest'
import { sharePre } from './PluginFrame.tsx'

const id = '11111111-2222-3333-4444-555555555555'

describe('sharePre', () => {
  it('keeps the well formed principals and the level', () => {
    expect(sharePre({ principals: [{ type: 'user', id, name: 'Anna' }, { type: 'group', id }], level: 'write' })).toEqual({
      principals: [{ type: 'user', id, name: 'Anna' }, { type: 'group', id }],
      level: 'write',
    })
  })
  it('drops what is not a user or a group with a real id, and defaults to read', () => {
    const out = sharePre({ principals: [{ type: 'tenant', id }, { type: 'user', id: 'nope' }, { type: 'user', id }], level: 'root' })
    expect(out).toEqual({ principals: [{ type: 'user', id }], level: 'read' })
  })
  it('is nothing without principals, and at most 200', () => {
    expect(sharePre(undefined)).toBeUndefined()
    expect(sharePre({ principals: [] })).toBeUndefined()
    expect(sharePre({ principals: Array.from({ length: 300 }, () => ({ type: 'user', id })) })?.principals).toHaveLength(200)
  })
})
