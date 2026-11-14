import type { SharePre } from '../ui-context.ts'

/** The people and groups a plugin asks the share dialog to start with: only what is well formed (at most 200). */
export function sharePre(args: Record<string, unknown> | undefined): SharePre | undefined {
  const list = args?.principals
  if (!Array.isArray(list)) return undefined
  const ok = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const principals: SharePre['principals'] = []
  for (const p of list.slice(0, 200)) {
    const r = p as { type?: unknown; id?: unknown; name?: unknown }
    if ((r.type !== 'user' && r.type !== 'group') || typeof r.id !== 'string' || !ok.test(r.id)) continue
    principals.push({ type: r.type, id: r.id, ...(typeof r.name === 'string' ? { name: r.name.slice(0, 100) } : {}) })
  }
  if (!principals.length) return undefined
  const level = args?.level === 'write' || args?.level === 'manage' ? args.level : 'read'
  return { principals, level }
}
