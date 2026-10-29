// The table of every list of the host (docs/refactoring-ui.md §12): the page does not scroll, the header row stays
// where it is and ONLY the rows scroll, with the scrollbar under the header row; the column titles sort the rows; a
// full-text filter (a box in the header of the page, see `FilterBox`) searches every visible field; more rows load
// as the end of the scrolling rows comes into view. The plugins draw the same table (`ui/plugin-api`, `msk-grid`).

import { useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { t } from './i18n.ts'
import { MoreRows } from './kit.tsx'

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

type Sort = { key: string; dir: 1 | -1 } | null

/** Numbers sort as numbers, text by the language and with numbers inside as numbers; empty values go last. */
export function compareValues(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const x = a ?? null
  const y = b ?? null
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
  if (typeof x === 'number' && typeof y === 'number') return x - y
  return String(x).localeCompare(String(y), undefined, { numeric: true })
}

/** The full-text filter of a list: a search box for the `filter` slot of the page header. */
export function FilterBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <Input type="search" className="h-9 w-56 max-w-full" placeholder={label} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
}

/** A column title that sorts the rows: the first click ascending, the second descending, the third back to the order of the server. */
function SortHead({ col, sort, onSort }: { col: Col<never>; sort: Sort; onSort: (k: string) => void }) {
  const on = sort?.key === col.key
  const title = col.hideTitle ? <span className="sr-only">{col.title}</span> : col.title
  return (
    <TableHead role="columnheader" aria-sort={col.sort ? (on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none') : undefined} className={cn(col.align === 'right' && 'justify-end text-right')}>
      {col.sort ? (
        <button type="button" onClick={() => onSort(col.key)} className="-ml-1 inline-flex items-center gap-1 rounded px-1 font-medium outline-none hover:text-primary-strong focus-visible:ring-2 focus-visible:ring-ring">
          {title}
          {on ? sort.dir === 1 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" /> : <ChevronsUpDown className="size-3.5 text-muted-foreground" />}
        </button>
      ) : (
        title
      )}
    </TableHead>
  )
}

export function ListTable<T, K extends string | number = string>({
  rows,
  rowKey,
  columns,
  label,
  filter = '',
  selection,
  server,
  step = 50,
  rowProps,
  empty,
  fit = 'fill',
  initialSort = null,
  searchLabel,
}: {
  rows: T[]
  rowKey: (r: T) => K
  columns: Col<T>[]
  /** the accessible name of the table */
  label: string
  /** the words of the full-text filter: every word must be in some column (local lists only; a server filters by itself) */
  filter?: string
  selection?: Selection<T, K>
  server?: ServerPaging
  step?: number
  rowProps?: (r: T) => Record<string, unknown>
  /** shown instead of the table when there is no row at all */
  empty?: ReactNode
  /** `fill`: the table takes the height of the page and its rows scroll; `inline`: a table among other content, as high as its rows up to a limit */
  fit?: 'fill' | 'inline'
  initialSort?: Sort
  /** a table that is not the whole page has no box in the header: the table draws its own filter box above it */
  searchLabel?: string
}) {
  const [own, setOwn] = useState('')
  const [sort, setSort] = useState<Sort>(initialSort)
  const [n, setN] = useState(step)
  const [sig, setSig] = useState('')
  const words = server ? [] : (searchLabel ? own : filter).toLowerCase().split(/\s+/).filter(Boolean)
  const wanted = `${words.join(' ')}|${sort?.key}${sort?.dir}`
  // another filter or sort: back to the first page
  if (sig !== wanted) {
    setSig(wanted)
    setN(step)
  }
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined
  let shownAll = words.length
    ? rows.filter((r) => {
        const hay = columns.map((c) => c.text?.(r) ?? c.sort?.(r) ?? '').join(' ').toLowerCase()
        return words.every((w) => hay.includes(w))
      })
    : rows
  if (col?.sort && sort) shownAll = [...shownAll].sort((a, b) => sort.dir * compareValues(col.sort!(a), col.sort!(b)))
  if (!rows.length && empty) return <>{empty}</>
  const shown = server ? shownAll : shownAll.slice(0, n)
  const onSort = (key: string) => setSort(sort?.key !== key ? { key, dir: 1 } : sort.dir === 1 ? { key, dir: -1 } : null)
  const tracks = [selection ? '2.5rem' : null, ...columns.map((c) => c.width ?? 'minmax(7rem,1fr)')].filter(Boolean).join(' ')
  const span = columns.length + (selection ? 1 : 0)
  const all = selection && shownAll.length > 0 && shownAll.every((r) => selection.ids.has(rowKey(r)))
  const some = selection && shownAll.some((r) => selection.ids.has(rowKey(r)))
  const local = !server && shownAll.length > step
  const card = (
    <div className={cn('msk-gridcard flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card', fit === 'fill' && 'min-h-48 flex-1')} data-fit={fit} data-testid="list-table">
      <Table role="table" aria-label={label} aria-rowcount={server?.total ?? shownAll.length} className="msk-gridtable" style={{ '--cols': tracks } as CSSProperties}>
        <TableHeader role="rowgroup">
          <TableRow role="row">
            {selection && (
              <TableHead role="columnheader">
                <Checkbox aria-label={t('Select all')} checked={all ? true : some ? 'indeterminate' : false} onCheckedChange={(v) => selection.onChange(v ? new Set(shownAll.map(rowKey)) : new Set())} />
              </TableHead>
            )}
            {columns.map((c) => (
              <SortHead key={c.key} col={c as Col<never>} sort={sort} onSort={onSort} />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody role="rowgroup" data-listscroll>
          {shown.map((r) => {
            const id = rowKey(r)
            return (
              <TableRow key={id} role="row" data-state={selection?.ids.has(id) ? 'selected' : undefined} {...rowProps?.(r)}>
                {selection && (
                  <TableCell role="cell" onClick={(e) => e.stopPropagation()}>
                    {!selection.skip?.(r) && <Checkbox
                      aria-label={selection.label(r)}
                      checked={selection.ids.has(id)}
                      onCheckedChange={(v) => {
                        const next = new Set(selection.ids)
                        if (v) next.add(id)
                        else next.delete(id)
                        selection.onChange(next)
                      }}
                    />}
                  </TableCell>
                )}
                {columns.map((c) => (
                  <TableCell key={c.key} role="cell" className={cn(c.align === 'right' && 'text-right tabular-nums', c.className)}>
                    {c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
          {!shown.length && (
            <TableRow role="row">
              <TableCell role="cell" className="py-8 text-center text-sm text-muted-foreground" style={{ gridColumn: '1 / -1' }} aria-colspan={span}>
                {t('No result')}
              </TableCell>
            </TableRow>
          )}
          {server ? (
            <MoreRows inTable shown={shown.length} total={server.total} more={server.more} loading={server.loading} onMore={server.onMore} label={server.label} />
          ) : (
            local && <MoreRows inTable shown={shown.length} total={shownAll.length} more={shown.length < shownAll.length} onMore={() => setN((x) => x + step)} />
          )}
        </TableBody>
      </Table>
    </div>
  )
  if (!searchLabel) return card
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fit === 'fill' && 'min-h-48 flex-1')}>
      <div className="flex justify-end">
        <FilterBox value={own} onChange={setOwn} label={searchLabel} />
      </div>
      {card}
    </div>
  )
}
