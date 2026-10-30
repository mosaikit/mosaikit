// A small Markdown renderer for the guides shipped with the shell (docs/guide): the blocks of
// markdown.ts with **bold**, *italic*, `code` and links. It builds React elements, never HTML, so nothing
// in a text can run. Links to another guide call `onGuide`; other relative links (files of the
// repository) stay as plain text.

import type { ReactNode } from 'react'
import { parse, type Block } from './markdown.ts'

/** Inline text: **bold**, *italic*, `code`, [label](target). */
function inline(text: string, onGuide?: (name: string) => void): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[2] !== undefined) out.push(<strong key={key++}>{inline(m[2], onGuide)}</strong>)
    else if (m[3] !== undefined) out.push(<em key={key++}>{m[3]}</em>)
    else if (m[4] !== undefined)
      out.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {m[4]}
        </code>,
      )
    else {
      const label = m[5]
      const target = m[6]
      const guide = /^(?:\.\/)?([a-z-]+)\.md$/.exec(target)
      if (/^https?:\/\//.test(target))
        out.push(
          <a key={key++} href={target} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
            {label}
          </a>,
        )
      else if (guide && onGuide)
        out.push(
          <button key={key++} type="button" className="text-primary underline underline-offset-2" onClick={() => onGuide(guide[1])}>
            {label}
          </button>,
        )
      else out.push(label)
    }
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function render(blocks: Block[], onGuide?: (name: string) => void): ReactNode[] {
  return blocks.map((b, i) => {
    if (b.kind === 'heading') {
      const cls = ['', 'text-lg font-semibold', 'mt-5 text-base font-semibold', 'mt-4 text-sm font-semibold', 'mt-3 text-sm font-medium'][b.level]
      const Tag = (['h2', 'h2', 'h3', 'h4', 'h5'] as const)[b.level]
      return (
        <Tag key={i} className={cls}>
          {inline(b.text, onGuide)}
        </Tag>
      )
    }
    if (b.kind === 'para')
      return (
        <p key={i} className="mt-2 text-sm leading-relaxed">
          {inline(b.text, onGuide)}
        </p>
      )
    if (b.kind === 'list') {
      const List = b.ordered ? 'ol' : 'ul'
      return (
        <List key={i} className={`mt-2 space-y-1 pl-5 text-sm ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
          {b.items.map((it, j) => (
            <li key={j}>
              {inline(it.text, onGuide)}
              {render(it.children, onGuide)}
            </li>
          ))}
        </List>
      )
    }
    return (
      // a small static table of the text of a guide (not a list of records): plain, in the look of the list tables
      <div key={i} className="mt-3 overflow-x-auto rounded-xl border bg-card" data-static-table>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {b.head.map((c, j) => (
                <th key={j} className="h-10 border-b px-3 text-left font-medium">
                  {inline(c, onGuide)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, j) => (
              <tr key={j} className="align-top">
                {r.map((c, k) => (
                  <td key={k} className="border-b px-3 py-2 [tr:last-child>&]:border-0">
                    {inline(c, onGuide)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  })
}

/** A guide (Markdown) drawn as React elements. */
export function GuideText({ text, onGuide }: { text: string; onGuide?: (name: string) => void }) {
  return <div className="text-foreground">{render(parse(text), onGuide)}</div>
}
