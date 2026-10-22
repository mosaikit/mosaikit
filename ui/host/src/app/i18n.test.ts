import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, errText, isUnavailable } from '../api.ts'
import { setLang, t } from './i18n.ts'

describe('i18n', () => {
  it('without a translation the English phrase stays, with its placeholders', () => {
    setLang('it')
    expect(t('Phrase that does not exist {x}', { x: 'here' })).toBe('Phrase that does not exist here')
    expect(t('Sign in')).toBe('Accedi')
    setLang('en')
    expect(t('Sign in')).toBe('Sign in')
  })
  it('plurals', () => {
    setLang('it')
    expect(t('{count} people', { count: 1 })).toBe('1 persona')
    expect(t('{count} people', { count: 3 })).toBe('3 persone')
    setLang('en')
    expect(t('{count} people', { count: 1 })).toBe('1 person')
    expect(t('{count} people', { count: 3 })).toBe('3 people')
  })
  it('server errors from their code, otherwise the message', () => {
    setLang('en')
    expect(errText(new ApiError('invalid credentials', 401, 'wrong_credentials'))).toBe('Wrong username or password')
    expect(errText(new ApiError('message of the server', 400, 'unknown_code'))).toBe('message of the server')
    expect(errText(new ApiError('without code', 500))).toBe('without code')
    setLang('it')
    expect(errText(new ApiError('invalid credentials', 401, 'wrong_credentials'))).toBe('Utente o password non corretti')
    setLang('en')
  })
})

describe('api errors', () => {
  afterEach(() => vi.unstubAllGlobals())
  const answer = (status: number, body: string, type = 'application/json') =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': type } })))
  const failure = async () => {
    try {
      await api('GET', '/api/x')
    } catch (e) {
      return e as ApiError
    }
    throw new Error('expected an error')
  }

  it('a server that does not answer is unavailable, never a bare HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(isUnavailable(await failure())).toBe(true)
    for (const status of [502, 503, 504]) {
      answer(status, 'Bad Gateway', 'text/plain')
      const e = await failure()
      expect(isUnavailable(e)).toBe(true)
      setLang('en')
      expect(errText(e)).toBe('The server is not responding. Trying again…')
      expect(errText(e)).not.toMatch(/HTTP|\d{3}/)
      setLang('it')
      expect(errText(e)).toBe('Il server non risponde. Riprovo…')
    }
    // an error body that is not the JSON of Mosaikit: someone else answered
    answer(500, '<html>proxy error</html>', 'text/html')
    expect(isUnavailable(await failure())).toBe(true)
    setLang('en')
  })
  it('an error without a message of the server gets a generic one', async () => {
    answer(500, '{}')
    const e = await failure()
    expect(isUnavailable(e)).toBe(false)
    expect(errText(e)).toBe('Something went wrong. Try again.')
    answer(403, JSON.stringify({ error: 'forbidden here', code: 'forbidden' }))
    expect(errText(await failure())).toBe('You are not allowed to do this')
  })
})
