import { describe, expect, it } from 'vitest'
import { applyView, nextSort, sortable, sortParams, type Col } from './tableutil.ts'

type R = { name: string; n: number }
const col = (extra: Partial<Col<R>>): Col<R> => ({ key: 'k', title: 'K', cell: () => null, ...extra })

describe('server sort helpers', () => {
  it('a server list sorts only by the columns the server can sort', () => {
    const plain = col({ sort: (r) => r.name })
    const server = col({ sort: (r) => r.name, serverSort: true })
    expect(sortable(plain, false)).toBe(true)
    expect(sortable(plain, true)).toBe(false)
    expect(sortable(server, true)).toBe(true)
    expect(sortable(col({}), false)).toBe(false)
  })

  it('turns a sort into the query parameters, and no sort into none', () => {
    expect(sortParams(null)).toEqual({})
    expect(sortParams({ key: 'created', dir: 1 })).toEqual({ sort: 'created', dir: 'asc' })
    expect(sortParams({ key: 'created', dir: -1 })).toEqual({ sort: 'created', dir: 'desc' })
  })

  it('cycles ascending, descending, the order of the server', () => {
    const a = nextSort(null, 'x')
    expect(a).toEqual({ key: 'x', dir: 1 })
    const d = nextSort(a, 'x')
    expect(d).toEqual({ key: 'x', dir: -1 })
    expect(nextSort(d, 'x')).toBeNull()
  })

  it('a local list still sorts its rows, a server list is left in the order the server sent', () => {
    const rows: R[] = [{ name: 'b', n: 2 }, { name: 'a', n: 1 }]
    const cols = [col({ key: 'name', sort: (r) => r.name })]
    expect(applyView(rows, cols, [], { key: 'name', dir: 1 }).map((r) => r.name)).toEqual(['a', 'b'])
    expect(applyView(rows, cols, [], null).map((r) => r.name)).toEqual(['b', 'a'])
  })
})
