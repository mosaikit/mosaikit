import { describe, expect, it } from 'vitest'
import { Msk } from './client.ts'
import { fill, translate } from './text.ts'
import type { Bridge } from './bridge.ts'
import type { UiContext } from './protocol.ts'

const ctx = (lang: string, texts?: Record<string, string>): UiContext => ({ lang, preset: 'mosaikit', mode: 'light', preference: 'auto', theme: {}, texts })
const msk = (context?: UiContext) => new Msk({} as Bridge, { public: false, context })

describe('msk.t', () => {
  it('fills the placeholders and drops the unknown ones', () => {
    expect(fill('Owner: {name}', { name: 'Ada' })).toBe('Owner: Ada')
    expect(fill('{n} of {m}', { n: 1 })).toBe('1 of ')
    expect(fill('plain')).toBe('plain')
  })

  it('translates from the texts of the context, with the placeholders', () => {
    const m = msk(ctx('es', { 'Owner: {name}': 'Propietario: {name}' }))
    expect(m.t('Owner: {name}', { name: 'Ada' })).toBe('Propietario: Ada')
  })

  it('falls back to the English phrase: no texts, a missing phrase, an older host, a name from Object.prototype', () => {
    expect(msk(ctx('es')).t('Upload')).toBe('Upload')
    expect(msk(ctx('es', { Other: 'Otro' })).t('Upload {n}', { n: 2 })).toBe('Upload 2')
    expect(msk(undefined).t('Upload')).toBe('Upload')
    expect(msk(ctx('es', {})).t('constructor')).toBe('constructor')
  })

  it('uses the own tables of the plugin when no language plugin has the phrase, and follows the context event', () => {
    const m = msk(ctx('it'))
    m.ownTexts({ it: { Upload: 'Carica' } })
    expect(m.t('Upload')).toBe('Carica')
    expect(m.t('Download')).toBe('Download')
    m.context = ctx('es', { Upload: 'Subir' })
    expect(m.t('Upload')).toBe('Subir')
    m.context = ctx('en')
    expect(m.t('Upload')).toBe('Upload')
    expect(translate('A', undefined, { A: 'a' }, { A: 'b' })).toBe('a')
  })
})
