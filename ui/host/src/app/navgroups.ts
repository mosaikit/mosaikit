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
  /** subgroups: one level only */
  children?: NavGroupDef[]
}

export interface Grouped<T> {
  def: NavGroupDef
  label: string
  items: T[]
  /** the subgroups, drawn indented under the items of the group */
  children?: Grouped<T>[]
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
  const build = (list: NavGroupDef[] | undefined, depth: number): Grouped<T>[] => {
    const out: Grouped<T>[] = []
    for (const def of Array.isArray(list) ? list : []) {
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
      const children = depth === 0 ? build(def.children, 1) : []
      if (mine.length || children.length) out.push({ def, label: groupLabel(def, lang), items: mine, ...(children.length ? { children } : {}) })
    }
    return out
  }
  const groups = build(defs, 0)
  return { groups, rest: items.filter((i) => !i.plugin || !taken.has(i.plugin)) }
}

/** The items of a group and of its subgroups, in the order shown (the closed sidebar and the search show them flat). */
export function allItems<T>(g: { items: T[]; subgroups?: { items: T[]; subgroups?: unknown[] }[] }): T[] {
  return [...g.items, ...(g.subgroups ?? []).flatMap((c) => allItems(c as { items: T[] }))]
}

// ── editing the layout (Settings › Navigation): pure helpers, the editor only calls them ──

/** Moves the element `i` of a list by `by` places (never out of the list). */
export function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list
  const out = list.slice()
  const [x] = out.splice(i, 1)
  out.splice(j, 0, x)
  return out
}

/** A new group id from its name: lower case letters, digits and dashes, and a short suffix so two groups never collide. */
export function newGroupId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'group'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

/** The ids of every group and subgroup of a layout. */
export function groupIds(defs: NavGroupDef[]): Set<string> {
  return new Set(defs.flatMap((g) => [g.id, ...(g.children ?? []).map((c) => c.id)]))
}

/** The plugin ids a layout places somewhere (the others are «not in a group»). */
export function placed(defs: NavGroupDef[]): Set<string> {
  return new Set(defs.flatMap((g) => [...(g.plugins ?? []), ...(g.children ?? []).flatMap((c) => c.plugins ?? [])]))
}

/** Takes a plugin out of every group (before it goes into another one: an app is in one place only). */
export function unplace(defs: NavGroupDef[], plugin: string): NavGroupDef[] {
  const cut = (g: NavGroupDef): NavGroupDef => ({
    ...g,
    plugins: (g.plugins ?? []).filter((p) => p !== plugin),
    ...(g.children ? { children: g.children.map(cut) } : {}),
  })
  return defs.map(cut)
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
