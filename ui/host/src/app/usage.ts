// Figures of usage: items and bytes include the ones in the trash, which count toward the quotas of the
// tenant until they are deleted for good (docs/architecture.md, "Quotas and usage").

import { fmtBytes } from '../api.ts'
import type { ResourceStat } from '../types.ts'
import { t } from './i18n.ts'

export function totals(res: ResourceStat[]) {
  return {
    count: res.reduce((s, r) => s + r.count, 0),
    bytes: res.reduce((s, r) => s + r.bytes, 0),
    trashCount: res.reduce((s, r) => s + (r.trash_count ?? 0), 0),
    trashBytes: res.reduce((s, r) => s + (r.trash_bytes ?? 0), 0),
  }
}

/** «of which in the trash: …», or nothing when the trash is empty. */
export function trashHint(n: number, what: 'items' | 'bytes'): string | undefined {
  if (!n) return undefined
  return t('of which in the trash: {n}', { n: what === 'bytes' ? fmtBytes(n) : String(n) })
}
