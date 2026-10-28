// The checks of docs/manual-tests.md (sections, ids and texts) and the consistency with tests/manual/checks:
// every id of the document has its automated twin and every automated check an id of the document.
//
//   node tests/manual/catalog.mjs        prints the differences and exits with 1 if there are any
//   (cargo xtask manual-tests --check runs it, and so does cargo xtask ci)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOC = path.resolve(HERE, '../../docs/manual-tests.md')
const CHECKS = path.join(HERE, 'checks')
const ID = /^\| ((?:P\d+b?|FU-[A-Z]|R2|[A-Z]{2,5})-\d+[a-z]?) \| (.*?) \| /

/** Strip the markdown of a cell into plain text. */
function plain(s) {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Sections of the document in order, each with its checks { id, text }. */
export function documentChecks(file = DOC) {
  const sections = []
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const h = line.match(/^## (.+)$/)
    if (h) {
      sections.push({ title: h[1].trim(), checks: [] })
      continue
    }
    const m = line.match(ID)
    if (m && sections.length) sections[sections.length - 1].checks.push({ id: m[1], text: plain(m[2]) })
  }
  return sections.filter((s) => s.checks.length)
}

/** Ids declared in the automated checks (`id: 'P3-12'`), with their file. */
export function automatedIds(dir = CHECKS) {
  const out = new Map()
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts')).sort()) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/^\s+id: '([^']+)',$/gm)) out.set(m[1], f)
  }
  return out
}

/** { missing: ids of the document without a check, extra: checks without an id in the document, duplicates }. */
export function consistency() {
  const doc = documentChecks().flatMap((s) => s.checks.map((c) => c.id))
  const auto = automatedIds()
  const seen = new Set()
  const duplicates = doc.filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
  return {
    total: doc.length,
    missing: doc.filter((id) => !auto.has(id)),
    extra: [...auto.keys()].filter((id) => !seen.has(id)),
    duplicates,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = consistency()
  const bad = r.missing.length + r.extra.length + r.duplicates.length
  console.log(`manual checks: ${r.total} in docs/manual-tests.md, ${r.total - r.missing.length} automated`)
  if (r.missing.length) console.log(`without an automated test (add it to tests/manual/checks): ${r.missing.join(' ')}`)
  if (r.extra.length) console.log(`automated but not in docs/manual-tests.md: ${r.extra.join(' ')}`)
  if (r.duplicates.length) console.log(`ids used twice in docs/manual-tests.md: ${r.duplicates.join(' ')}`)
  process.exit(bad ? 1 : 0)
}
