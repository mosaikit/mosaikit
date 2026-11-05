import { describe, expect, it, vi } from 'vitest'
import { embedSession } from './embed.ts'

const T = 'a'.repeat(48)
const url = (q: string) => `https://maps.example/ui/com.x/embed.html?${q}`

describe('embedSession', () => {
  it('reads the ticket, the plugin, the resource and the platform from the address', () => {
    const s = embedSession(url(`embed=${T}&plugin=com.x&resource=r1&api=${encodeURIComponent('https://app.example')}`))
    expect(s?.plugin).toBe('com.x')
    expect(s?.resource).toBe('r1')
  })

  it('is null for a page that was not opened as an embed, or with a bad ticket or platform', () => {
    expect(embedSession(url(''))).toBeNull()
    expect(embedSession(url(`embed=short&plugin=p&resource=r&api=https://a`))).toBeNull()
    expect(embedSession(url(`embed=${T}&plugin=p&resource=r&api=javascript:alert(1)`))).toBeNull()
    expect(embedSession('not a url')).toBeNull()
  })

  it('calls the plugin with the ticket and no cookie, and gives the error code back', async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ok: { n: 1 } }) }).mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'invalid', code: 'run_ticket_invalid' }) })
    vi.stubGlobal('fetch', f)
    const s = embedSession(url(`embed=${T}&plugin=com.x&resource=r1&api=${encodeURIComponent('https://app.example/')}`))!
    expect(await s.call('layers', { a: 1 })).toEqual({ n: 1 })
    expect(f.mock.calls[0][0]).toBe(`https://app.example/api/run/${T}/call/com.x/layers`)
    expect(f.mock.calls[0][1].credentials).toBeUndefined()
    await expect(s.call('layers')).rejects.toMatchObject({ code: 'run_ticket_invalid' })
    await expect(s.call('../x')).rejects.toThrow('invalid command name')
    vi.unstubAllGlobals()
  })
})
