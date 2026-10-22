import { describe, expect, it } from 'vitest'
import { BridgeError } from './bridge.ts'
import { errorText } from './errors.ts'

describe('errorText', () => {
  it('keeps the text the host translated', () => {
    const e = new BridgeError('Il tuo profilo di permesso non lo consente', 'missing_permission', 403, 'missing permission: create')
    expect(errorText(e, 'it')).toBe('Il tuo profilo di permesso non lo consente')
  })
  it('translates a known code the host left untranslated, in the language of the host', () => {
    const e = new BridgeError('quota exceeded: storage', 'quota_exceeded', 409, 'quota exceeded: storage')
    expect(errorText(e, 'it')).toMatch(/quote/)
    expect(errorText(e, 'en')).toMatch(/quotas/)
  })
  it('keeps the message of the server for an unknown code', () => {
    const e = new BridgeError('invalid email: x', 'plugin_error', 400, 'invalid email: x')
    expect(errorText(e, 'it')).toBe('invalid email: x')
  })
  it('works with the errors of an older host (no code)', () => {
    expect(errorText(new BridgeError('Not found'), 'it')).toBe('Not found')
    expect(errorText('plain')).toBe('plain')
  })
})
