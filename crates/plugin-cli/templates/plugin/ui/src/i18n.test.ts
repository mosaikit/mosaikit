import { describe, expect, it } from 'vitest'
import { texts } from './i18n.ts'

describe('texts', () => {
  it('follows the language of the host', () => {
    expect(texts('it').newLabel).toContain('Nuovo')
    expect(texts('es-MX').newLabel).toContain('Nuevo')
  })

  it('falls back to English', () => {
    expect(texts('fr').newLabel).toContain('New')
    expect(texts(undefined).newLabel).toContain('New')
  })
})
