import { describe, expect, it } from 'vitest'
import { arrowTarget, groupLabel, splitApps, type NavGroupDef } from './navgroups.ts'

const app = (plugin?: string) => ({ plugin, label: plugin ?? 'flat' })
const defs: NavGroupDef[] = [
  { id: 'data', label: 'Data', icon: 'database', plugins: ['docs', 'nope', 'geo'], i18n: { it: { label: 'Dati' } } },
  { id: 'apps', label: 'Apps', plugins: ['notes', 'geo'] },
  { id: 'empty', label: 'Empty', plugins: ['ghost'] },
  { id: 'data', label: 'Again', plugins: ['tasks'] },
]

describe('navigation groups', () => {
  const items = [app('notes'), app('geo'), app('tasks'), app('docs'), app()]
  const r = splitApps(items, defs, 'en')

  it('orders by the declared list, ignores unknown plugins and drops empty groups', () => {
    expect(r.groups.map((g) => g.def.id)).toEqual(['data', 'apps'])
    expect(r.groups[0].items.map((i) => i.plugin)).toEqual(['docs', 'geo'])
  })
  it('a plugin in two groups stays in the first; a duplicate group id is ignored', () => {
    expect(r.groups[1].items.map((i) => i.plugin)).toEqual(['notes'])
    expect(r.rest.map((i) => i.plugin)).toEqual(['tasks', undefined])
  })
  it('keeps every app flat when there are no groups or the data is malformed', () => {
    expect(splitApps(items, undefined, 'en').rest).toHaveLength(5)
    expect(splitApps(items, [null, { id: '', plugins: 3 }] as unknown as NavGroupDef[], 'en').groups).toEqual([])
  })
  it('translates the label, falling back to the declared one and the id', () => {
    expect(groupLabel(defs[0], 'it')).toBe('Dati')
    expect(groupLabel(defs[0], 'es')).toBe('Data')
    expect(groupLabel({ id: 'x', label: ' ', plugins: [] }, 'en')).toBe('x')
  })
  it('moves the focus with the arrow keys, wrapping around', () => {
    expect(arrowTarget('ArrowDown', 2, 3)).toBe(0)
    expect(arrowTarget('ArrowUp', 0, 3)).toBe(2)
    expect(arrowTarget('Home', 2, 3)).toBe(0)
    expect(arrowTarget('End', 0, 3)).toBe(2)
    expect(arrowTarget('a', 0, 3)).toBeNull()
    expect(arrowTarget('ArrowDown', 0, 0)).toBeNull()
  })
})
