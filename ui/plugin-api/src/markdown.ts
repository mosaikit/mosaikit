// A small, safe Markdown renderer for the texts of the plugins (notes, descriptions, wiki, messages). It builds DOM
// nodes with `textContent`: no HTML of the source is ever interpreted, so there is nothing to sanitise. Supported:
// headings (#..###), paragraphs, bold, italic, `code`, fenced code, links (http, https, mailto), bullet / numbered /
// check lists (- [ ] and - [x]), quotes and rules. Anything else stays plain text.

const SAFE_URL = /^(https?:|mailto:)/i

/** The inline marks of one line: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`. */
export function renderInline(src: string, into: Node = document.createDocumentFragment()): Node {
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g
  let last = 0
  for (const m of src.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) into.appendChild(document.createTextNode(src.slice(last, i)))
    const t = m[0]
    if (m[1]) {
      const e = document.createElement('code')
      e.textContent = t.slice(1, -1)
      into.appendChild(e)
    } else if (m[2]) {
      const e = document.createElement('strong')
      renderInline(t.slice(2, -2), e)
      into.appendChild(e)
    } else if (m[3]) {
      const e = document.createElement('em')
      renderInline(t.slice(1, -1), e)
      into.appendChild(e)
    } else {
      const close = t.indexOf('](')
      const text = t.slice(1, close)
      const url = t.slice(close + 2, -1)
      if (SAFE_URL.test(url)) {
        const a = document.createElement('a')
        a.href = url
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = text
        into.appendChild(a)
      } else into.appendChild(document.createTextNode(t))
    }
    last = i + t.length
  }
  if (last < src.length) into.appendChild(document.createTextNode(src.slice(last)))
  return into
}

const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBER = /^\s*\d+[.)]\s+(.*)$/
const CHECK = /^\[( |x|X)\]\s+(.*)$/

/** Renders `src` into a `div.msk-md`. `onToggle(line, checked)` makes the check boxes live (the line is the 0-based line of the source). */
export function renderMarkdown(src: string, opts: { onToggle?: (line: number, checked: boolean) => void } = {}): HTMLElement {
  const root = document.createElement('div')
  root.className = 'msk-md'
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  let para: string[] = []
  const flush = () => {
    if (!para.length) return
    const p = document.createElement('p')
    para.forEach((l, k) => {
      if (k) p.appendChild(document.createElement('br'))
      renderInline(l, p)
    })
    root.appendChild(p)
    para = []
  }
  while (i < lines.length) {
    const line = lines[i]!
    if (/^```/.test(line)) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i++]!)
      i++
      const pre = document.createElement('pre')
      const c = document.createElement('code')
      c.textContent = code.join('\n')
      pre.appendChild(c)
      root.appendChild(pre)
      continue
    }
    const hd = /^(#{1,3})\s+(.*)$/.exec(line)
    if (hd) {
      flush()
      const h = document.createElement('h' + hd[1]!.length)
      renderInline(hd[2]!, h)
      root.appendChild(h)
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      root.appendChild(document.createElement('hr'))
      i++
      continue
    }
    if (/^>\s?/.test(line)) {
      flush()
      const q = document.createElement('blockquote')
      const text: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!)) text.push(lines[i++]!.replace(/^>\s?/, ''))
      renderInline(text.join(' '), q)
      root.appendChild(q)
      continue
    }
    if (BULLET.test(line) || NUMBER.test(line)) {
      flush()
      const ordered = NUMBER.test(line) && !BULLET.test(line)
      const list = document.createElement(ordered ? 'ol' : 'ul')
      const re = ordered ? NUMBER : BULLET
      let hasChecks = false
      while (i < lines.length && re.test(lines[i]!)) {
        const at = i
        const body = re.exec(lines[i]!)![1]!
        const li = document.createElement('li')
        const ck = !ordered ? CHECK.exec(body) : null
        if (ck) {
          hasChecks = true
          const box = document.createElement('input')
          box.type = 'checkbox'
          box.checked = ck[1] !== ' '
          box.disabled = !opts.onToggle
          box.addEventListener('change', () => opts.onToggle?.(at, box.checked))
          li.className = 'check' + (box.checked ? ' done' : '')
          const label = document.createElement('span')
          renderInline(ck[2]!, label)
          li.append(box, label)
        } else renderInline(body, li)
        list.appendChild(li)
        i++
      }
      if (hasChecks) list.className = 'checklist'
      root.appendChild(list)
      continue
    }
    if (!line.trim()) {
      flush()
      i++
      continue
    }
    para.push(line)
    i++
  }
  flush()
  return root
}

/** Flips the check box of `line` in the source (`- [ ]` <-> `- [x]`); the source is returned unchanged if the line has none. */
export function toggleCheck(src: string, line: number, checked: boolean): string {
  const lines = src.split('\n')
  const l = lines[line]
  if (l === undefined) return src
  lines[line] = l.replace(/^(\s*[-*+]\s+)\[( |x|X)\]/, `$1[${checked ? 'x' : ' '}]`)
  return lines.join('\n')
}

/** The share of check boxes done in the source, for a progress bar: `{ done, total }`. */
export function checkProgress(src: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const l of src.split('\n')) {
    const m = /^\s*[-*+]\s+\[( |x|X)\]/.exec(l)
    if (m) {
      total++
      if (m[1] !== ' ') done++
    }
  }
  return { done, total }
}
