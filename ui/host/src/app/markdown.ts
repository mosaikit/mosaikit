// The blocks of the Markdown of the guides shipped with the shell (docs/guide): headings, paragraphs,
// bullet and numbered lists (nested by indentation) and tables. GuideText.tsx draws them.

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; ordered: boolean; items: Item[] }
  | { kind: 'table'; head: string[]; rows: string[][] }

export interface Item {
  text: string
  children: Block[]
}

const BULLET = /^(\s*)(-|\d+\.)\s+(.*)$/

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** The blocks of a text, lists nested by the indentation of their markers. */
export function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      out.push({ kind: 'heading', level: h[1].length, text: h[2].trim() })
      i++
      continue
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]))
      out.push({ kind: 'table', head, rows })
      continue
    }
    if (BULLET.test(line)) {
      const block: string[] = []
      while (i < lines.length && lines[i].trim() && (BULLET.test(lines[i]) || /^\s+\S/.test(lines[i]))) block.push(lines[i++])
      out.push(list(block))
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^#{1,4}\s/.test(lines[i]) && !BULLET.test(lines[i]) && !lines[i].trim().startsWith('|')) para.push(lines[i++].trim())
    out.push({ kind: 'para', text: para.join(' ') })
  }
  return out
}

/** A list from its lines: items at the indentation of the first marker, deeper lines belong to them. */
function list(lines: string[]): Block {
  const first = BULLET.exec(lines[0])!
  const indent = first[1].length
  const ordered = first[2] !== '-'
  const items: { head: string[]; rest: string[] }[] = []
  for (const l of lines) {
    const m = BULLET.exec(l)
    if (m && m[1].length === indent) items.push({ head: [m[3]], rest: [] })
    else if (items.length) {
      const cur = items[items.length - 1]
      if (!cur.rest.length && !BULLET.test(l)) cur.head.push(l.trim())
      else cur.rest.push(l)
    }
  }
  return {
    kind: 'list',
    ordered,
    items: items.map((it) => ({ text: it.head.join(' '), children: it.rest.length ? parse(it.rest.join('\n')) : [] })),
  }
}

