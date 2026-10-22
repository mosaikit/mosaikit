// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { Bridge, BridgeError } from './bridge.ts'
import { applyContext, applyTheme, Msk } from './client.ts'
import type { UiContext } from './protocol.ts'

/** Fake window: it records the postMessage calls and lets the test simulate answers. */
function fakeHost() {
  const sent: { msg: any; origin: string }[] = []
  const host = { postMessage: (msg: any, origin: string) => sent.push({ msg, origin }) } as unknown as Window
  return { host, sent }
}

function reply(self: Window, source: unknown, origin: string, data: unknown) {
  self.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }))
}

describe('Bridge', () => {
  it('sends only to the origin of the host and resolves with the answer', async () => {
    const { host, sent } = fakeHost()
    const b = new Bridge(host, 'https://app.example', window)
    const p = b.call('crud.list', { resource: 'notes' })
    expect(sent[0].origin).toBe('https://app.example')
    expect(sent[0].msg).toMatchObject({ msk: 1, op: 'crud.list', args: { resource: 'notes' } })
    reply(window, host, 'https://app.example', { msk: 1, id: sent[0].msg.id, ok: { rows: [] } })
    await expect(p).resolves.toEqual({ rows: [] })
    b.dispose()
  })

  it('ignores answers from other origins or windows', async () => {
    const { host, sent } = fakeHost()
    const b = new Bridge(host, 'https://app.example', window, 50)
    const p = b.call('x')
    const id = sent[0].msg.id
    reply(window, host, 'https://evil.example', { msk: 1, id, ok: 'fake' })
    reply(window, {}, 'https://app.example', { msk: 1, id, ok: 'fake' })
    await expect(p).rejects.toBeInstanceOf(BridgeError)
    b.dispose()
  })

  it('propagates the errors of the host', async () => {
    const { host, sent } = fakeHost()
    const b = new Bridge(host, 'https://app.example', window)
    const p = b.call('crud.get')
    reply(window, host, 'https://app.example', { msk: 1, id: sent[0].msg.id, err: 'record not found' })
    await expect(p).rejects.toThrow('record not found')
    b.dispose()
  })

  it('refuses a wildcard origin', () => {
    const { host } = fakeHost()
    expect(() => new Bridge(host, '*', window)).toThrow(BridgeError)
  })

  it('delivers the events of the host', () => {
    const { host } = fakeHost()
    const b = new Bridge(host, 'https://app.example', window)
    const fn = vi.fn()
    b.onEvent(fn)
    reply(window, host, 'https://app.example', { msk: 1, event: 'theme', data: { '--acc': 'red' } })
    expect(fn).toHaveBeenCalledWith('theme', { '--acc': 'red' })
    b.dispose()
  })
})

describe('applyTheme', () => {
  it('applies only valid CSS variables', () => {
    const el = document.createElement('div')
    applyTheme({ '--acc': '#f00', 'color': 'red', '--x': 'a;b' }, el)
    expect(el.style.getPropertyValue('--acc')).toBe('#f00')
    expect(el.style.getPropertyValue('color')).toBe('')
    expect(el.style.getPropertyValue('--x')).toBe('')
  })
})

const CTX: UiContext = { lang: 'en', preset: 'italia', mode: 'dark', preference: 'auto', theme: { '--acc': '#06c' } }

describe('applyContext', () => {
  it('applies language, mode, preset and theme', () => {
    const el = document.createElement('div')
    applyContext(CTX, el)
    expect(el.lang).toBe('en')
    expect(el.dataset.mode).toBe('dark')
    expect(el.dataset.preset).toBe('italia')
    expect(el.style.colorScheme).toBe('dark')
    expect(el.style.getPropertyValue('--acc')).toBe('#06c')
  })

  it('ignores invalid values', () => {
    const el = document.createElement('div')
    applyContext({ ...CTX, lang: 'en"><script>', mode: 'black' as 'dark', preset: 'a b' }, el)
    expect(el.lang).toBe('')
    expect(el.dataset.mode).toBeUndefined()
    expect(el.dataset.preset).toBeUndefined()
  })
})

describe('Msk.onContext', () => {
  it("receives the context of the handshake and its changes", () => {
    const { host } = fakeHost()
    const b = new Bridge(host, 'https://app.example', window)
    const msk = new Msk(b, { public: false, context: CTX })
    expect(msk.context?.lang).toBe('en')
    const fn = vi.fn()
    msk.onContext(fn)
    const next = { ...CTX, lang: 'it', mode: 'light' as const }
    reply(window, host, 'https://app.example', { msk: 1, event: 'context', data: next })
    expect(fn).toHaveBeenCalledWith(next)
    reply(window, host, 'https://app.example', { msk: 1, event: 'theme', data: {} })
    expect(fn).toHaveBeenCalledTimes(1)
    b.dispose()
  })
})
