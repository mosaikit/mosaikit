import { describe as suite, expect, it } from 'vitest'
import { setLang } from './i18n.ts'
import { IT } from './locales/it.ts'
import { ACTIONS, describe } from './logtext.ts'

suite('descriptions of the events of the Log', () => {
  it('every described action has its Italian text', () => {
    const missing = Object.values(ACTIONS).filter((phrase) => !(phrase in IT))
    expect(missing).toEqual([])
  })
  it('in the chosen language, and the name of an unknown action stays readable', () => {
    setLang('en')
    expect(describe({ action: 'resource.delete' })).toBe('Moved to the trash')
    expect(describe({ action: 'some_plugin.thing_done' })).toBe('some plugin thing done')
    setLang('it')
    expect(describe({ action: 'resource.delete' })).toBe('Spostato nel cestino')
    expect(describe({ action: 'login.failed' })).toBe('Accesso rifiutato')
    setLang('en')
  })
})
