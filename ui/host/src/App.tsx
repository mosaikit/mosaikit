import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, appUrl, errText, setCsrf, setUnauthorizedHandler } from './api.ts'
import type { Session, TenantContext } from './types.ts'
import { ConfirmDialog, Toasts, type ConfirmRequest, type Toast } from './ui.tsx'
import { UiContext, type Ui } from './ui-context.ts'
import Login from './components/Login.tsx'
import Rail, { type View } from './components/Rail.tsx'
import StatusBar from './components/StatusBar.tsx'
import PluginFrame from './components/PluginFrame.tsx'
import ShareDialog from './components/ShareDialog.tsx'
import ManageConsole from './components/ManageConsole.tsx'
import AdminConsole from './components/AdminConsole.tsx'
import Account from './components/Account.tsx'
import Overview, { SystemOverviewPage } from './components/Overview.tsx'

const LAST_TENANT = 'msk_tenant'

/** `#/t/<tenant>/<vista>[/<plugin>]` */
function parseHash(): { tenant?: string; view: View } {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)
  if (parts[0] !== 't' || !parts[1]) return { view: { kind: 'home' } }
  const tenant = parts[1]
  switch (parts[2]) {
    case 'p':
      return parts[3] ? { tenant, view: { kind: 'plugin', id: parts[3] } } : { tenant, view: { kind: 'home' } }
    case 'manage':
      return { tenant, view: { kind: 'manage' } }
    case 'admin':
      return { tenant, view: { kind: 'admin' } }
    case 'account':
      return { tenant, view: { kind: 'account' } }
    default:
      return { tenant, view: { kind: 'home' } }
  }
}

function toHash(tenant: string, v: View): string {
  const t = `#/t/${encodeURIComponent(tenant)}`
  return v.kind === 'plugin' ? `${t}/p/${encodeURIComponent(v.id)}` : v.kind === 'home' ? t : `${t}/${v.kind}`
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  const loadSession = useCallback(async () => {
    try {
      const s = await api<Session>('GET', '/api/session')
      setCsrf(s.csrf)
      setSession(s)
    } catch {
      setSession(null)
    }
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null))
    void loadSession()
  }, [loadSession])

  if (session === undefined) return <div className="empty">caricamento…</div>
  if (session === null)
    return (
      <Login
        onLogin={(s) => {
          setCsrf(s.csrf)
          setSession(s)
        }}
      />
    )
  // l'Administrator e' un account di piattaforma: nessuno spazio di lavoro, solo amministrazione
  if (session.user.is_system_admin) return <AdminShell session={session} reloadSession={loadSession} onLogout={() => setSession(null)} />
  return <Shell session={session} reloadSession={loadSession} onLogout={() => setSession(null)} />
}

async function signOut(onLogout: () => void) {
  try {
    await api('POST', '/api/auth/logout')
  } catch {
    /* sessione gia' chiusa */
  }
  onLogout()
}

interface ShareReq {
  id: string
  done: () => void
}

/**
 * Toast, conferme e richieste di condivisione: il contesto `Ui`, gli elementi da mostrare
 * sopra la pagina e la condivisione in corso (il dialogo, che richiede il tenant, lo mostra `Shell`).
 */
function useUiHost(): { ui: Ui; overlays: ReactNode; share: ShareReq | null; closeShare: () => void } {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)
  const [share, setShare] = useState<ShareReq | null>(null)
  const toastSeq = useRef(0)
  const ui: Ui = useMemo(
    () => ({
      toast: (text, error = false) => {
        const id = ++toastSeq.current
        setToasts((t) => [...t.slice(-4), { id, text, error }])
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6000 : 3500)
      },
      confirm: (message, danger = false) => new Promise<boolean>((resolve) => setConfirmReq({ message, danger, resolve })),
      share: (id) => new Promise<void>((resolve) => setShare({ id, done: resolve })),
    }),
    [],
  )
  const overlays = (
    <>
      <Toasts items={toasts} />
      <ConfirmDialog
        request={confirmReq}
        onResolve={(v) => {
          confirmReq?.resolve(v)
          setConfirmReq(null)
        }}
      />
    </>
  )
  return { ui, overlays, share, closeShare: () => setShare(null) }
}

type AdminView = 'home' | 'console' | 'account'

/** `#/admin`, `#/admin/console`, `#/admin/account` */
function parseAdminHash(): AdminView {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/')
  return parts[0] === 'admin' && (parts[1] === 'console' || parts[1] === 'account') ? parts[1] : 'home'
}

function AdminShell({ session, reloadSession, onLogout }: { session: Session; reloadSession: () => Promise<void>; onLogout: () => void }) {
  const [view, setView] = useState<AdminView>(parseAdminHash)
  const { ui, overlays } = useUiHost()
  useEffect(() => {
    const h = view === 'home' ? '#/admin' : `#/admin/${view}`
    if (window.location.hash !== h) window.history.replaceState(null, '', h)
  }, [view])
  const railView: View = view === 'console' ? { kind: 'admin' } : view === 'account' ? { kind: 'account' } : { kind: 'home' }
  let main
  if (view === 'console') main = <AdminConsole session={session} onPluginsChanged={() => {}} />
  else if (view === 'account') main = <Account session={session} onChanged={() => void reloadSession()} />
  else main = <SystemOverviewPage session={session} onAdmin={() => setView('console')} />
  return (
    <UiContext.Provider value={ui}>
      <div className="shell">
        <Rail
          plugins={[]}
          view={railView}
          isManager={false}
          isAdmin
          invitations={0}
          onSelect={(v) => setView(v.kind === 'admin' ? 'console' : v.kind === 'account' ? 'account' : 'home')}
        />
        <main className="main">{main}</main>
        <StatusBar user={session.user} memberships={[]} tenant="" dev={session.dev} onTenant={() => {}} onLogout={() => void signOut(onLogout)} />
      </div>
      {overlays}
    </UiContext.Provider>
  )
}

