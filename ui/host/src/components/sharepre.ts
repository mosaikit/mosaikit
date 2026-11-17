import type { PickOptions, SharePre } from '../ui-context.ts'

/** The people and groups a plugin asks the share dialog to start with: only what is well formed (at most 200). */
export function sharePre(args: Record<string, unknown> | undefined): SharePre | undefined {
  const list = args?.principals
  if (!Array.isArray(list)) return undefined
  const ok = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const principals: SharePre['principals'] = []
  for (const p of list.slice(0, 200)) {
    const r = p as { type?: unknown; id?: unknown; name?: unknown }
    // everybody in the tenant: no id (the platform knows the group)
    if (r.type === 'all') {
      principals.push({ type: 'all', id: 'all' })
      continue
    }
    if ((r.type !== 'user' && r.type !== 'group') || typeof r.id !== 'string' || !ok.test(r.id)) continue
    principals.push({ type: r.type, id: r.id, ...(typeof r.name === 'string' ? { name: r.name.slice(0, 100) } : {}) })
  }
  if (!principals.length) return undefined
  const level = args?.level === 'write' || args?.level === 'manage' ? args.level : 'read'
  return { principals, level }
}

/** What a plugin asks the picker of people and groups: only what is well formed. */
export function pickOptions(args: Record<string, unknown> | undefined): PickOptions {
  const ok = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const exclude: NonNullable<PickOptions['exclude']> = []
  if (Array.isArray(args?.exclude)) {
    for (const p of args.exclude.slice(0, 500)) {
      const r = p as { type?: unknown; id?: unknown }
      if ((r.type === 'user' || r.type === 'group') && typeof r.id === 'string' && ok.test(r.id)) exclude.push({ type: r.type, id: r.id })
    }
  }
  const kind = args?.kind === 'user' || args?.kind === 'group' ? args.kind : 'both'
  return {
    kind,
    exclude,
    multiple: args?.multiple !== false,
    ...(typeof args?.title === 'string' && args.title.trim() ? { title: args.title.trim().slice(0, 80) } : {}),
  }
}
