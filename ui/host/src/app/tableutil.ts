// Types and helpers of the tables of the lists (the components are in ListTable.tsx).

import { useState, type ReactNode } from 'react'

/** A column: its title, its width (a grid track), what sorts it and how a cell is drawn. */
export interface Col<T> {
  key: string
  title: string
  /** the title is only for the screen readers (an empty header cell: a checkbox, the actions) */
  hideTitle?: boolean
  /** a CSS grid track: `2.5rem`, `minmax(8rem,2fr)`; the default is `minmax(7rem,1fr)` */
  width?: string
  align?: 'right'
  /** the value the column sorts by (numbers sort as numbers); without it the title is not a button */
  sort?: (r: T) => string | number | null | undefined
  /** the text of the cell for the full-text filter, when it is not the sort value */
  text?: (r: T) => string | number | null | undefined
  cell: (r: T) => ReactNode
  className?: string
}

export interface Selection<T, K extends string | number = string> {
  ids: Set<K>
  onChange: (ids: Set<K>) => void
  label: (r: T) => string
  /** rows that cannot be selected show no box */
  skip?: (r: T) => boolean
}

/** The rows come from a server that pages them: the table asks for the next page as its end comes into view. */
export interface ServerPaging {
  total: number | null
  more: boolean
  loading?: boolean
  onMore: () => void
  label?: string
}

export type Sort = { key: string; dir: 1 | -1 } | null

/** Numbers sort as numbers, text by the language and with numbers inside as numbers; empty values go last. */
export function compareValues(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const x = a ?? null
  const y = b ?? null
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
  if (typeof x === 'number' && typeof y === 'number') return x - y
  return String(x).localeCompare(String(y), undefined, { numeric: true })
}

/** The rows that match the words of the full-text filter (every word in some column), in the order of the sort. */
export function applyView<T>(rows: T[], columns: Col<T>[], words: string[], sort: Sort): T[] {
  let out = words.length
    ? rows.filter((r) => {
        const hay = columns.map((c) => c.text?.(r) ?? c.sort?.(r) ?? '').join(' ').toLowerCase()
        return words.every((w) => hay.includes(w))
      })
    : rows
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined
  if (col?.sort && sort) out = [...out].sort((a, b) => sort.dir * compareValues(col.sort!(a), col.sort!(b)))
  return out
}

/** The next state of a sort when a title is clicked: ascending, descending, the order of the server. */
export function nextSort(sort: Sort, key: string): Sort {
  return sort?.key !== key ? { key, dir: 1 } : sort.dir === 1 ? { key, dir: -1 } : null
}

/** The switch between the views of a list (cards, table): the choice stays in the browser, per person. */
export function useView(key: string, first: 'cards' | 'table' = 'cards'): ['cards' | 'table', (v: 'cards' | 'table') => void] {
  const [view, setView] = useState<'cards' | 'table'>(() => {
    try {
      const v = localStorage.getItem(key)
      return v === 'table' || v === 'cards' ? v : first
    } catch {
      return first
    }
  })
  return [
    view,
    (v) => {
      setView(v)
      try {
        localStorage.setItem(key, v)
      } catch {
        /* no storage: the choice is not kept */
      }
    },
  ]
}