function Shell({ session, reloadSession, onLogout }: { session: Session; reloadSession: () => Promise<void>; onLogout: () => void }) {
  const initial = useMemo(() => parseHash(), [])
  const pickTenant = (wanted?: string) => {
    const slugs = session.memberships.map((m) => m.slug)
    let last = ''
    try {
      last = localStorage.getItem(LAST_TENANT) ?? ''
    } catch {
      /* storage non disponibile */
    }
    return [wanted, last, session.user.home_tenant_slug].find((s) => s && slugs.includes(s)) ?? slugs[0] ?? session.user.home_tenant_slug
  }
  const [tenant, setTenant] = useState(() => pickTenant(initial.tenant))
  const [view, setView] = useState<View>(initial.view)
  const [ctx, setCtx] = useState<TenantContext | null>(null)
  const [ctxError, setCtxError] = useState('')
  const [reloads, setReloads] = useState<Record<string, number>>({})
  const { ui, overlays, share, closeShare } = useUiHost()

  const loadCtx = useCallback(async () => {
    try {
      setCtx(await api<TenantContext>('GET', `/api/t/${encodeURIComponent(tenant)}/context`))
      setCtxError('')
    } catch (e) {
      setCtxError(errText(e))
    }
  }, [tenant])

  useEffect(() => {
    void loadCtx()
    try {
      localStorage.setItem(LAST_TENANT, tenant)
    } catch {
      /* storage non disponibile */
    }
  }, [loadCtx, tenant])

  useEffect(() => {
    const h = toHash(tenant, view)
    if (window.location.hash !== h) window.history.replaceState(null, '', h)
  }, [tenant, view])

  // hot reload in sviluppo: eventi dal server
  useEffect(() => {
    if (!session.dev) return
    const es = new EventSource(appUrl('/api/dev/events'))
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as { type: string; id: string; what?: string; error?: string }
        if (ev.type === 'plugin_changed') {
          setReloads((r) => ({ ...r, [ev.id]: (r[ev.id] ?? 0) + 1 }))
          if (ev.what === 'schema') void loadCtx()
          ui.toast(`${ev.id}: ${ev.what === 'ui' ? 'interfaccia' : ev.what === 'logic' ? 'logica' : 'schema'} aggiornata`)
        } else if (ev.type === 'plugin_error') {
          ui.toast(`${ev.id}: ${ev.error}`, true)
        }
      } catch {
        /* evento non valido */
      }
    }
    return () => es.close()
  }, [session.dev, loadCtx, ui])

  const membership = session.memberships.find((m) => m.slug === tenant)
  const isManager = membership?.role === 'tenant_manager'
  const hidden = new Set(ctx?.prefs.hidden ?? [])
  const plugins = (ctx?.plugins ?? []).filter((p) => !hidden.has(p.id))
  const current = view.kind === 'plugin' ? ctx?.plugins.find((p) => p.id === view.id) : undefined

  let main
  if (ctxError) main = <div className="empty">{ctxError}</div>
  else if (!ctx) main = <div className="empty">caricamento…</div>
  else if (view.kind === 'plugin' && current)
    main = <PluginFrame key={current.id + tenant} plugin={current} session={session} ctx={ctx} reloadKey={reloads[current.id] ?? 0} />
  else if (view.kind === 'manage' && isManager) main = <ManageConsole ctx={ctx} onChanged={() => void loadCtx()} />
  else if (view.kind === 'account')
    main = (
      <Account
        session={session}
        onChanged={() => {
          void reloadSession()
        }}
      />
    )
  else
    main = (
      <Overview
        session={session}
        ctx={ctx}
        onOpen={(id) => setView({ kind: 'plugin', id })}
        onAccount={() => setView({ kind: 'account' })}
        onManage={() => setView({ kind: 'manage' })}
      />
    )

  return (
    <UiContext.Provider value={ui}>
      <div className="shell">
        <Rail plugins={plugins} view={view} isManager={!!isManager} isAdmin={false} invitations={session.invitations} onSelect={setView} />
        <main className={'main' + (view.kind === 'plugin' && current ? ' plugin' : '')}>{main}</main>
        <StatusBar
          user={session.user}
          memberships={session.memberships}
          tenant={tenant}
          dev={session.dev}
          onTenant={(t) => {
            setTenant(t)
            setView((v) => (v.kind === 'manage' || v.kind === 'plugin' ? { kind: 'home' } : v))
          }}
          onLogout={() => void signOut(onLogout)}
        />
      </div>
      {overlays}
      {share && ctx && (
        <ShareDialog
          ctx={ctx}
          resourceId={share.id}
          onClose={() => {
            share.done()
            closeShare()
          }}
        />
      )}
    </UiContext.Provider>
  )
}
