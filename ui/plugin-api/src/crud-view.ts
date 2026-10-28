// Generic CRUD view driven by the metadata of the resource (fields of the manifest).
// It respects the level of the user on every row: read, write, manage.
// The extensions of the plugin (other plugins that add fields and actions to its items) show by
// themselves: their fields as columns and in the detail, their actions as buttons, their tabs next to
// the detail of an item (the host draws the page of the extension over the tab: `mountTab`).
// Its texts are in English, or in Italian when the host is in Italian (the `context` of the bridge).

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
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]) {
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
  },
}
type Text = keyof (typeof TEXTS)['en']

export function mountCrud(root: HTMLElement, msk: Msk, resource: string, opts: CrudOptions = {}): () => void {
  const api = msk.crud(resource)
  const extApi = msk.extensions(resource)
  const st: State = { fields: [], rows: [], next: null, total: null, selected: null, filter: '', busy: false, ext: [], extValues: {}, tab: null }
  let disposed = false
  /** the tab mounted now (row|extension|key) and the function that closes it */
  let mounted: { key: string; close: () => void } | null = null
  const tr = (k: Text, vars: Record<string, string | number> = {}) =>
    TEXTS[msk.context?.lang === 'it' ? 'it' : 'en'][k].replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? ''))

  const filter = h('input', { type: 'search', class: 'msk-filter' })
  const btnNew = h('button', { type: 'button', class: 'msk-btn ghost' })
  const count = h('span', { class: 'msk-count' })
  const btnMore = h('button', { type: 'button', class: 'msk-btn ghost msk-more' })
  const thead = h('thead')
  const tbody = h('tbody')
  const table = h('table', { class: 'msk-table' }, thead, tbody)
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
  /** The fixed texts, in the language of the host. */
  function renderTexts() {
    filter.placeholder = tr('filter')
    filter.setAttribute('aria-label', tr('filterLabel'))
    btnNew.textContent = opts.newLabel ?? tr('new')
    btnMore.textContent = tr('more')
    // what the profile of the person does not allow is not offered (the kernel refuses it anyway)
    btnNew.hidden = !msk.can('create')
    btnSave.textContent = tr('save')
    btnShare.textContent = tr('share')
    btnDel.textContent = tr('del')
  }
  const msg = h('div', { class: 'msk-msg', role: 'status' })
  const form = h('section', { class: 'msk-form' }, formTitle, tabsBar, readonly, fieldsBox, extBox, toolsBox, tabPanel, h('div', { class: 'msk-actions' }, btnSave, btnCancel, btnShare, btnDel), msg)

  const morebar = h('div', { class: 'msk-morebar' }, btnMore)
  const body = pageBody(h('div', { class: 'msk-tablewrap' }, table), morebar, form)
  root.replaceChildren(
    // the header and the filters never scroll: the table, the foot and the form do
    pageHead({ title: opts.title ?? resource, section: opts.section, sub: count, actions: [btnNew], filters: [filter] }),
    body,
  )
  // the rest of the rows come as the foot of the table comes into view
  const foot = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && !btnMore.hidden && !btnMore.disabled && void loadMore(), { root: body, rootMargin: '200px' })
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

  function renderTable() {
    const cols = columns()
    const xcols = extColumns()
    thead.replaceChildren(h('tr', {}, ...cols.map((f) => h('th', {}, f.label || f.key)), ...xcols.map((x) => h('th', {}, x.f.label || x.f.key)), h('th', {}, tr('owner'))))
    // the filter is applied by the server, a page at a time; a page of the navigation (`where`) is
    // chosen here, so it loads every row (see load)
    const shown = opts.where ? st.rows.filter(opts.where) : st.rows
    const total = opts.where ? shown.length : (st.total ?? shown.length)
    count.textContent = total > shown.length ? tr('shownOf', { shown: shown.length, total }) : total === 1 ? tr('item') : tr('items', { n: total })
    btnMore.hidden = !st.next
    if (!shown.length) {
      tbody.replaceChildren(h('tr', {}, h('td', { class: 'empty', colspan: String(cols.length + xcols.length + 1) }, st.filter.trim() ? tr('noResult') : tr('noItem'))))
      return
    }
    tbody.replaceChildren(
      ...shown.map((r) => {
        const line = h('tr', { class: 'row' + (r.id === st.selected ? ' sel' : ''), tabindex: '0' })
        cols.forEach((f, i) => {
          const td = h('td', {}, display(f, r.values[f.key]))
          if (i === 0) {
            if (r.shared) td.append(h('span', { class: 'msk-badge acc' }, tr('shared')))
            if (r.my_level !== 'manage') {
              const level = r.my_level === 'read' || r.my_level === 'write' ? tr(r.my_level) : r.my_level
              td.append(h('span', { class: 'msk-badge' }, level))
            }
          }
          line.append(td)
        })
        for (const x of xcols) line.append(h('td', {}, display(x.f, st.extValues[r.id]?.[x.ext]?.[x.f.key])))
        line.append(h('td', { class: 'msk-owner' }, r.owner_name))
        const pick = () => {
          st.selected = st.selected === r.id ? null : r.id
          st.tab = null
          renderTable()
          renderForm()
        }
        line.addEventListener('click', pick)
        line.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') pick()
        })
        return line
      }),
    )
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
    fieldsBox.hidden = extBox.hidden = toolsBox.hidden = inTab
    toolsBox.replaceChildren()
    if (row && !inTab) opts.detail?.(row, toolsBox)
    tabPanel.hidden = !inTab
    fieldsBox.replaceChildren(...visibleFields().map((f) => input(f, row?.values[f.key], !canWrite)))
    btnSave.hidden = !canWrite || inTab
    btnDel.hidden = !row || !canManage || inTab || !msk.can('delete')
    btnShare.hidden = !row || !canManage || inTab || !msk.can('share')
    btnCancel.textContent = row ? tr('close') : tr('cancel')
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
    return out
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
  btnNew.addEventListener('click', () => {
    st.selected = null
    st.tab = null
    setMsg('')
    renderTable()
    renderForm()
    fieldsBox.querySelector<HTMLElement>('input,select,textarea')?.focus()
  })
  btnCancel.addEventListener('click', () => {
    st.selected = null
    st.tab = null
    setMsg('')
    renderTable()
    renderForm()
  })
  btnSave.addEventListener('click', () =>
    busy(async () => {
      const values = collect()
      const row = selectedRow()
      const saved = row ? await api.update(row.id, values) : await api.create(values)
      if (row) for (const [ext, v] of Object.entries(collectExt(row))) await extApi.set(row.id, ext, v)
      st.selected = saved.id
      setMsg(tr('saved'))
      await load()
    }),
  )
  btnDel.addEventListener('click', () =>
    busy(async () => {
      const row = selectedRow()
      if (!row) return
      if (!(await msk.confirm(tr('confirmDelete')))) return
      await api.remove(row.id)
      st.selected = null
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
  renderForm()
  // a new language of the host: the texts again, in the new language
  const off = msk.onContext(() => {
    renderTexts()
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
