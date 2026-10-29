// Generic CRUD view driven by the metadata of the resource (fields of the manifest).
// It respects the level of the user on every row: read, write, manage.
// The extensions of the plugin (other plugins that add fields and actions to its items) show by
// themselves: their fields as columns and in the detail, their actions as buttons, their tabs next to
// the detail of an item (the host draws the page of the extension over the tab: `mountTab`).
// Its texts are in English, or in Italian when the host is in Italian (the `context` of the bridge).

import { emptyState, filteredEmpty, type ArtName } from './empty-state.ts'
import { gridTable, type GridCol } from './grid.ts'
import type { Msk } from './client.ts'
import { pageBody, pageHead } from './head.ts'
import { errorText } from './errors.ts'
import type { ExtensionView, FieldDecl, Row, Values } from './protocol.ts'

export interface CrudOptions {
  title?: string
  /** the page of the navigation of the shell it is open at (a subsection): the header reads «title › section» */
  section?: string
  /** fields to show in the table (default: the fields that are not hidden, at most 5) */
  columns?: string[]
  /** label for "new" (default "New") */
  newLabel?: string
  /** only the rows that pass (a page of the navigation of the app: «Mine», a tag…) */
  where?: (row: Row) => boolean
  /** a plugin's own tools in the detail of an existing item (a «Translate» button…): draws into `box`,
   *  which is emptied and drawn again whenever the detail is */
  detail?: (row: Row, box: HTMLElement) => void
  /** items drawn by the plugin (list, cards, board) next to a detail panel, instead of the table; more than one adds a switch */
  views?: CrudView[]
  /** the empty state shown while there is nothing (an illustrated one, never a bare line): the picture, the title and the text
   *  default to a generic one; `actions` default to the «new» button of the page */
  empty?: { art?: ArtName; title?: string; text?: string; actions?: HTMLElement[] }
  /** the panel next to the list: `selected` (default) shows it only while an item is open or a new one is being written, so the
   *  list has the whole width otherwise; `always` keeps it in sight (an empty panel when nothing is open) */
  panel?: 'selected' | 'always'
  /** the read-only view of the open item (with «Edit» for the fields): used instead of the form until the person edits */
  reader?: (ctx: ItemCtx) => HTMLElement
  /** extra controls in the header, before the views switch and the filter (a «Tags» button, a menu of tags…); the filter stays
   *  next to the primary action. On a phone they wrap onto a second row */
  headFilters?: HTMLElement[]
  /** the plugin's own part of the form (a colour picker, a tag chooser…): draws into `box` after the fields, for a new and for an open
   *  item, and sets values of fields the form does not show (hidden ones) with `ctx.set`; they are saved with the form */
  editor?: (ctx: EditorCtx, box: HTMLElement) => void
  /** called with the rows every time the list is loaded (all the rows, when the plugin filters with `where`) */
  onLoad?: (rows: Row[]) => void
}

/** What the `editor` of a plugin works with. */
export interface EditorCtx {
  /** the open item, null for a new one */
  row: Row | null
  /** the value of a field: what the editor set, else the one of the item */
  value(key: string): unknown
  /** sets the value of a field, saved with the form */
  set(key: string, value: string | number | boolean | null): void
  canWrite: boolean
  lang: 'en' | 'it' | 'es'
}

/** What a plugin draws an item with. */
export interface ItemCtx {
  row: Row
  fields: FieldDecl[]
  /** the value of a field as text (the label of a choice, ✓ for a flag) */
  text(key: string): string
  value(key: string): unknown
  selected: boolean
  /** the person may change this item */
  canWrite: boolean
  /** language of the host */
  lang: 'en' | 'it' | 'es'
  /** changes some fields of the item (a partial update) and shows the list again */
  update(values: Values): Promise<void>
}

export interface CrudView {
  key: string
  /** name of the view in the switch */
  label: string
  /** a vertical list, a grid of cards, items that flow and wrap each with its own size (`flow`), or columns (`columns`) */
  kind: 'list' | 'cards' | 'flow' | 'board'
  /** the box of each item (the element with the selection and the keyboard): the plugin may style it or add listeners */
  box?: (ctx: ItemCtx, el: HTMLElement) => void
  /** the content of an item; the view adds the box, selection and keyboard */
  item: (ctx: ItemCtx) => HTMLElement
  /** board only: the columns and which rows fall in each */
  columns?: { key: string; label: (lang: 'en' | 'it' | 'es') => string; match: (row: Row) => boolean }[]
}

/** Rows asked at a time: the list grows with «Load more». */
const PAGE = 100

