// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { gridTable } from './grid.ts'

type R = { name: string; n: number }
const rows: R[] = [
  { name: 'b', n: 10 },
  { name: 'a', n: 9 },
  { name: 'c', n: 100 },
]
const names = (g: ReturnType<typeof gridTable<R>>) => [...g.el.querySelectorAll('tbody tr:not([data-foot]) td:first-child')].map((x) => x.textContent)

describe('gridTable', () => {
  const make = () =>
    gridTable<R>({
      label: 'Things',
      columns: [
        { key: 'name', title: 'Name', sort: (r) => r.name, cell: (r) => r.name },
        { key: 'n', title: 'N', align: 'right', sort: (r) => r.n, cell: (r) => String(r.n) },
      ],
    })

  it('sorts by a title: ascending, descending, the order of the source; numbers as numbers', () => {
    const g = make()
    g.set(rows)
    expect(names(g)).toEqual(['b', 'a', 'c'])
    const btn = (i: number) => g.el.querySelectorAll<HTMLButtonElement>('th button')[i]
    btn(0).click()
    expect(names(g)).toEqual(['a', 'b', 'c'])
    expect(g.el.querySelector('th')!.getAttribute('aria-sort')).toBe('ascending')
    btn(0).click()
    expect(names(g)).toEqual(['c', 'b', 'a'])
    btn(0).click()
    expect(names(g)).toEqual(['b', 'a', 'c'])
    btn(1).click()
    expect(names(g)).toEqual(['a', 'b', 'c'])
    expect(g.el.querySelector('th')!.textContent).toBe('Name')
  })

  it('puts the foot as the last row of the scrolling rows, with the roles of a table', () => {
    const g = make()
    const more = document.createElement('button')
    more.textContent = 'Load more'
    g.set(rows, more)
    const last = g.scroller.lastElementChild as HTMLElement
    expect(last.hasAttribute('data-foot')).toBe(true)
    expect(last.contains(more)).toBe(true)
    expect(g.el.querySelector('table')!.getAttribute('role')).toBe('table')
    expect(g.scroller.hasAttribute('data-listscroll')).toBe(true)
    g.set([], null, 'Nothing')
    expect(g.el.textContent).toContain('Nothing')
  })
})
