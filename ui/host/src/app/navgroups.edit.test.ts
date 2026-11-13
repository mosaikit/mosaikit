import { describe, expect, it } from 'vitest'
import { allItems, groupIds, move, newGroupId, placed, splitApps, unplace, type NavGroupDef } from './navgroups.ts'

const apps = ['a', 'b', 'c', 'd'].map((plugin) => ({ plugin }))
const defs: NavGroupDef[] = [
  { id: 'g', label: 'G', plugins: ['a'], children: [{ id: 's', label: 'S', plugins: ['b', 'a'] }] },
  { id: 'only-sub', label: 'O', plugins: [], children: [{ id: 't', label: 'T', plugins: ['c'] }] },
]

describe('layout with subgroups', () => {
  it('splits the apps in groups and subgroups; a plugin is in one place only', () => {
    const { groups, rest } = splitApps(apps, defs, 'en')
    expect(groups.map((g) => g.def.id)).toEqual(['g', 'only-sub'])
    expect(groups[0].children?.[0].items.map((i) => i.plugin)).toEqual(['b'])
    expect(rest.map((i) => i.plugin)).toEqual(['d'])
  })
  it('ignores a third level and empty groups', () => {
    const deep: NavGroupDef[] = [{ id: 'g', label: 'G', plugins: ['a'], children: [{ id: 's', label: 'S', plugins: ['b'], children: [{ id: 'x', label: 'X', plugins: ['c'] }] }] }]
    const { groups, rest } = splitApps(apps, deep, 'en')
    expect(groups[0].children?.[0].children).toBeUndefined()
    expect(rest.map((i) => i.plugin)).toEqual(['c', 'd'])
  })
  it('flattens a group with its subgroups', () => {
    expect(allItems({ items: [1], subgroups: [{ items: [2, 3] }] })).toEqual([1, 2, 3])
  })
})

describe('editing helpers', () => {
  it('moves inside the list only', () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3])
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
    expect(move([1, 2, 3], 2, 1)).toEqual([1, 2, 3])
  })
  it('makes unique ids from names', () => {
    expect(newGroupId('Dati e Archivio', new Set())).toBe('dati-e-archivio')
    expect(newGroupId('Più cose', new Set(['piu-cose']))).toBe('piu-cose-2')
    expect(newGroupId('!!!', new Set())).toBe('group')
  })
  it('knows the ids and the placed plugins; unplace removes it everywhere', () => {
    expect([...groupIds(defs)].sort()).toEqual(['g', 'only-sub', 's', 't'])
    expect([...placed(defs)].sort()).toEqual(['a', 'b', 'c'])
    expect([...placed(unplace(defs, 'a'))].sort()).toEqual(['b', 'c'])
  })
})