type State = {
  fields: FieldDecl[]
  rows: Row[]
  /** cursor of the next page (null: everything is loaded) */
  next: string | null
  /** rows matching the filter in all (from the server) */
  total: number | null
  selected: string | null
  filter: string
  busy: boolean
  /** extensions of the resource and their values: item id -> extension id -> values */
  ext: ExtensionView[]
  extValues: Record<string, Record<string, Values>>
  /** the tab of an extension shown in the detail (null: the fields of the item) */
  tab: { ext: string; key: string } | null
  /** the open item is being edited (with `reader`, the item opens for reading first) */
  editing: boolean
  view: string
  /** values set by the `editor` of the plugin since the form was opened */
  editorVals: Values
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v
    else el.setAttribute(k, v)
  }
  for (const c of children) el.append(c)
  return el
}

function display(f: FieldDecl, v: unknown): string {
  if (v === null || v === undefined) return ''
  if (f.kind === 'bool') return v ? '✓' : ''
  if (f.kind === 'choice') return f.option_labels?.[String(v)] ?? String(v)
  return String(v)
}

const TEXTS = {
  en: {
    filter: 'Filter…',
    filterLabel: 'Filter',
    new: '＋ New',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    share: 'Share…',
    del: 'Delete',
    owner: 'Owner',
    item: '1 item',
    items: '{n} items',
    shownOf: '{shown} of {total} items',
    more: 'Load more',
    noResult: 'no result',
    noItem: 'no item',
    emptyTitle: 'Nothing here yet',
    emptyText: 'Create the first one to get started.',
    clearFilters: 'Clear filters',
    shared: 'shared',
    detail: 'Detail',
    sections: 'Sections of the item',
    newItem: 'New item',
    sharedReadOnly: 'Shared with you, read only.',
    ownerIs: 'Owner: {name}',
    saved: 'saved',
    deleted: 'deleted',
    confirmDelete: 'Delete this item?',
    read: 'read only',
    write: 'edit',
    manage: 'manage',
    edit: 'Edit',
    views: 'View',
    pick: 'Select an item to read it, or create a new one.',
    emptyCol: 'Nothing here',
  },
  it: {
    filter: 'Filtra…',
    filterLabel: 'Filtra',
    new: '＋ Nuovo',
    save: 'Salva',
    cancel: 'Annulla',
    close: 'Chiudi',
    share: 'Condividi…',
    del: 'Elimina',
    owner: 'Proprietario',
    item: '1 elemento',
    items: '{n} elementi',
    shownOf: '{shown} di {total} elementi',
    more: 'Carica altri',
    noResult: 'nessun risultato',
    noItem: 'nessun elemento',
    emptyTitle: 'Ancora niente qui',
    emptyText: 'Crea il primo per iniziare.',
    clearFilters: 'Azzera i filtri',
    shared: 'condivisa',
    detail: 'Dettaglio',
    sections: 'Sezioni dell’elemento',
    newItem: 'Nuovo elemento',
    sharedReadOnly: 'Condiviso con te in sola lettura.',
    ownerIs: 'Proprietario: {name}',
    saved: 'salvato',
    deleted: 'eliminato',
    confirmDelete: 'Eliminare questo elemento?',
    read: 'sola lettura',
    write: 'modifica',
    manage: 'gestione',
    edit: 'Modifica',
    views: 'Vista',
    pick: 'Seleziona un elemento per leggerlo, oppure creane uno nuovo.',
    emptyCol: 'Niente qui',
  },
  es: {
    filter: 'Filtrar…',
    filterLabel: 'Filtrar',
    new: '＋ Nuevo',
    save: 'Guardar',
    cancel: 'Cancelar',
    close: 'Cerrar',
    share: 'Compartir…',
    del: 'Eliminar',
    owner: 'Propietario',
    item: '1 elemento',
    items: '{n} elementos',
    shownOf: '{shown} de {total} elementos',
    more: 'Cargar más',
    noResult: 'sin resultados',
    noItem: 'ningún elemento',
    emptyTitle: 'Todavía no hay nada',
    emptyText: 'Crea el primero para empezar.',
    clearFilters: 'Borrar los filtros',
    shared: 'compartida',
    detail: 'Detalle',
    sections: 'Secciones del elemento',
    newItem: 'Nuevo elemento',
    sharedReadOnly: 'Compartido contigo, solo lectura.',
    ownerIs: 'Propietario: {name}',
    saved: 'guardado',
    deleted: 'eliminado',
    confirmDelete: '¿Eliminar este elemento?',
    read: 'solo lectura',
    write: 'edición',
    manage: 'gestión',
    edit: 'Editar',
    views: 'Vista',
    pick: 'Selecciona un elemento para leerlo, o crea uno nuevo.',
    emptyCol: 'Nada aquí',
  },
}
type Text = keyof (typeof TEXTS)['en']

