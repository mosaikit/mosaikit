// Rows of a CSV file of people (Manage › Import from CSV): reading and the checks done before sending.

import { t } from './i18n.ts'

export interface ImportRow {
  username: string
  display_name: string
  email: string
  role: 'user' | 'tenant_manager'
  profile: string
  groups: string[]
  /** problem found before sending, if any */
  problem?: string
}

/** One line of CSV in fields: commas or semicolons, quotes with "" inside. */
export function csvFields(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

const COLUMNS: Record<string, keyof ImportRow> = {
  username: 'username',
  user: 'username',
  name: 'display_name',
  display_name: 'display_name',
  email: 'email',
  role: 'role',
  profile: 'profile',
  groups: 'groups',
}

/** The rows of a CSV file with a header (username, name, email, role, profile, groups — groups separated by
 *  «|»), each with the problem found, if any. */
export function parseCsv(text: string): ImportRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const sep = lines[0].split(';').length > lines[0].split(',').length ? ';' : ','
  const head = csvFields(lines[0], sep).map((h) => COLUMNS[h.toLowerCase().replace(/\s+/g, '_')])
  const seen = new Set<string>()
  return lines.slice(1).map((line) => {
    const f = csvFields(line, sep)
    const r: ImportRow = { username: '', display_name: '', email: '', role: 'user', profile: '', groups: [] }
    head.forEach((k, i) => {
      const v = f[i] ?? ''
      if (k === 'groups') r.groups = v.split('|').map((g) => g.trim()).filter(Boolean)
      else if (k === 'role') r.role = /manager/i.test(v) ? 'tenant_manager' : 'user'
      else if (k) (r[k] as string) = v
    })
    r.username = r.username.toLowerCase()
    if (!/^[a-z0-9._-]{2,64}$/.test(r.username)) r.problem = t('Invalid username')
    else if (seen.has(r.username)) r.problem = t('Twice in the file')
    else if (!r.email) r.problem = t('Email required')
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) r.problem = t('Invalid email address')
    seen.add(r.username)
    return r
  })
}
