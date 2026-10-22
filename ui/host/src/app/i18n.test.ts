import { describe, expect, it } from 'vitest'
import { ApiError, errText } from '../api.ts'
import { setLang, t } from './i18n.ts'

describe('i18n', () => {
  it('senza traduzione resta la frase italiana, con i segnaposto', () => {
    setLang('en')
    expect(t('Frase che non esiste {x}', { x: 'qui' })).toBe('Frase che non esiste qui')
    expect(t('Accedi')).toBe('Sign in')
    setLang('it')
    expect(t('Accedi')).toBe('Accedi')
  })
  it('plurali', () => {
    setLang('it')
    expect(t('{count} persone', { count: 1 })).toBe('1 persona')
    expect(t('{count} persone', { count: 3 })).toBe('3 persone')
    setLang('en')
    expect(t('{count} persone', { count: 3 })).toBe('3 people')
  })
  it('errori del server dal codice, altrimenti il messaggio', () => {
    setLang('en')
    expect(errText(new ApiError('credenziali non valide', 401, 'wrong_credentials'))).toBe('Wrong username or password')
    expect(errText(new ApiError('messaggio del server', 400, 'codice_sconosciuto'))).toBe('messaggio del server')
    expect(errText(new ApiError('senza codice', 500))).toBe('senza codice')
    setLang('it')
  })
})
