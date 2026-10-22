// Generic CRUD view driven by the metadata of the resource (fields of the manifest).
// It respects the level of the user on every row: read, write, manage.
// The extensions of the plugin (other plugins that add fields and actions to its items) show by
// themselves: their fields as columns and in the detail, their actions as buttons.
// Its texts are in English, or in Italian when the host is in Italian (the `context` of the bridge).

import type { Msk } from './client.ts'
import { errorText } from './errors.ts'
import type { ExtensionView, FieldDecl, Row, Values } from './protocol.ts'

export interface CrudOptions {
  title?: string
  /** fields to show in the table (default: the fields that are not hidden, at most 5) */
  columns?: string[]
  /** label for "new" (default "New") */
  newLabel?: string
}

type State = {
  fields: FieldDecl[]
  rows: Row[]
  selected: string | null
  filter: string
  busy: boolean
  /** extensions of the resource and their values: item id -> extension id -> values */
  ext: ExtensionView[]
  extValues: Record<string, Record<string, Values>>
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
    noResult: 'no result',
    noItem: 'no item',
    shared: 'shared',
    detail: 'Detail',
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
    noResult: 'nessun risultato',
    noItem: 'nessun elemento',
    shared: 'condivisa',
    detail: 'Dettaglio',
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
  const st: State = { fields: [], rows: [], selected: null, filter: '', busy: false, ext: [], extValues: {} }
  let disposed = false
  const tr = (k: Text, vars: Record<string, string | number> = {}) =>
    TEXTS[msk.context?.lang === 'it' ? 'it' : 'en'][k].replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? ''))

  const title = h('h2', { class: 'msk-h2' }, opts.title ?? resource)
  const filter = h('input', { type: 'search', class: 'msk-filter' })
  const btnNew = h('button', { type: 'button', class: 'msk-btn ghost' })
  const count = h('span', { class: 'msk-count' })
  const thead = h('thead')
  const tbody = h('tbody')
  const table = h('table', { class: 'msk-table' }, thead, tbody)
  const formTitle = h('h3')
  const readonly = h('div', { class: 'msk-readonly' })
  const fieldsBox = h('div')
  const extBox = h('div', { class: 'msk-ext' })
  const btnSave = h('button', { type: 'button', class: 'msk-btn' })
  const btnCancel = h('button', { type: 'button', class: 'msk-btn ghost' })
  const btnShare = h('button', { type: 'button', class: 'msk-btn ghost' })
  const btnDel = h('button', { type: 'button', class: 'msk-btn danger' })
  /** The fixed texts, in the language of the host. */
  function renderTexts() {
    filter.placeholder = tr('filter')
    filter.setAttribute('aria-label', tr('filterLabel'))
    btnNew.textContent = opts.newLabel ?? tr('new')
    btnSave.textContent = tr('save')
    btnShare.textContent = tr('share')
    btnDel.textContent = tr('del')
  }
  const msg = h('div', { class: 'msk-msg', role: 'status' })
  const form = h('section', { class: 'msk-form' }, formTitle, readonly, fieldsBox, extBox, h('div', { class: 'msk-actions' }, btnSave, btnCancel, btnShare, btnDel), msg)

  root.replaceChildren(
    title,
    h('div', { class: 'msk-toolbar' }, filter, btnNew, h('span', { class: 'grow' }), count),
    h('div', { class: 'msk-tablewrap' }, table),
    form,
  )

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
    const q = st.filter.trim().toLowerCase()
    const shown = st.rows.filter((r) => !q || Object.values(r.values).some((v) => String(v ?? '').toLowerCase().includes(q)))
    count.textContent = shown.length === 1 ? tr('item') : tr('items', { n: shown.length })
    if (!shown.length) {
      tbody.replaceChildren(h('tr', {}, h('td', { class: 'empty', colspan: String(cols.length + xcols.length + 1) }, st.rows.length ? tr('noResult') : tr('noItem'))))
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

  function renderForm() {
    const row = selectedRow()
    const canWrite = !row || row.my_level === 'write' || row.my_level === 'manage'
    const canManage = !row || row.my_level === 'manage'
    formTitle.textContent = row ? tr('detail') : tr('newItem')
    readonly.textContent = row && !canWrite ? tr('sharedReadOnly') : row ? tr('ownerIs', { name: row.owner_name }) : ''
    fieldsBox.replaceChildren(...visibleFields().map((f) => input(f, row?.values[f.key], !canWrite)))
    btnSave.hidden = !canWrite
    btnDel.hidden = !row || !canManage
    btnShare.hidden = !row || !canManage
    btnCancel.textContent = row ? tr('close') : tr('cancel')
    renderExtensions(row, canWrite)
  }

  /** The fields and actions of the extensions, for an existing item. */
  function renderExtensions(row: Row | null, canWrite: boolean) {
    if (!row) {
      extBox.replaceChildren()
      return
    }
    extBox.replaceChildren(
      ...st.ext.map((e, i) => {
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
        return h('fieldset', { class: 'msk-extset' }, h('legend', {}, e.label), ...inputs, ...(actions.length ? [h('div', { class: 'msk-actions' }, ...actions)] : []))
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

  async function load() {
    try {
      const r = await api.list()
      if (disposed) return
      st.fields = r.fields
      st.rows = r.rows
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

  filter.addEventListener('input', () => {
    st.filter = filter.value
    renderTable()
  })
  btnNew.addEventListener('click', () => {
    st.selected = null
    setMsg('')
    renderTable()
    renderForm()
    fieldsBox.querySelector<HTMLElement>('input,select,textarea')?.focus()
  })
  btnCancel.addEventListener('click', () => {
    st.selected = null
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
  void load()
  return () => {
    disposed = true
    off()
    root.replaceChildren()
  }
}

/** The text of an error in the language of the host (see `errorText`). */
export function errText(e: unknown, lang?: string): string {
  return errorText(e, lang)
}
