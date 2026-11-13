import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { channelName, checkPluginApi, errorReply, execute, OpError, routeOp, safePage, SHELL_API, themeVars, uuid } from '../bridge.ts'
import type { PluginView, Session, TenantContext } from '../types.ts'
import { appUrl, enc } from '../api.ts'
import { useUi } from '../ui-context.ts'
import { pageTextsFor, t } from '../app/i18n.ts'
import { timed } from '../app/devlog.ts'
import { NAV_RESELECT, resetBand, sanitizeBand, setBand } from '../app/contextband.ts'
import ExtensionTab, { type TabState } from './ExtensionTab.tsx'

const IDENT = /^[a-z][a-z0-9_]{0,47}$/
const EXT_ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
/** a place inside a plugin (`msk.at`): the same characters the kernel lets a notification carry */
const PLACE = /^[A-Za-z0-9/_\-.=&?%:]{1,200}$/
/** at most this many tabs of extensions open at a time in a frame (the oldest closes) */
const MAX_TABS = 4

function rectArg(v: unknown): TabState['rect'] {
  const r = (v ?? {}) as Record<string, unknown>
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0)
  return { top: n(r.top), left: n(r.left), width: Math.max(n(r.width), 0), height: Math.max(n(r.height), 0) }
}

interface Props {
  plugin: PluginView
  session: Session
  ctx: TenantContext
  /** changes to force the reload (hot reload in development) */
  reloadKey: number
  /** language and theme of the shell: at the handshake and, at every change, with the `context` event */
  ui?: { lang: string; preset: string; mode: 'light' | 'dark'; preference: 'light' | 'dark' | 'auto'; contrast?: boolean }
  /** the place inside the plugin to open (from a notification), given at the handshake */
  at?: string
}

/** Language, theme and mode to pass to the plugin (without `ui`, the ones of the page). With `pluginId`, also the texts
 *  of its page in the language, when a language plugin brings them (`texts`, read by `msk.t`). */
