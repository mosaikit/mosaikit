import { useEffect, useRef, useState } from 'react'
import { errText } from '../api.ts'
import { execute, routeOp, themeVars, uuid } from '../bridge.ts'
import type { PluginView, Session, TenantContext } from '../types.ts'
import { useUi } from '../ui-context.ts'

interface Props {
  plugin: PluginView
  session: Session
  ctx: TenantContext
  /** cambia per forzare il ricaricamento (hot reload in sviluppo) */
  reloadKey: number
}

/**
 * Iframe della UI del plugin (origine separata, sandbox) e lato host del bridge.
 * Accetta messaggi solo dall'iframe corrente e dall'origine dei plugin.
 */
export default function PluginFrame({ plugin, session, ctx, reloadKey }: Props) {
  const ref = useRef<HTMLIFrameElement>(null)
  const ui = useUi()
  const [loaded, setLoaded] = useState(false)
  const origin = session.plugin_origin
  const tenant = ctx.tenant.slug
  const src = `${session.plugin_url ?? origin}/ui/${encodeURIComponent(plugin.id)}/?host=${encodeURIComponent(window.location.origin)}&v=${reloadKey}`

  useEffect(() => {
    setLoaded(false)
  }, [src])

  useEffect(() => {
    const onMessage = async (ev: MessageEvent) => {
      const win = ref.current?.contentWindow
      if (!win || ev.source !== win || ev.origin !== origin) return
      const m = ev.data as { msk?: number; id?: unknown; op?: unknown; args?: Record<string, unknown> }
      if (!m || m.msk !== 1 || typeof m.id !== 'string' || typeof m.op !== 'string') return
      const reply = (x: { ok?: unknown; err?: string }) => win.postMessage({ msk: 1, id: m.id, ...x }, origin)
      try {
        switch (m.op) {
          case 'hello':
            reply({
              ok: {
                public: false,
                user: { id: session.user.user_id, username: session.user.username, name: session.user.display_name || session.user.username },
                tenant: { slug: ctx.tenant.slug, name: ctx.tenant.name, role: ctx.tenant.role },
                plugin: { id: plugin.id, version: plugin.version },
                theme: themeVars(),
              },
            })
            return
          case 'share':
            await ui.share(uuid(m.args?.id))
            reply({ ok: null })
            return
          case 'toast':
            ui.toast(String(m.args?.text ?? '').slice(0, 300), m.args?.error === true)
            reply({ ok: null })
            return
          case 'confirm':
            reply({ ok: await ui.confirm(String(m.args?.text ?? '').slice(0, 500), true) })
            return
          default:
            reply({ ok: await execute(routeOp(tenant, plugin.id, m.op, m.args)) })
        }
      } catch (e) {
        reply({ err: errText(e) })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin, tenant, plugin.id, plugin.version, session, ctx, ui])

  if (!plugin.has_ui) {
    return (
      <div className="empty">
        <p>Il plugin {plugin.label} non ha un'interfaccia.</p>
      </div>
    )
  }

  return (
    <div className="frame-wrap">
      <iframe
        key={src}
        ref={ref}
        className="plugin-frame"
        title={plugin.label}
        src={src}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
        allow="fullscreen; geolocation; clipboard-write"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
      />
      {!loaded && <div className="frame-msg">caricamento di {plugin.label}…</div>}
    </div>
  )
}
