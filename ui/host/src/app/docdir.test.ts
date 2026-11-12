import { describe, expect, it } from 'vitest'
import { setDocLang } from './i18n.ts'

describe('setDocLang', () => {
  it('sets the language and the direction of the page', () => {
    setDocLang('ar')
    expect(document.documentElement.lang).toBe('ar')
    expect(document.documentElement.dir).toBe('rtl')
    setDocLang('zh')
    expect(document.documentElement.lang).toBe('zh')
    expect(document.documentElement.dir).toBe('ltr')
    setDocLang('it')
    expect(document.documentElement.dir).toBe('ltr')
  })
})