function uiContext(ui: Props['ui'], pluginId?: string) {
  const root = document.documentElement
  const dark = root.classList.contains('dark') || root.dataset.theme === 'dark'
  const lang = ui?.lang ?? (root.lang || 'it')
  const texts = pluginId ? pageTextsFor(lang, pluginId) : undefined
  return {
    lang,
    ...(texts ? { texts } : {}),
    preset: ui?.preset ?? (root.dataset.preset || 'mosaikit'),
    mode: ui?.mode ?? (dark ? 'dark' : 'light'),
    preference: ui?.preference ?? (dark ? 'dark' : 'light'),
    contrast: ui?.contrast ?? root.dataset.contrast === 'more',
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
  // the tabs of extensions open in the detail of an item of this plugin (drawn by the host, see ExtensionTab)
  const [tabs, setTabs] = useState<TabState[]>([])
  // with a wildcard plugin_url every plugin UI has a host (an origin) of its own: the server says which
  const base = plugin.ui_url ?? session.plugin_url ?? session.plugin_origin
  const origin = new URL(base).origin
  const tenant = ctx.tenant.slug
  const src = `${base}/ui/${encodeURIComponent(plugin.id)}/?host=${encodeURIComponent(window.location.origin)}&v=${reloadKey}`

  useEffect(() => {
    setLoaded(false)
    setTabs([])
  }, [src])

  // the contextual top band belongs to this frame: it goes when the frame goes (the page closes, another plugin
  // opens) and when a new document of the plugin starts (its `hello`)
  const [owner] = useState(() => crypto.randomUUID())
  useEffect(() => () => resetBand(owner), [src, owner])

  /** An event for the page of the plugin (from a tab of an extension: its height, changed values). */
  const toBase = useCallback(
    (event: string, data: unknown) => ref.current?.contentWindow?.postMessage({ msk: 1, event, data }, origin),
    [origin],
  )

  // real-time channels the page opened (`msk.realtime`): one EventSource each, closed with the page or the document
  const streams = useRef(new Map<string, EventSource>())
  const closeStreams = useCallback(() => {
    for (const es of streams.current.values()) es.close()
    streams.current.clear()
  }, [])
  useEffect(() => closeStreams, [src, closeStreams])

  /** Opens the stream of a channel and relays what arrives to the page. The browser reconnects by itself (with `Last-Event-ID`). */
  const openStream = useCallback(
    (handle: string, resource: string, name: string, state: unknown) => {
      if (streams.current.has(handle) || streams.current.size >= 8) throw new OpError('too many channels')
      const q = JSON.stringify(state ?? {})
      if (q.length > 1024) throw new OpError('the state is too large', 'rt_too_large')
      const url = appUrl(`/api/t/${enc(tenant)}/p/${enc(plugin.id)}/rt/${resource}/${name}/stream?state=${encodeURIComponent(q)}`)
      const es = new EventSource(url)
      streams.current.set(handle, es)
      const status = (v: string) => toBase('rt.event', { handle, type: 'status', data: { status: v } })
      es.onopen = () => status('live')
      es.onerror = () => {
        // a refused channel (403, 404) is final: the browser would retry for ever
        status(es.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting')
      }
      for (const type of ['presence', 'message', 'join', 'leave', 'state'] as const)
        es.addEventListener(type, (e) => {
          try {
            toBase('rt.event', { handle, type, data: JSON.parse((e as MessageEvent<string>).data) })
          } catch {
            /* a frame that is not JSON is dropped */
          }
        })
      es.addEventListener('gap', () => status('gap'))
      es.addEventListener('closed', () => {
        es.close()
        streams.current.delete(handle)
        status('closed')
      })
    },
    [plugin.id, tenant, toBase],
  )

  // the person clicked again the entry of the open page in the sidebar: the plugin may go back to its list
  useEffect(() => {
    const on = () => toBase('nav.reselect', {})
    window.addEventListener(NAV_RESELECT, on)
    return () => window.removeEventListener(NAV_RESELECT, on)
  }, [toBase])

  // at every change of language, theme or mode the plugin receives the new context (and the theme only, for
  // the plugins written before the `context` event)
  const shellRef = useRef(shell)
  useEffect(() => {
    shellRef.current = shell
  })
  const uiKey = shell ? `${shell.lang}|${shell.preset}|${shell.mode}|${shell.preference}|${shell.contrast ? 1 : 0}` : ''
  useEffect(() => {
    const win = ref.current?.contentWindow
    if (!win || !loaded) return
    const c = uiContext(shellRef.current, plugin.id)
    win.postMessage({ msk: 1, event: 'context', data: c }, origin)
    win.postMessage({ msk: 1, event: 'theme', data: c.theme }, origin)
  }, [uiKey, loaded, origin, plugin.id])

  useEffect(() => {
    const onMessage = async (ev: MessageEvent) => {
      const win = ref.current?.contentWindow
      if (!win || ev.source !== win || ev.origin !== origin) return
      const m = ev.data as { msk?: number; id?: unknown; op?: unknown; args?: Record<string, unknown> }
      if (!m || m.msk !== 1 || typeof m.id !== 'string' || typeof m.op !== 'string') return
      const reply = (x: { ok?: unknown; err?: string; code?: string; status?: number; message?: string }) =>
        win.postMessage({ msk: 1, id: m.id, ...x }, origin)
      try {
        switch (m.op) {
          case 'hello':
            checkPluginApi(m.args)
            // every document of the plugin starts with `hello`: the band and the channels of the page it replaces go
            resetBand(owner)
            closeStreams()
            reply({
              ok: {
                api: SHELL_API,
                public: false,
                user: { id: session.user.user_id, username: session.user.username, name: session.user.display_name || session.user.username },
                tenant: { slug: ctx.tenant.slug, name: ctx.tenant.name, role: ctx.tenant.role },
                plugin: { id: plugin.id, version: plugin.version },
                theme: themeVars(),
                context: uiContext(shellRef.current, plugin.id),
                ...(ctx.perms ? { perms: ctx.perms[plugin.id] ?? [] } : {}),
                ...(at ? { at: at.slice(0, 200) } : {}),
              },
            })
            return
          case 'share':
            await ui.share(uuid(m.args?.id))
            reply({ ok: null })
            return
          // the band of the shell for a resource on the full page: validated, plain text only; the callbacks come back as events
          case 'band.set':
            setBand(owner, sanitizeBand(m.args), toBase)
            reply({ ok: null })
            return
          case 'band.reset':
            resetBand(owner)
            reply({ ok: null })
            return
          // real-time channels: the stream is opened here (the page has no origin to open it from), sending goes through `routeOp`
          case 'rt.open': {
            const handle = String(m.args?.handle ?? '')
            if (!/^[0-9a-f-]{36}$/i.test(handle)) throw new OpError('invalid handle')
            openStream(handle, uuid(m.args?.resource, 'resource'), channelName(m.args?.name), m.args?.state)
            reply({ ok: null })
            return
          }
          case 'rt.close': {
            const handle = String(m.args?.handle ?? '')
            streams.current.get(handle)?.close()
            streams.current.delete(handle)
            reply({ ok: null })
            return
          }
          // the page of another plugin of the tenant, at a place inside it: only plugins the person has in the sidebar
          case 'nav.open': {
            const target = String(m.args?.plugin ?? '')
            const place = m.args?.at === undefined || m.args?.at === null ? '' : String(m.args.at)
            if (!EXT_ID.test(target) || (place && !PLACE.test(place))) throw new OpError('invalid page')
            if (!ctx.plugins.some((x) => x.id === target)) throw new OpError('plugin not available', 'not_found')
            ui.open(target, place || undefined)
            reply({ ok: null })
            return
          }
          case 'toast':
            ui.toast(String(m.args?.text ?? '').slice(0, 300), m.args?.error === true)
            reply({ ok: null })
            return
          case 'confirm':
            reply({ ok: await ui.confirm(String(m.args?.text ?? '').slice(0, 500), true) })
            return
          // a tab of an extension in the detail of an item: the host checks that the extension offers it to
          // this person and that the item is visible to them, then draws the page of the extension over `rect`
          case 'ext.tab.open': {
            const a = m.args ?? {}
            const resource = String(a.resource ?? '')
            const ext = String(a.extension ?? '')
            const key = String(a.tab ?? '')
            if (!IDENT.test(resource) || !EXT_ID.test(ext) || !IDENT.test(key)) throw new OpError('invalid tab')
            const item = uuid(a.id)
            const list = (await execute(routeOp(tenant, plugin.id, 'ext.list', { resource }))) as {
              id: string
              tabs?: { key: string; label: string; page: string; ui_url?: string }[]
            }[]
            const decl = list.find((e) => e.id === ext)?.tabs?.find((x) => x.key === key)
            if (!decl) throw new OpError('this tab is not available')
            const row = (await execute(routeOp(tenant, plugin.id, 'crud.get', { resource, id: item }))) as { my_level?: TabState['level'] }
            const tab: TabState = {
              handle: crypto.randomUUID(),
              ext,
              key,
              label: decl.label,
              page: safePage(decl.page),
              ui_url: decl.ui_url,
              base: plugin.id,
              resource,
              item,
              level: row.my_level ?? 'read',
              rect: rectArg(a.rect),
              visible: true,
            }
            setTabs((cur) => [...cur, tab].slice(-MAX_TABS))
            reply({ ok: { handle: tab.handle } })
            return
          }
          case 'ext.tab.place': {
            const handle = String(m.args?.handle ?? '')
            const rect = rectArg(m.args?.rect)
            const visible = m.args?.visible !== false
            setTabs((cur) => cur.map((x) => (x.handle === handle ? { ...x, rect, visible } : x)))
            reply({ ok: null })
            return
          }
          case 'ext.tab.close': {
            const handle = String(m.args?.handle ?? '')
            setTabs((cur) => cur.filter((x) => x.handle !== handle))
            reply({ ok: null })
            return
          }
          default:
            // in the developer profile the call is timed for the developer tools (devlog.ts); otherwise it is just made
            {
              const op = m.op
              reply({ ok: await timed(plugin.id, op, () => execute(routeOp(tenant, plugin.id, op, m.args))) })
            }
        }
      } catch (e) {
        // a plugin built for a newer API than the shell speaks: the person is told (the plugin may also react)
        if (e instanceof OpError && e.code === 'incompatible_api') ui.toast(t('This plugin was built for a newer plugin API than this Mosaikit speaks. Ask the Administrator to update Mosaikit.'), true)
        reply(errorReply(e))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin, tenant, plugin.id, plugin.version, session, ctx, ui, at, toBase, owner, openStream, closeStreams])

  if (!plugin.has_ui) {
    return (
      <div className="empty">
        <p>{t('The plugin {label} has no interface.', { label: plugin.label })}</p>
      </div>
    )
  }

  return (
    <div className="frame-wrap" style={{ overflow: 'hidden' }}>
      <iframe
        key={src}
        ref={ref}
        className="plugin-frame"
        title={plugin.label}
        src={src}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
        allow={plugin.permissions.media ? 'fullscreen; geolocation; clipboard-write; camera; microphone; display-capture' : 'fullscreen; geolocation; clipboard-write'}
        referrerPolicy="no-referrer"
        onLoad={() => {
          setLoaded(true)
          // a new page of the plugin: its tabs went with the old one
          setTabs([])
        }}
      />
      {tabs.map((tab) => (
        <ExtensionTab key={tab.handle} tab={tab} session={session} ctx={ctx} reloadKey={reloadKey} context={(id) => uiContext(shellRef.current, id)} uiKey={uiKey} toBase={toBase} />
      ))}
      {!loaded && (
        <div className="frame-msg" role="status" data-testid="frame-loading">
          <span className="flex items-center gap-2">
            <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
            {t('Loading {label}…', { label: plugin.label })}
          </span>
        </div>
      )}
    </div>
  )
}
