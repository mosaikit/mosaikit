// Groups of the sidebar declared by a distribution (`[[nav_groups]]` of its distribution.toml, sent by the
// server with the brand). Pure logic: which apps go in which group, in which order, with which label. The
// kernel already validated the groups; this code stays defensive because an older or a hand-made server may
// send anything (unknown plugin, duplicate, empty group: ignored, never a crash).

export interface NavGroupDef {
  id: string
  label: string
  /** Lucide name of the icon (unknown: a default icon) */
  icon?: string | null
  plugins: string[]
  i18n?: Record<string, { label?: string | null }>
}

export interface Grouped<T> {
  def: NavGroupDef
  label: string
  items: T[]
}

/** The label in the language of the person, else the declared one. */
export function groupLabel(def: NavGroupDef, lang: string): string {
  return def.i18n?.[lang]?.label?.trim() || def.label?.trim() || def.id
}

/** Splits `items` (apps, each with its plugin id) in the declared groups: order of the `plugins` list, first
 *  group wins for a plugin listed twice, plugins that are not there (unknown, hidden) are ignored, empty
 *  groups are dropped. `rest` is what no group lists, in its own order. */
export function splitApps<T extends { plugin?: string }>(items: T[], defs: NavGroupDef[] | undefined, lang: string): { groups: Grouped<T>[]; rest: T[] } {
  const byPlugin = new Map(items.filter((i) => i.plugin).map((i) => [i.plugin!, i]))
  const taken = new Set<string>()
  const seen = new Set<string>()
  const groups: Grouped<T>[] = []
  for (const def of Array.isArray(defs) ? defs : []) {
    if (!def || typeof def.id !== 'string' || !def.id || seen.has(def.id)) continue
    seen.add(def.id)
    const mine: T[] = []
    for (const p of Array.isArray(def.plugins) ? def.plugins : []) {
      const it = byPlugin.get(p)
      if (it && !taken.has(p)) {
        taken.add(p)
        mine.push(it)
      }
    }
    if (mine.length) groups.push({ def, label: groupLabel(def, lang), items: mine })
  }
  return { groups, rest: items.filter((i) => !i.plugin || !taken.has(i.plugin)) }
}

/** The icon drawn when a group declares none or a name the shell does not know. */
export const DEFAULT_GROUP_ICON = 'folder'

/** Moves the focus among the entries of a group with the arrow keys (Home and End too). `entries` are the
 *  focusable elements in order; returns the index to focus, or null when the key is not for us. */
export function arrowTarget(key: string, current: number, count: number): number | null {
  if (!count) return null
  if (key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowUp') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}
