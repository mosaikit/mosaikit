import { describe, expect, it } from 'vitest'
import { plainText } from './plaintext.ts'

describe('plainText', () => {
  it('keeps the text of a Markdown link and drops the url', () => {
    expect(plainText('Call started: [join the call](https://meet.jit.si/mosaikit-abc123)')).toBe('Call started: join the call')
  })
  it('handles images, several links and plain text', () => {
    expect(plainText('![logo](x.png) and [a](u1) [b](u2)')).toBe('logo and a b')
    expect(plainText('nothing to change (really)')).toBe('nothing to change (really)')
    expect(plainText('')).toBe('')
  })
})
