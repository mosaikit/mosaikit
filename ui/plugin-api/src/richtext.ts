// A Markdown editor: a textarea with a toolbar (bold, italic, heading, list, check list, quote, code, link) and a live
// preview tab. The value is plain Markdown text, so it stays searchable, diff-able and portable (and `renderMarkdown`
// draws it). Keyboard: Ctrl/Cmd+B, Ctrl/Cmd+I, Ctrl/Cmd+K.
import { h } from './dom.ts'
import { renderMarkdown } from './markdown.ts'

export interface RichTextLabels {
  write?: string
  preview?: string
  bold?: string
  italic?: string
  heading?: string
  list?: string
  checks?: string
  quote?: string
  code?: string
  link?: string
  nothing?: string
}

export interface RichText {
  el: HTMLElement
  get(): string
  set(v: string): void
  focus(): void
}

const EN: Required<RichTextLabels> = { write: 'Write', preview: 'Preview', bold: 'Bold', italic: 'Italic', heading: 'Heading', list: 'List', checks: 'Check list', quote: 'Quote', code: 'Code', link: 'Link', nothing: 'Nothing to preview' }

/** Wraps the selection of `text` (`[start, end)`) with `before`/`after`, or inserts them around a placeholder. Returns the new text and selection. */
export function wrapSelection(text: string, start: number, end: number, before: string, after: string, placeholder = ''): { text: string; start: number; end: number } {
  const sel = text.slice(start, end) || placeholder
  const out = text.slice(0, start) + before + sel + after + text.slice(end)
  return { text: out, start: start + before.length, end: start + before.length + sel.length }
}

/** Puts `prefix` at the start of every line touched by the selection (a second press on all-prefixed lines removes it). */
export function prefixLines(text: string, start: number, end: number, prefix: string): { text: string; start: number; end: number } {
  const from = text.lastIndexOf('\n', start - 1) + 1
  const nl = text.indexOf('\n', end)
  const to = nl === -1 ? text.length : nl
  const lines = text.slice(from, to).split('\n')
  const all = lines.every((l) => l.startsWith(prefix))
  const next = lines.map((l) => (all ? l.slice(prefix.length) : prefix + l))
  const block = next.join('\n')
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length }
}

export function richText(opts: { label: string; value: string; labels?: RichTextLabels; rows?: number; placeholder?: string; onChange?: (v: string) => void }): RichText {
  const L = { ...EN, ...opts.labels }
  const ta = h('textarea', { class: 'msk-rt-text', 'aria-label': opts.label, rows: String(opts.rows ?? 8), placeholder: opts.placeholder ?? '' })
  ta.value = opts.value
  const view = h('div', { class: 'msk-rt-view' })
  view.hidden = true
  const apply = (r: { text: string; start: number; end: number }) => {
    ta.value = r.text
    ta.setSelectionRange(r.start, r.end)
    ta.focus()
    opts.onChange?.(ta.value)
  }
  const sel = () => [ta.selectionStart ?? 0, ta.selectionEnd ?? 0] as const
  const tools: [string, string, () => void][] = [
    ['B', L.bold, () => apply(wrapSelection(ta.value, ...sel(), '**', '**', L.bold.toLowerCase()))],
    ['I', L.italic, () => apply(wrapSelection(ta.value, ...sel(), '*', '*', L.italic.toLowerCase()))],
    ['H', L.heading, () => apply(prefixLines(ta.value, ...sel(), '## '))],
    ['•', L.list, () => apply(prefixLines(ta.value, ...sel(), '- '))],
    ['☑', L.checks, () => apply(prefixLines(ta.value, ...sel(), '- [ ] '))],
    ['❝', L.quote, () => apply(prefixLines(ta.value, ...sel(), '> '))],
    ['</>', L.code, () => apply(wrapSelection(ta.value, ...sel(), '`', '`', L.code.toLowerCase()))],
    ['🔗', L.link, () => apply(wrapSelection(ta.value, ...sel(), '[', '](https://)', L.link.toLowerCase()))],
  ]
  const bar = h('div', { class: 'msk-rt-bar', role: 'toolbar', 'aria-label': opts.label })
  for (const [glyph, name, run] of tools) {
    const b = h('button', { type: 'button', class: 'msk-rt-btn', title: name, 'aria-label': name }, glyph)
    b.addEventListener('click', run)
    bar.append(b)
  }
  const tabs = h('div', { class: 'msk-rt-tabs', role: 'tablist' })
  const tWrite = h('button', { type: 'button', role: 'tab', class: 'msk-rt-tab', 'aria-selected': 'true' }, L.write)
  const tView = h('button', { type: 'button', role: 'tab', class: 'msk-rt-tab', 'aria-selected': 'false' }, L.preview)
  const show = (preview: boolean) => {
    tWrite.setAttribute('aria-selected', String(!preview))
    tView.setAttribute('aria-selected', String(preview))
    ta.hidden = preview
    bar.hidden = preview
    view.hidden = !preview
    if (preview) {
      const md = renderMarkdown(ta.value, {
        onToggle: (line, checked) => {
          const lines = ta.value.split('\n')
          lines[line] = (lines[line] ?? '').replace(/\[( |x|X)\]/, checked ? '[x]' : '[ ]')
          ta.value = lines.join('\n')
          opts.onChange?.(ta.value)
        },
      })
      view.replaceChildren(ta.value.trim() ? md : h('p', { class: 'msk-rt-none' }, L.nothing))
    }
  }
  tWrite.addEventListener('click', () => show(false))
  tView.addEventListener('click', () => show(true))
  tabs.append(tWrite, tView)
  ta.addEventListener('input', () => opts.onChange?.(ta.value))
  ta.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return
    const k = ev.key.toLowerCase()
    const run = k === 'b' ? tools[0] : k === 'i' ? tools[1] : k === 'k' ? tools[7] : undefined
    if (run) {
      ev.preventDefault()
      run[2]()
    }
  })
  const el = h('div', { class: 'msk-rt' }, h('div', { class: 'msk-rt-head' }, tabs, bar), ta, view)
  return { el, get: () => ta.value, set: (v) => ((ta.value = v), show(false)), focus: () => ta.focus() }
}
