// The table of every list of the host (docs/refactoring-ui.md §12): the page does not scroll, the header row stays
// where it is and ONLY the rows scroll, with the scrollbar under the header row; the column titles sort the rows; a
// full-text filter (a box in the header of the page, see `FilterBox`) searches every visible field; more rows load
// as the end of the scrolling rows comes into view. The plugins draw the same table (`ui/plugin-api`, `msk-grid`).

import { useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { t } from './i18n.ts'
import { MoreRows } from './kit.tsx'
import { applyView, nextSort, type Col, type Selection, type ServerPaging, type Sort } from './tableutil.ts'


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
  sort: sortProp,
  onSort: onSortProp,
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
  /** the sort chosen by the page (the same sort serves another view of the same rows); without it the table keeps its own */
  sort?: Sort
  onSort?: (s: Sort) => void
}) {
  const [own, setOwn] = useState('')
  const [ownSort, setOwnSort] = useState<Sort>(initialSort)
  const sort = onSortProp ? (sortProp ?? null) : ownSort
  const setSort = onSortProp ?? setOwnSort
  const [n, setN] = useState(step)
  const [sig, setSig] = useState('')
  const words = (searchLabel ? own : filter).toLowerCase().split(/\s+/).filter(Boolean)
  const wanted = `${words.join(' ')}|${sort?.key}${sort?.dir}`
  // another filter or sort: back to the first page
  if (sig !== wanted) {
    setSig(wanted)
    setN(step)
  }
  const shownAll = applyView(rows, columns, words, sort)
  if (!rows.length && empty) return <>{empty}</>
  const shown = server ? shownAll : shownAll.slice(0, n)
  const onSort = (key: string) => setSort(nextSort(sort, key))
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

/** The cards of a list laid out in a grid that scrolls inside the page (the header and the filters stay): more cards
 *  load as the end comes into view, the same way as the rows of a table. */
export function CardGrid<T>({ rows, rowKey, card, label, step = 24, min = '17.5rem' }: { rows: T[]; rowKey: (r: T) => string; card: (r: T) => ReactNode; label: string; step?: number; min?: string }) {
  const [n, setN] = useState(step)
  const [sig, setSig] = useState('')
  // another filter or sort (another list of rows): back to the first cards
  const wanted = `${rows.length}|${rows[0] ? rowKey(rows[0]) : ''}|${rows[rows.length - 1] ? rowKey(rows[rows.length - 1]) : ''}`
  if (sig !== wanted) {
    setSig(wanted)
    setN(step)
  }
  const shown = rows.slice(0, n)
  return (
    <div data-listscroll data-testid="card-grid" className="msk-cardgrid min-h-0 flex-1 overflow-y-auto">
      <ul aria-label={label} className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}, 100%), 1fr))` }}>
        {shown.map((r) => (
          <li key={rowKey(r)} className="contents">
            {card(r)}
          </li>
        ))}
      </ul>
      {!shown.length && <p className="py-8 text-center text-sm text-muted-foreground">{t('No result')}</p>}
      {rows.length > step && <MoreRows shown={shown.length} total={rows.length} more={shown.length < rows.length} onMore={() => setN((x) => x + step)} />}
    </div>
  )
}

/** The sort of a list of cards: the same keys as the columns of its table and a direction. */
export function SortMenu<T>({ columns, sort, onSort }: { columns: Col<T>[]; sort: Sort; onSort: (s: Sort) => void }) {
  const keys = columns.filter((c) => c.sort)
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={t('Sort')}>
      <Select value={sort?.key ?? '_'} onValueChange={(k) => onSort(k === '_' ? null : { key: k, dir: sort?.dir ?? 1 })}>
        <SelectTrigger size="sm" className="w-44" aria-label={t('Sort by')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_">{t('Order of the server')}</SelectItem>
          {keys.map((c) => (
            <SelectItem key={c.key} value={c.key}>
              {c.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        disabled={!sort}
        aria-label={sort?.dir === -1 ? t('Descending') : t('Ascending')}
        title={sort?.dir === -1 ? t('Descending') : t('Ascending')}
        onClick={() => sort && onSort({ key: sort.key, dir: sort.dir === 1 ? -1 : 1 })}
      >
        {sort?.dir === -1 ? <ArrowDown /> : <ArrowUp />}
      </Button>
    </div>
  )
}

export function ViewSwitch({ view, onChange }: { view: 'cards' | 'table'; onChange: (v: 'cards' | 'table') => void }) {
  const item = (v: 'cards' | 'table', icon: ReactNode, text: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={view === v}
      aria-label={text}
      title={text}
      data-view={v}
      onClick={() => onChange(v)}
      className={cn('flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4', view === v ? 'bg-primary/10 text-primary-strong' : 'text-muted-foreground hover:bg-accent')}
    >
      {icon}
    </button>
  )
  return (
    <div role="radiogroup" aria-label={t('View')} className="flex items-center rounded-lg border p-0.5">
      {item('cards', <LayoutGrid />, t('Cards'))}
      {item('table', <List />, t('Table'))}
    </div>
  )
}
