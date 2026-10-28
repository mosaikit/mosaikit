// The Spanish language plugin (mosaikit-plugins/lang-es) must cover every text of the Italian locale, so a new
// UI string cannot silently stay in English. Skipped when the plugins repository is not next to this one.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IT } from './locales/it.ts'

const hostJson = resolve(process.cwd(), '../../../mosaikit-plugins/lang-es/lang/host.json')

describe.skipIf(!existsSync(hostJson))('lang-es host texts', () => {
  const es: Record<string, string> = existsSync(hostJson) ? JSON.parse(readFileSync(hostJson, 'utf8')) : {}
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join()

  it('translates every key of the Italian locale', () => {
    const missing = Object.keys(IT).filter((k) => !(k in es) || es[k].trim() === '')
    expect(missing, `add these keys to mosaikit-plugins/lang-es/lang/host.json:\n${missing.join('\n')}`).toEqual([])
  })
  it('keeps the placeholders of the English phrase', () => {
    const bad = Object.keys(IT).filter(
      (k) => k in es && !k.startsWith('errors.') && !k.endsWith('_one') && placeholders(k.replace(/_(one|other)$/, '')) !== placeholders(es[k]),
    )
    expect(bad).toEqual([])
  })
})
