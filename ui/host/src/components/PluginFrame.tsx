import { useEffect, useRef, useState } from 'react'
import { errText } from '../api.ts'
import { execute, routeOp, themeVars, uuid } from '../bridge.ts'
import type { PluginView, Session, TenantContext } from '../types.ts'
import { useUi } from '../ui-context.ts'
import { t } from '../app/i18n.ts'

interface Props {
  plugin: PluginView
  session: Session
  ctx: TenantContext
  /** changes to force the reload (hot reload in development) */
  reloadKey: number
  /** language and theme of the shell: at the handshake and, at every change, with the `context` event */
  ui?: { lang: string; preset: string; mode: 'light' | 'dark'; preference: 'light' | 'dark' | 'auto' }
  /** the place inside the plugin to open (from a notification), given at the handshake */
  at?: string
}

/** Language, theme and mode to pass to the plugin (without `ui`, the ones of the page). */
function uiContext(ui: Props['ui']) {
  const root = document.documentElement
  const dark = root.classList.contains('dark') || root.dataset.theme === 'dark'
  return {
    lang: ui?.lang ?? (root.lang || 'it'),
    preset: ui?.preset ?? (root.dataset.preset || 'mosaikit'),
    mode: ui?.mode ?? (dark ? 'dark' : 'light'),
    preference: ui?.preference ?? (dark ? 'dark' : 'light'),
    theme: themeVars(),
  }
}

/**
 * Iframe of the UI of the plugin (separate origin, sandbox) and host side of the bridge.
 * It accepts messages only from the current iframe and from the origin of the plugins.
 */
export default function PluginFrame({ plugin, session, ctx, reloadKey, ui: shell, at }: Props) {
  const ref = useRef<HTMLIFrameElement>(null)
  const ui = useUi()
  const [loaded, setLoaded] = useState(false)
  const origin = session.plugin_origin
  const tenant = ctx.tenant.slug
  const src = `${session.plugin_url ?? origin}/ui/${encodeURIComponent(plugin.id)}/?host=${encodeURIComponent(window.location.origin)}&v=${reloadKey}`

  useEffect(() => {
    setLoaded(false)
  }, [src])

  // at every change of language, theme or mode the plugin receives the new context (and the theme only, for
  // the plugins written before the `context` event)
  const shellRef = useRef(shell)
  useEffect(() => {
    shellRef.current = shell
  })
  const uiKey = shell ? `${shell.lang}|${shell.preset}|${shell.mode}|${shell.preference}` : ''
  useEffect(() => {
    const win = ref.current?.contentWindow
    if (!win || !loaded) return
    const c = uiContext(shellRef.current)
    win.postMessage({ msk: 1, event: 'context', data: c }, origin)
    win.postMessage({ msk: 1, event: 'theme', data: c.theme }, origin)
  }, [uiKey, loaded, origin])

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
                context: uiContext(shellRef.current),
                ...(at ? { at: at.slice(0, 200) } : {}),
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
  }, [origin, tenant, plugin.id, plugin.version, session, ctx, ui, at])

  if (!plugin.has_ui) {
    return (
      <div className="empty">
        <p>{t('The plugin {label} has no interface.', { label: plugin.label })}</p>
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
      {!loaded && <div className="frame-msg">{t('Loading {label}…', { label: plugin.label })}</div>}
    </div>
  )
}
