// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Bridge } from './bridge.ts'
import { forwardActivity, makePresence } from './presence.ts'

function setup() {
  const sent: { msg: any }[] = []
  const host = { postMessage: (msg: any) => sent.push({ msg }) } as unknown as Window
  const b = new Bridge(host, 'https://app.example', window)
  const event = (data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { data: { msk: 1, event: 'presence', data }, origin: 'https://app.example', source: host }))
  return { b, sent, event }
}

describe('msk.presence', () => {
  it('asks the host for the list on first use and follows its changes', () => {
    const { b, sent, event } = setup()
    const p = makePresence(b, true)
    expect(sent).toHaveLength(0)
    expect(p.get()).toEqual({})
    expect(sent.map((s) => s.msg.op)).toEqual(['presence.watch'])
    const seen: unknown[] = []
    const off = p.onChange((l) => seen.push(l))
    expect(p.live).toBe(false)
    event({ live: true, users: { a: 'available', b: 'away' } })
    expect(p.live).toBe(true)
    expect(p.status('a')).toBe('available')
    expect(p.status('b')).toBe('away')
    expect(p.status('c')).toBe('offline')
    expect(seen).toEqual([{ a: 'available', b: 'away' }])
    off()
    event({ live: true, users: {} })
    expect(seen).toHaveLength(1)
    // asked once only
    expect(sent).toHaveLength(1)
    b.dispose()
  })

  it('an older host: not supported, nothing is asked, the list stays empty', () => {
    const { b, sent } = setup()
    const p = makePresence(b, false)
    expect(p.supported).toBe(false)
    expect(p.get()).toEqual({})
    expect(sent).toHaveLength(0)
    b.dispose()
  })

  it('a damaged event does not break the list', () => {
    const { b, event } = setup()
    const p = makePresence(b, true)
    p.get()
    event(null)
    expect(p.get()).toEqual({})
    expect(p.live).toBe(false)
    b.dispose()
  })
})

describe('forwardActivity', () => {
  it('reports input at most once in the period', () => {
    const { b, sent } = setup()
    let t = 1000
    const stop = forwardActivity(b, window, 15_000, () => t)
    window.dispatchEvent(new Event('keydown'))
    window.dispatchEvent(new Event('pointermove'))
    expect(sent.map((s) => s.msg.op)).toEqual(['presence.activity'])
    t += 16_000
    window.dispatchEvent(new Event('pointermove'))
    expect(sent).toHaveLength(2)
    stop()
    t += 60_000
    window.dispatchEvent(new Event('keydown'))
    expect(sent).toHaveLength(2)
    b.dispose()
  })
})
