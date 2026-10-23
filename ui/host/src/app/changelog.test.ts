import { describe, expect, it } from 'vitest'
import en from '../../../../CHANGELOG.md?raw'
import it_ from '../../../../CHANGELOG.it.md?raw'
import { releaseNotes } from './help.ts'

// What is new is shown in the language of the person: the Italian notes follow the English ones.
describe('changelog in two languages', () => {
  const versions = (md: string) => [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim())
  it('has the same versions, groups and number of items in English and Italian', () => {
    expect(versions(it_)).toEqual(versions(en))
    for (const v of versions(en)) {
      const a = releaseNotes(en, v)
      const b = releaseNotes(it_, v)
      expect(b.length).toBe(a.length)
      b.forEach((g, i) => expect(g.items.length).toBe(a[i].items.length))
    }
  })
})
