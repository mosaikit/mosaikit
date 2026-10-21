// Vista CRUD generica guidata dai metadati della risorsa (campi del manifest).
// Rispetta il livello dell'utente su ogni riga: lettura, scrittura, gestione.

import type { Msk } from './client.ts'
import type { FieldDecl, Row, Values } from './protocol.ts'

export interface CrudOptions {
  title?: string
  /** campi da mostrare in tabella (default: i campi non nascosti, al massimo 5) */
  columns?: string[]
  /** etichetta per "nuovo" (default "Nuovo") */
  newLabel?: string
}

type State = { fields: FieldDecl[]; rows: Row[]; selected: string | null; filter: string; busy: boolean }

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
  return String(v)
}

const LEVEL_LABEL: Record<string, string> = { read: 'sola lettura', write: 'modifica', manage: 'gestione' }

export function mountCrud(root: HTMLElement, msk: Msk, resource: string, opts: CrudOptions = {}): () => void {
  const api = msk.crud(resource)
  const st: State = { fields: [], rows: [], selected: null, filter: '', busy: false }
  let disposed = false

  const title = h('h2', { class: 'msk-h2' }, opts.title ?? resource)
  const filter = h('input', { type: 'search', class: 'msk-filter', placeholder: 'Filtra…', 'aria-label': 'Filtra' })
  const btnNew = h('button', { type: 'button', class: 'msk-btn ghost' }, opts.newLabel ?? '＋ Nuovo')
  const count = h('span', { class: 'msk-count' })
  const thead = h('thead')
  const tbody = h('tbody')
  const table = h('table', { class: 'msk-table' }, thead, tbody)
  const formTitle = h('h3')
  const readonly = h('div', { class: 'msk-readonly' })
  const fieldsBox = h('div')
  const btnSave = h('button', { type: 'button', class: 'msk-btn' }, 'Salva')
  const btnCancel = h('button', { type: 'button', class: 'msk-btn ghost' }, 'Annulla')
  const btnShare = h('button', { type: 'button', class: 'msk-btn ghost' }, 'Condividi…')
  const btnDel = h('button', { type: 'button', class: 'msk-btn danger' }, 'Elimina')
  const msg = h('div', { class: 'msk-msg', role: 'status' })
  const form = h('section', { class: 'msk-form' }, formTitle, readonly, fieldsBox, h('div', { class: 'msk-actions' }, btnSave, btnCancel, btnShare, btnDel), msg)

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

  function renderTable() {
    const cols = columns()
    thead.replaceChildren(h('tr', {}, ...cols.map((f) => h('th', {}, f.label || f.key)), h('th', {}, 'Proprietario')))
    const q = st.filter.trim().toLowerCase()
    const shown = st.rows.filter((r) => !q || Object.values(r.values).some((v) => String(v ?? '').toLowerCase().includes(q)))
    count.textContent = shown.length === 1 ? '1 elemento' : `${shown.length} elementi`
    if (!shown.length) {
      tbody.replaceChildren(h('tr', {}, h('td', { class: 'empty', colspan: String(cols.length + 1) }, st.rows.length ? 'nessun risultato' : 'nessun elemento')))
      return
    }
    tbody.replaceChildren(
      ...shown.map((r) => {
        const tr = h('tr', { class: 'row' + (r.id === st.selected ? ' sel' : ''), tabindex: '0' })
        cols.forEach((f, i) => {
          const td = h('td', {}, display(f, r.values[f.key]))
          if (i === 0) {
            if (r.shared) td.append(h('span', { class: 'msk-badge acc' }, 'condivisa'))
            if (r.my_level !== 'manage') td.append(h('span', { class: 'msk-badge' }, LEVEL_LABEL[r.my_level] ?? r.my_level))
          }
          tr.append(td)
        })
        tr.append(h('td', { class: 'msk-owner' }, r.owner_name))
        const pick = () => {
          st.selected = st.selected === r.id ? null : r.id
          renderTable()
          renderForm()
        }
        tr.addEventListener('click', pick)
        tr.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') pick()
        })
        return tr
      }),
    )
  }

  function input(f: FieldDecl, v: unknown, disabled: boolean): HTMLElement {
    const id = `f-${f.key}`
    let el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    if (f.kind === 'bool') {
      el = h('input', { type: 'checkbox', id })
      ;(el as HTMLInputElement).checked = !!v
    } else if (f.kind === 'choice') {
      el = h('select', { id }, h('option', { value: '' }, '—'), ...(f.options ?? []).map((o) => h('option', { value: o }, o)))
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
    formTitle.textContent = row ? 'Dettaglio' : 'Nuovo elemento'
    readonly.textContent = row && !canWrite ? 'Condiviso con te in sola lettura.' : row ? `Proprietario: ${row.owner_name}` : ''
    fieldsBox.replaceChildren(...visibleFields().map((f) => input(f, row?.values[f.key], !canWrite)))
    btnSave.hidden = !canWrite
    btnDel.hidden = !row || !canManage
    btnShare.hidden = !row || !canManage
    btnCancel.textContent = row ? 'Chiudi' : 'Annulla'
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
      if (st.selected && !selectedRow()) st.selected = null
      renderTable()
      renderForm()
    } catch (e) {
      setMsg(errText(e), true)
    }
  }

  async function busy(fn: () => Promise<void>) {
    if (st.busy) return
    st.busy = true
    btnSave.disabled = btnDel.disabled = true
    try {
      await fn()
    } catch (e) {
      setMsg(errText(e), true)
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
      st.selected = saved.id
      setMsg('salvato')
      await load()
    }),
  )
  btnDel.addEventListener('click', () =>
    busy(async () => {
      const row = selectedRow()
      if (!row) return
      if (!(await msk.confirm('Eliminare questo elemento?'))) return
      await api.remove(row.id)
      st.selected = null
      setMsg('eliminato')
      await load()
    }),
  )
  btnShare.addEventListener('click', async () => {
    const row = selectedRow()
    if (row) {
      await msk.share(row.id).catch((e) => setMsg(errText(e), true))
      await load()
    }
  })

  void load()
  return () => {
    disposed = true
    root.replaceChildren()
  }
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
