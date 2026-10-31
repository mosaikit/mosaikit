import { useEffect, useRef } from 'react'
import { checkPluginApi, errorReply, execute, OpError, routeOp, safePage, SHELL_API, themeVars } from '../bridge.ts'
import type { Session, TenantContext } from '../types.ts'
import { useUi } from '../ui-context.ts'

/** A tab of an extension open in the detail of an item of the plugin of a `PluginFrame`. */
export interface TabState {
  /** chosen by the host, given to the base plugin to place and close the tab */
  handle: string
  /** the extension */
  ext: string
  key: string
  label: string
  page: string
  /** where the UI of the extension is served (from the server; its own host with a wildcard plugin_url) */
  ui_url?: string
  /** the plugin it extends (the one of the frame), the resource and the item */
  base: string
  resource: string
  item: string
  level: 'read' | 'write' | 'manage'
  rect: { top: number; left: number; width: number; height: number }
  visible: boolean
}

interface Props {
  tab: TabState
  session: Session
  ctx: TenantContext
  reloadKey: number
  /** context of the shell (language, theme, mode, contrast), as for the plugin */
  context: () => Record<string, unknown>
  uiKey: string
  /** sends an event to the frame of the base plugin */
  toBase: (event: string, data: unknown) => void
}

/**
 * The page of the extension, drawn by the host over the place the base plugin keeps for it. Its frame
 * has no origin of its own (sandbox without allow-same-origin): neither the base plugin nor the
 * extension can reach into the other. The bridge accepts only this frame and limits it to the
 * extension and to this one item.
 */
export default function ExtensionTab({ tab, session, ctx, reloadKey, context, uiKey, toBase }: Props) {
  const ref = useRef<HTMLIFrameElement>(null)
  const ui = useUi()
  const tenant = ctx.tenant.slug
  const src = `${tab.ui_url ?? session.plugin_url ?? session.plugin_origin}/ui/${encodeURIComponent(tab.ext)}/${safePage(tab.page)}?host=${encodeURIComponent(window.location.origin)}&v=${reloadKey}`

  // the frame has an opaque origin ("null"): the messages go to the window, whatever its origin
  const post = (msg: unknown) => ref.current?.contentWindow?.postMessage(msg, '*')

  const ctxRef = useRef(context)
  useEffect(() => {
    ctxRef.current = context
  })
  useEffect(() => {
    const c = ctxRef.current()
    post({ msk: 1, event: 'context', data: c })
    post({ msk: 1, event: 'theme', data: c.theme })
  }, [uiKey])

  useEffect(() => {
    const onMessage = async (ev: MessageEvent) => {
      const win = ref.current?.contentWindow
      if (!win || ev.source !== win || ev.origin !== 'null') return
      const m = ev.data as { msk?: number; id?: unknown; op?: unknown; args?: Record<string, unknown> }
      if (!m || m.msk !== 1 || typeof m.id !== 'string' || typeof m.op !== 'string') return
      const reply = (x: { ok?: unknown; err?: string; code?: string; status?: number; message?: string }) =>
        win.postMessage({ msk: 1, id: m.id, ...x }, '*')
      const on = { resource: tab.resource, id: tab.item, extension: tab.ext }
      try {
        switch (m.op) {
          case 'hello': {
            checkPluginApi(m.args)
            const p = ctx.plugins.find((x) => x.id === tab.ext)
            reply({
              ok: {
                api: SHELL_API,
                public: false,
                user: { id: session.user.user_id, username: session.user.username, name: session.user.display_name || session.user.username },
                tenant: { slug: ctx.tenant.slug, name: ctx.tenant.name, role: ctx.tenant.role },
                plugin: { id: tab.ext, version: p?.version ?? '' },
                theme: themeVars(),
                context: ctxRef.current(),
                ...(ctx.perms ? { perms: ctx.perms[tab.ext] ?? [] } : {}),
                tab: { base: tab.base, resource: tab.resource, item: tab.item, key: tab.key, level: tab.level },
              },
            })
            return
          }
          case 'toast':
            ui.toast(String(m.args?.text ?? '').slice(0, 300), m.args?.error === true)
            reply({ ok: null })
            return
          case 'confirm':
            reply({ ok: await ui.confirm(String(m.args?.text ?? '').slice(0, 500), true) })
            return
          // the item and the values of this extension on it, through the routes of the base plugin: the
          // kernel checks the level of the person on the item and that the extension is on for them
          case 'tab.item':
            reply({ ok: await execute(routeOp(tenant, tab.base, 'crud.get', { resource: tab.resource, id: tab.item })) })
            return
          case 'tab.values': {
            const all = (await execute(routeOp(tenant, tab.base, 'ext.values', { resource: tab.resource, ids: [tab.item] }))) as Record<string, Record<string, unknown>>
            reply({ ok: all?.[tab.item]?.[tab.ext] ?? {} })
            return
          }
          case 'tab.set': {
            const ok = await execute(routeOp(tenant, tab.base, 'ext.set', { ...on, values: m.args?.values }))
            toBase('ext.changed', { extension: tab.ext, id: tab.item })
            reply({ ok })
            return
          }
          case 'tab.action': {
            const ok = await execute(routeOp(tenant, tab.base, 'ext.action', { ...on, action: m.args?.action }))
            toBase('ext.changed', { extension: tab.ext, id: tab.item })
            reply({ ok })
            return
          }
          case 'tab.resize': {
            const height = Number(m.args?.height)
            if (!Number.isFinite(height)) throw new OpError('invalid height')
            toBase('ext.tab.height', { handle: tab.handle, height: Math.min(Math.max(Math.round(height), 80), 4000) })
            reply({ ok: null })
            return
          }
          // everything else is an operation of the extension itself (its resources, its commands)
          default:
            reply({ ok: await execute(routeOp(tenant, tab.ext, m.op, m.args)) })
        }
      } catch (e) {
        reply(errorReply(e))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [tab, tenant, session, ctx, ui, toBase])

  const r = tab.rect
  return (
    <iframe
      key={src}
      ref={ref}
      className="ext-tab-frame"
      title={tab.label}
      src={src}
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      style={{
        position: 'absolute',
        top: r.top,
        left: r.left,
        width: Math.max(r.width, 0),
        height: Math.max(r.height, 0),
        border: 0,
        display: tab.visible && r.width > 0 && r.height > 0 ? 'block' : 'none',
      }}
    />
  )
}
