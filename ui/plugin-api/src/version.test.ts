import { describe, expect, it } from 'vitest'
import { Bridge, BridgeError } from './bridge.ts'
import { Msk } from './client.ts'
import { API_VERSION, checkHostApi, INCOMPATIBLE_API, isIncompatible } from './version.ts'

describe('plugin API handshake', () => {
  it('declares API 1', () => {
    expect(API_VERSION).toBe(1)
  })

  it('accepts a host of the same API, a newer one, and one that predates the handshake', () => {
    expect(checkHostApi(1)).toBe(1)
    expect(checkHostApi(2)).toBe(2)
    expect(checkHostApi(undefined)).toBe(1)
    expect(checkHostApi('x' as unknown as number)).toBe(1)
  })

  it('declares the plugin incompatible with a host older than the API it needs', () => {
    let err: unknown
    try {
      checkHostApi(1, 2)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(BridgeError)
    expect((err as BridgeError).code).toBe(INCOMPATIBLE_API)
    expect(isIncompatible(err)).toBe(true)
    expect(isIncompatible(new BridgeError('x', 'forbidden'))).toBe(false)
  })

  it('Msk keeps the API of the host and refuses a host that cannot serve it', () => {
    const bridge = {} as Bridge
    expect(new Msk(bridge, { public: false, api: 3 }).api).toBe(3)
    expect(new Msk(bridge, { public: false }).api).toBe(1)
  })
})