export function mountCrud(root: HTMLElement, msk: Msk, resource: string, opts: CrudOptions = {}): () => void {
  const api = msk.crud(resource)
  const extApi = msk.extensions(resource)
  const st: State = { fields: [], rows: [], next: null, total: null, selected: null, filter: '', busy: false, ext: [], extValues: {}, tab: null, editing: false, view: '', editorVals: {} }
  let disposed = false
  /** the tab mounted now (row|extension|key) and the function that closes it */
  let mounted: { key: string; close: () => void } | null = null
  const lang = (): 'en' | 'it' | 'es' => (msk.context?.lang === 'it' ? 'it' : msk.context?.lang === 'es' ? 'es' : 'en')
  const tr = (k: Text, vars: Record<string, string | number> = {}) =>
    TEXTS[lang()][k].replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? ''))

  const filter = h('input', { type: 'search', class: 'msk-filter' })
  const btnNew = h('button', { type: 'button', class: 'msk-btn' })
  const count = h('span', { class: 'msk-count' })
  const btnMore = h('button', { type: 'button', class: 'msk-btn ghost msk-more' })
  const grid = gridTable<Row>({
    columns: [],
    label: opts.title ?? resource,
    decorate: (r, line) => {
      line.className = 'row' + (r.id === st.selected ? ' sel' : '')
      line.tabIndex = 0
      line.addEventListener('click', () => pick(r.id))
      line.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') pick(r.id)
      })
    },
  })
  const formTitle = h('h3')
  const readonly = h('div', { class: 'msk-readonly' })
  const fieldsBox = h('div')
  const extBox = h('div', { class: 'msk-ext' })
  const toolsBox = h('div', { class: 'msk-tools' })
  const tabsBar = h('div', { class: 'msk-tabs', role: 'tablist' })
  const tabPanel = h('div', { class: 'msk-tabpanel', role: 'tabpanel', id: 'msk-tabpanel' })
  const btnSave = h('button', { type: 'button', class: 'msk-btn' })
  const btnCancel = h('button', { type: 'button', class: 'msk-btn ghost' })
  const btnShare = h('button', { type: 'button', class: 'msk-btn ghost' })
  const btnDel = h('button', { type: 'button', class: 'msk-btn danger' })
  const btnEdit = h('button', { type: 'button', class: 'msk-btn' })
  const readerBox = h('div', { class: 'msk-reader' })
  const views = opts.views ?? []
  const switcher = h('div', { class: 'msk-switch', role: 'group' })
  const items = h('div', { class: 'msk-items-box' })
  st.view = views[0]?.key ?? ''
  try {
    const saved = localStorage.getItem(`msk-view-${resource}`)
    if (saved && views.some((v) => v.key === saved)) st.view = saved
  } catch {
    // no storage: the first view
  }
  const activeView = () => views.find((v) => v.key === st.view) ?? views[0]
  /** The fixed texts, in the language of the host. */
  function renderTexts() {
    filter.placeholder = tr('filter')
    filter.setAttribute('aria-label', tr('filterLabel'))
    btnNew.textContent = opts.newLabel ?? tr('new')
    btnMore.textContent = tr('more')
    // what the profile of the person does not allow is not offered (the kernel refuses it anyway)
    btnNew.hidden = !msk.can('create')
    btnSave.textContent = tr('save')
    btnEdit.textContent = tr('edit')
    switcher.setAttribute('aria-label', tr('views'))
    btnShare.textContent = tr('share')
    btnDel.textContent = tr('del')
  }
  const msg = h('div', { class: 'msk-msg', role: 'status' })
  formTitle.tabIndex = -1
  const form = h('section', { class: 'msk-form' }, formTitle, tabsBar, readonly, readerBox, fieldsBox, extBox, toolsBox, tabPanel, h('div', { class: 'msk-actions' }, btnEdit, btnSave, btnCancel, btnShare, btnDel), msg)

  const emptyBox = h('div', { class: 'msk-emptybox' })
  emptyBox.hidden = true
  const morebar = h('div', { class: 'msk-morebar' }, btnMore)
  // with views: the list (it scrolls) and the detail panel (it scrolls too) side by side, the panel over the list on a phone
  const master = h('div', { class: 'msk-master' }, items, morebar)
  const split = h('div', { class: 'msk-split' }, master, h('aside', { class: 'msk-detail', 'aria-label': tr('detail'), id: 'msk-detail' }, form))
  const body = views.length ? pageBody(split) : pageBody(grid.el, emptyBox, form)
  body.classList.add(views.length ? 'msk-splitbody' : 'msk-tablebody')
  root.replaceChildren(
    // the header and the filters never scroll: the table, the foot and the form do
    pageHead({ title: opts.title ?? resource, section: opts.section, sub: count, actions: [btnNew], filters: [...(opts.headFilters ?? []).map((e) => (e.classList.add('msk-extra'), e)), ...(views.length > 1 ? [switcher, filter] : [filter])] }),
    body,
  )
  // the rest of the rows come as the foot of the table comes into view
  const foot = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && !btnMore.hidden && !btnMore.disabled && void loadMore(), { root: views.length ? master : grid.scroller, rootMargin: '200px' })
  foot.observe(morebar)

  const setMsg = (t: string, err = false) => {
    msg.textContent = t
    msg.classList.toggle('err', err)
  }
  const visibleFields = () => st.fields.filter((f) => !f.hidden)
  const columns = () => {
    const vf = visibleFields()
    return opts.columns ? vf.filter((f) => opts.columns!.includes(f.key)) : vf.slice(0, 5)
  }
  const selectedRow = () => st.rows.find((r) => r.id === st.selected) ?? null
  /** the fields of the extensions shown as columns (at most 3) */
  const extColumns = () => st.ext.flatMap((e) => e.fields.filter((f) => !f.hidden).map((f) => ({ ext: e.id, f }))).slice(0, 3)

  /** The list again: the table, or the views of the plugin. */
  function renderTable() {
    if (views.length) renderItems()
    else renderTableView()
  }

  /** Opens (or closes, when already open) the detail of an item. */
  function pick(id: string | null) {
    st.selected = st.selected === id ? null : id
    st.tab = null
    st.editing = false
    st.editorVals = {}
    split.dataset.open = st.selected ? 'true' : 'false'
    renderTable()
    renderForm()
    // the panel opens: the focus goes into it
    if (st.selected) formTitle.focus()
  }

  function itemCtx(r: Row): ItemCtx {
    const fieldOf = (k: string) => st.fields.find((f) => f.key === k)
    return {
      row: r,
      fields: st.fields,
      text: (k) => {
        const f = fieldOf(k)
        return f ? display(f, r.values[k]) : String(r.values[k] ?? '')
      },
      value: (k) => r.values[k],
      selected: r.id === st.selected,
      canWrite: r.my_level === 'write' || r.my_level === 'manage',
      lang: lang(),
      update: async (values) => {
        try {
          await api.update(r.id, values)
          await load()
        } catch (e) {
          setMsg(errText(e, msk.context?.lang), true)
        }
      },
    }
  }

  function renderSwitch() {
    switcher.className = 'msk-switch'
    switcher.replaceChildren(
      ...views.map((v) => {
        const b = h('button', { type: 'button', class: 'msk-seg', 'aria-pressed': String(v.key === st.view) }, v.label)
        b.addEventListener('click', () => {
          st.view = v.key
          try {
            localStorage.setItem(`msk-view-${resource}`, v.key)
          } catch {
            // no storage: the choice is not kept
          }
          renderSwitch()
          renderTable()
        })
        return b
      }),
    )
  }

  /** The items of the plugin's views: a box for each, with selection (click, Enter, Space) and the arrows. */
  function renderItems() {
    const view = activeView()!
    const shown = opts.where ? st.rows.filter(opts.where) : st.rows
    const total = opts.where ? shown.length : (st.total ?? shown.length)
    count.textContent = total > shown.length ? tr('shownOf', { shown: shown.length, total }) : total === 1 ? tr('item') : tr('items', { n: total })
    btnMore.hidden = !st.next
    const box = (r: Row) => {
      const ctx = itemCtx(r)
      const el = h('div', { class: 'msk-item' + (ctx.selected ? ' sel' : ''), role: 'listitem', tabindex: '0', 'data-id': r.id })
      if (ctx.selected) el.setAttribute('aria-current', 'true')
      el.append(view.item(ctx))
      view.box?.(ctx, el)
      // the fields of the extensions, as chips under the item
      const marks = extColumns().flatMap((x) => {
        const v = st.extValues[r.id]?.[x.ext]?.[x.f.key]
        if (v === null || v === undefined || v === '' || v === false) return []
        const label = x.f.label || x.f.key
        return [h('span', { class: 'msk-chip' }, x.f.kind === 'bool' ? `${label} ✓` : `${label}: ${display(x.f, v)}`)]
      })
      // what the person may do with an item that is not theirs
      if (r.my_level !== 'manage') marks.unshift(h('span', { class: 'msk-chip' }, r.my_level === 'read' || r.my_level === 'write' ? tr(r.my_level) : r.my_level))
      if (marks.length) el.append(h('div', { class: 'msk-itemext' }, ...marks))
      const onItem = (e: Event) => (e.target as HTMLElement).closest('button,input,select,a,textarea') && (e.target as HTMLElement).closest('.msk-item') === el
      el.addEventListener('click', (e) => {
        if (!onItem(e)) pick(r.id)
      })
      el.addEventListener('keydown', (e) => {
        if (onItem(e)) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          pick(r.id)
        } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) {
          e.preventDefault()
          const all = [...items.querySelectorAll<HTMLElement>('.msk-item')]
          all[all.indexOf(el) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
        }
      })
      return el
    }
    const list = (rows: Row[], kind: string) => h('div', { class: `msk-items ${kind}`, role: 'list' }, ...rows.map(box))
    if (!shown.length) {
      items.replaceChildren(emptyNode())
    } else if (view.kind === 'board' && view.columns) {
      items.replaceChildren(
        h(
          'div',
          { class: 'msk-board' },
          ...view.columns.map((c) => {
            const rows = shown.filter(c.match)
            return h(
              'section',
              { class: 'msk-col', 'aria-label': c.label(lang()) },
              h('h2', {}, c.label(lang()), h('span', { class: 'msk-colcount' }, String(rows.length))),
              rows.length ? list(rows, 'list col') : h('div', { class: 'msk-colempty' }, tr('emptyCol')),
            )
          }),
        ),
      )
    } else items.replaceChildren(list(shown, view.kind))
    // a re-render drops the focus of the item that had it
    if (document.activeElement === document.body && st.selected) items.querySelector<HTMLElement>(`[data-id="${CSS.escape(st.selected)}"]`)?.focus({ preventScroll: true })
  }

  /** What takes the place of the list while it is empty: the illustrated state, or the plain message of a filter that matches nothing. */
  function emptyNode(): HTMLElement {
    if (st.filter.trim())
      return filteredEmpty(tr('noResult'), tr('clearFilters'), () => {
        filter.value = ''
        filter.dispatchEvent(new Event('input'))
      })
    const e = opts.empty ?? {}
    let actions = e.actions
    if (!actions && msk.can('create')) {
      const b = h('button', { type: 'button', class: 'msk-btn ghost' }, opts.newLabel ?? tr('new'))
      b.addEventListener('click', () => btnNew.click())
      actions = [b]
    }
    return emptyState({ art: e.art, title: e.title ?? tr('emptyTitle'), text: e.text ?? tr('emptyText'), actions })
  }

  function renderTableView() {
    const cols = columns()
    const xcols = extColumns()
    const text = (f: FieldDecl, v: unknown) => (f.kind === 'number' && typeof v === 'number' ? v : display(f, v))
    grid.columns([
      ...cols.map((f, i): GridCol<Row> => ({
        key: f.key,
        title: f.label || f.key,
        width: i === 0 ? 'minmax(10rem,2fr)' : undefined,
        sort: (r) => text(f, r.values[f.key]),
        cell: (r) => {
          const box = h('span', {}, display(f, r.values[f.key]))
          if (i === 0) {
            if (r.shared) box.append(h('span', { class: 'msk-badge acc' }, tr('shared')))
            if (r.my_level !== 'manage') {
              const level = r.my_level === 'read' || r.my_level === 'write' ? tr(r.my_level) : r.my_level
              box.append(h('span', { class: 'msk-badge' }, level))
            }
          }
          return box
        },
      })),
      ...xcols.map((x): GridCol<Row> => ({
        key: `${x.ext}.${x.f.key}`,
        title: x.f.label || x.f.key,
        sort: (r) => display(x.f, st.extValues[r.id]?.[x.ext]?.[x.f.key]),
        cell: (r) => display(x.f, st.extValues[r.id]?.[x.ext]?.[x.f.key]),
      })),
      { key: '_owner', title: tr('owner'), sort: (r) => r.owner_name, className: 'msk-owner', cell: (r) => r.owner_name },
    ])
    // the filter is applied by the server, a page at a time; a page of the navigation (`where`) is
    // chosen here, so it loads every row (see load)
    const shown = opts.where ? st.rows.filter(opts.where) : st.rows
    const total = opts.where ? shown.length : (st.total ?? shown.length)
    count.textContent = total > shown.length ? tr('shownOf', { shown: shown.length, total }) : total === 1 ? tr('item') : tr('items', { n: total })
    btnMore.hidden = !st.next
    // the button that loads more is the last row of the rows that scroll: it comes into view only at their end
    const none = shown.length === 0
    grid.el.hidden = none
    emptyBox.hidden = !none
    if (none) emptyBox.replaceChildren(emptyNode())
    grid.set(shown, st.next ? morebar : null, st.filter.trim() ? tr('noResult') : tr('noItem'))
    foot.unobserve(morebar)
    foot.observe(morebar)
  }

  function input(f: FieldDecl, v: unknown, disabled: boolean, prefix = 'f'): HTMLElement {
    const id = `${prefix}-${f.key}`
    let el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    if (f.kind === 'bool') {
      el = h('input', { type: 'checkbox', id })
      ;(el as HTMLInputElement).checked = !!v
    } else if (f.kind === 'choice') {
      el = h('select', { id }, h('option', { value: '' }, '—'), ...(f.options ?? []).map((o) => h('option', { value: o }, f.option_labels?.[o] ?? o)))
      el.value = v == null ? '' : String(v)
    } else if (f.multiline) {
      el = h('textarea', { id, rows: '4' })
      el.value = v == null ? '' : String(v)
    } else {
      el = h('input', { id, type: f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text', step: 'any' })
      el.value = v == null ? '' : String(v)
    }
    el.dataset.key = f.key
    el.disabled = disabled
    const label = h('label', { for: id }, f.label || f.key)
    if (f.required) label.append(' ', h('span', { class: 'star' }, '*'))
    return h('div', { class: 'msk-field' + (f.required ? ' req' : '') }, label, el)
  }

  /** the tabs of the extensions for the items of the resource */
  const extTabs = () => st.ext.flatMap((e) => (e.tabs ?? []).map((t) => ({ ext: e.id, key: t.key, label: t.label })))

  /** Closes the tab of an extension shown now, if any. */
  function closeTab() {
    mounted?.close()
    mounted = null
    tabPanel.style.height = ''
    tabPanel.replaceChildren()
  }

  function renderTabs(row: Row | null) {
    const tabs = row ? extTabs() : []
    if (st.tab && !tabs.some((t) => t.ext === st.tab!.ext && t.key === st.tab!.key)) st.tab = null
    tabsBar.hidden = !tabs.length
    tabsBar.setAttribute('aria-label', tr('sections'))
    if (!tabs.length) {
      tabsBar.replaceChildren()
      return
    }
    const all = [{ ext: '', key: '', label: tr('detail') }, ...tabs]
    const buttons = all.map((t, i) => {
      const on = st.tab ? st.tab.ext === t.ext && st.tab.key === t.key : i === 0
      const b = h('button', { type: 'button', role: 'tab', class: 'msk-tab', 'aria-selected': String(on), 'aria-controls': 'msk-tabpanel', tabindex: on ? '0' : '-1' }, t.label)
      b.addEventListener('click', () => {
        st.tab = i === 0 ? null : { ext: t.ext, key: t.key }
        renderForm()
        tabsBar.querySelectorAll<HTMLElement>('[role="tab"]')[i]?.focus()
      })
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        if (!d) return
        e.preventDefault()
        const next = (i + d + all.length) % all.length
        ;(tabsBar.querySelectorAll<HTMLElement>('[role="tab"]')[next] as HTMLButtonElement | undefined)?.click()
      })
      return b
    })
    tabsBar.replaceChildren(...buttons)
  }

  function renderForm() {
    const row = selectedRow()
    const canWrite = !row || row.my_level === 'write' || row.my_level === 'manage'
    const canManage = !row || row.my_level === 'manage'
    formTitle.textContent = row ? tr('detail') : tr('newItem')
    renderTabs(row)
    readonly.textContent = row && !canWrite ? tr('sharedReadOnly') : row ? tr('ownerIs', { name: row.owner_name }) : ''
    const inTab = !!(row && st.tab)
    // with a reader, an existing item opens for reading and the fields come with «Edit»
    const reading = !!(row && opts.reader && !st.editing && !inTab)
    fieldsBox.hidden = extBox.hidden = toolsBox.hidden = inTab
    fieldsBox.hidden ||= reading
    toolsBox.replaceChildren()
    if (row && !inTab) opts.detail?.(row, toolsBox)
    readerBox.hidden = !reading
    readerBox.replaceChildren(...(reading ? [opts.reader!(itemCtx(row!))] : []))
    tabPanel.hidden = !inTab
    fieldsBox.replaceChildren(...visibleFields().map((f) => input(f, row?.values[f.key], !canWrite)))
    if (opts.editor && !reading) {
      const box = h('div', { class: 'msk-editor' })
      opts.editor(
        {
          row,
          value: (k) => (k in st.editorVals ? st.editorVals[k] : row?.values[k]),
          set: (k, v) => {
            st.editorVals[k] = v
          },
          canWrite,
          lang: lang(),
        },
        box,
      )
      fieldsBox.append(box)
    }
    btnEdit.hidden = !reading || !canWrite
    btnSave.hidden = !canWrite || inTab || reading
    btnDel.hidden = !row || !canManage || inTab || !msk.can('delete')
    btnShare.hidden = !row || !canManage || inTab || !msk.can('share')
    btnCancel.textContent = row && !(opts.reader && st.editing) ? tr('close') : tr('cancel')
    renderExtensions(row, canWrite)
    if (row && st.tab) {
      const key = `${row.id}|${st.tab.ext}|${st.tab.key}`
      if (mounted?.key !== key) {
        closeTab()
        tabPanel.style.height = '240px'
        mounted = { key, close: extApi.mountTab(tabPanel, row.id, st.tab.ext, st.tab.key) }
      }
    } else closeTab()
  }

  /** The fields and actions of the extensions, for an existing item. */
  function renderExtensions(row: Row | null, canWrite: boolean) {
    if (!row) {
      extBox.replaceChildren()
      return
    }
    extBox.replaceChildren(
      ...st.ext.flatMap((e, i) => {
        // an extension with only tabs or hidden fields has nothing to show here
        if (!e.fields.some((f) => !f.hidden) && !(canWrite && e.actions.length)) return []
        const vals = st.extValues[row.id]?.[e.id] ?? {}
        const inputs = e.fields
          .filter((f) => !f.hidden)
          .map((f) => {
            const el = input(f, vals[f.key], !canWrite, `x${i}`)
            el.querySelector<HTMLElement>('[data-key]')!.dataset.ext = e.id
            return el
          })
        const actions = canWrite
          ? e.actions.map((a) => {
              const b = h('button', { type: 'button', class: 'msk-btn ghost' }, a.label)
              b.addEventListener('click', () =>
                busy(async () => {
                  st.extValues[row.id] = { ...(st.extValues[row.id] ?? {}), [e.id]: await extApi.action(row.id, e.id, a.key) }
                  setMsg(tr('saved'))
                  renderTable()
                  renderForm()
                }),
              )
              return b
            })
          : []
        return [h('fieldset', { class: 'msk-extset' }, h('legend', {}, e.label), ...inputs, ...(actions.length ? [h('div', { class: 'msk-actions' }, ...actions)] : []))]
      }),
    )
  }

  /** The values of the extensions changed in the form: extension id -> values. */
  function collectExt(row: Row): Record<string, Values> {
    const out: Record<string, Values> = {}
    for (const el of extBox.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-ext]')) {
      const ext = el.dataset.ext!
      const key = el.dataset.key!
      const f = st.ext.find((e) => e.id === ext)?.fields.find((x) => x.key === key)
      if (!f) continue
      const v = f.kind === 'bool' ? (el as HTMLInputElement).checked : f.kind === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value === '' ? null : el.value
      const before = st.extValues[row.id]?.[ext]?.[key] ?? (f.kind === 'bool' ? false : null)
      if (v !== before) out[ext] = { ...(out[ext] ?? {}), [key]: v }
    }
    return out
  }

  function collect(): Values {
    const out: Values = {}
    for (const el of fieldsBox.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-key]')) {
      const key = el.dataset.key!
      const f = st.fields.find((x) => x.key === key)!
      if (f.kind === 'bool') out[key] = (el as HTMLInputElement).checked
      else if (f.kind === 'number') out[key] = el.value === '' ? null : Number(el.value)
      else out[key] = el.value === '' ? null : el.value
    }
    return { ...out, ...st.editorVals }
  }

  /** The first page again (after a change, with another filter). */
  async function load() {
    try {
      const filter = st.filter.trim() || undefined
      const r = await api.list(opts.where ? { filter } : { filter, limit: PAGE })
      if (disposed || filter !== (st.filter.trim() || undefined)) return
      st.fields = r.fields
      st.rows = r.rows
      st.next = r.next ?? null
      st.total = r.total ?? null
      opts.onLoad?.(st.rows)
      st.ext = await extApi.list()
      st.extValues = st.ext.some((e) => e.fields.length) ? await extApi.values(r.rows.map((x) => x.id)) : {}
      if (disposed) return
      if (st.selected && !selectedRow()) st.selected = null
      renderTable()
      renderForm()
    } catch (e) {
      setMsg(errText(e, msk.context?.lang), true)
    }
  }

  /** The next page, after the rows already shown. */
  async function loadMore() {
    if (!st.next) return
    try {
      btnMore.disabled = true
      const r = await api.list({ filter: st.filter.trim() || undefined, limit: PAGE, cursor: st.next })
      if (disposed) return
      st.rows = [...st.rows, ...r.rows]
      st.next = r.next ?? null
      st.total = r.total ?? st.total
      if (st.ext.some((e) => e.fields.length)) Object.assign(st.extValues, await extApi.values(r.rows.map((x) => x.id)))
      if (disposed) return
      renderTable()
    } catch (e) {
      setMsg(errText(e, msk.context?.lang), true)
    } finally {
      btnMore.disabled = false
    }
  }

  async function busy(fn: () => Promise<void>) {
    if (st.busy) return
    st.busy = true
    btnSave.disabled = btnDel.disabled = true
    try {
      await fn()
    } catch (e) {
      setMsg(errText(e, msk.context?.lang), true)
    } finally {
      st.busy = false
      btnSave.disabled = btnDel.disabled = false
    }
  }

  // the words go to the server a moment after the last key
  let typing: ReturnType<typeof setTimeout> | undefined
  filter.addEventListener('input', () => {
    st.filter = filter.value
    clearTimeout(typing)
    typing = setTimeout(() => void load(), 250)
  })
  btnMore.addEventListener('click', () => void loadMore())
  btnEdit.addEventListener('click', () => {
    st.editing = true
    renderForm()
    fieldsBox.querySelector<HTMLElement>('input,select,textarea')?.focus()
  })
  btnNew.addEventListener('click', () => {
    st.selected = null
    st.editorVals = {}
    st.tab = null
    st.editing = true
    split.dataset.open = 'true'
    setMsg('')
    renderTable()
    renderForm()
    fieldsBox.querySelector<HTMLElement>('input,select,textarea')?.focus()
  })
  btnCancel.addEventListener('click', () => {
    // editing an item that opened for reading: back to reading it
    const back = !!(opts.reader && st.editing && st.selected)
    const was = st.selected
    if (!back) st.selected = null
    st.editorVals = {}
    st.tab = null
    st.editing = false
    split.dataset.open = back ? 'true' : 'false'
    setMsg('')
    renderTable()
    renderForm()
    if (was) items.querySelector<HTMLElement>(`[data-id="${CSS.escape(was)}"]`)?.focus()
  })
  // Escape closes the panel (on a phone it covers the list)
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && views.length && split.dataset.open === 'true' && !(e.target as HTMLElement | null)?.closest?.('select, dialog, [role="dialog"]')) btnCancel.click()
  })
  btnSave.addEventListener('click', () =>
    busy(async () => {
      const values = collect()
      const row = selectedRow()
      const saved = row ? await api.update(row.id, values) : await api.create(values)
      if (row) for (const [ext, v] of Object.entries(collectExt(row))) await extApi.set(row.id, ext, v)
      // saving closes the panel (the list takes the whole width again) unless the plugin reads the item in it: then it shows the saved item
      st.selected = views.length && !opts.reader && opts.panel !== 'always' ? null : saved.id
      st.editing = false
      st.editorVals = {}
      split.dataset.open = st.selected ? 'true' : 'false'
      setMsg(tr('saved'))
      if (!st.selected && views.length) msk.toast(tr('saved'))
      await load()
      if (!st.selected && views.length) items.querySelector<HTMLElement>(`[data-id="${CSS.escape(saved.id)}"]`)?.focus()
    }),
  )
  btnDel.addEventListener('click', () =>
    busy(async () => {
      const row = selectedRow()
      if (!row) return
      if (!(await msk.confirm(tr('confirmDelete')))) return
      await api.remove(row.id)
      st.selected = null
      split.dataset.open = 'false'
      setMsg(tr('deleted'))
      await load()
    }),
  )
  btnShare.addEventListener('click', async () => {
    const row = selectedRow()
    if (row) {
      await msk.share(row.id).catch((e) => setMsg(errText(e, msk.context?.lang), true))
      await load()
    }
  })

  renderTexts()
  split.dataset.open = 'false'
  if (opts.panel === 'always') split.dataset.panel = 'always'
  if (views.length > 1) renderSwitch()
  renderForm()
  // a new language of the host: the texts again, in the new language
  const off = msk.onContext(() => {
    renderTexts()
    if (views.length > 1) renderSwitch()
    renderTable()
    renderForm()
  })
  // a tab of an extension changed its values on an item: the columns again
  const offExt = msk.onEvent((event) => {
    if (event !== 'ext.changed' || disposed) return
    void extApi
      .values(st.rows.map((x) => x.id))
      .then((v) => {
        st.extValues = v
        renderTable()
      })
      .catch(() => {})
  })
  void load()
  return () => {
    disposed = true
    clearTimeout(typing)
    off()
    offExt()
    closeTab()
    foot.disconnect()
    root.replaceChildren()
  }
}

/** The text of an error in the language of the host (see `errorText`). */
export function errText(e: unknown, lang?: string): string {
  return errorText(e, lang)
}
