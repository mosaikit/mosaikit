import { useCallback, useEffect, useRef, useState } from 'react'
import Login from './components/Login.tsx'
import IconRail from './components/IconRail.tsx'
import StatusBar from './components/StatusBar.tsx'
import ConfirmDialog, { type ConfirmRequest } from './components/ConfirmDialog.tsx'
import PluginManager from './components/PluginManager.tsx'
import PluginView from './components/PluginView.tsx'
import { api, errText, getToken, clearSession, onSessionExpired } from './api.ts'
import type { PluginInfo } from './types.ts'

export default function App() {
  const [user, setUser] = useState<string | null>(() => localStorage.getItem('msk_user'))
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [view, setView] = useState<string | null>(null)
  const [manage, setManage] = useState(false)
  const [status, setStatus] = useState('pronto')
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const startedRef = useRef<string | null>(null)

  const authenticated = user !== null && getToken() !== null

  const refreshPlugins = useCallback(async () => {
    const r = await api<{ plugins: PluginInfo[] }>('GET', '/plugins')
    setPlugins(r.plugins)
    return r.plugins
  }, [])

  // dati iniziali dopo il login
  useEffect(() => {
    if (!authenticated) return
    refreshPlugins().catch((e) => setStatus(errText(e)))
  }, [authenticated, refreshPlugins])

  // reload automatico quando il backend si riavvia (dev con cargo watch)
  useEffect(() => {
    if (!authenticated) return
    const t = setInterval(() => {
      api<{ started: string }>('GET', '/api')
        .then((r) => {
          if (startedRef.current !== null && startedRef.current !== r.started) {
            location.reload()
            return
          }
          startedRef.current = r.started
        })
        .catch(() => {
          // backend giu': il poll riprova al prossimo giro
        })
    }, 2000)
    return () => clearInterval(t)
  }, [authenticated])

  // sessione scaduta -> ritorna al login
  useEffect(() => {
    onSessionExpired(() => {
      clearSession()
      setUser(null)
      setView(null)
      setPlugins([])
      setStatus('sessione scaduta: rieffettua il login')
    })
  }, [])

  const ask = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => setConfirm({ message, resolve }))
  }, [])

  // esegue un'operazione, poi rinfresca l'elenco plugin; se il plugin della
  // vista corrente e' stato disattivato/disinstallato, torna alla home
  const run = useCallback(
    async (fn: () => Promise<unknown>, okMsg?: string) => {
      try {
        await fn()
        if (okMsg) setStatus(okMsg)
        const list = await refreshPlugins()
        if (view && !list.find((p) => p.view === view && p.active)) {
          setView(null)
        }
      } catch (e) {
        setStatus(errText(e))
      }
    },
    [refreshPlugins, view],
  )

  const installPackage = useCallback(async (file: File) => {
    await api('POST', '/plugins/install', file, true)
  }, [])

  const doLogout = useCallback(() => {
    api('POST', '/logout').catch(() => {})
    clearSession()
    setUser(null)
    setView(null)
    setPlugins([])
    setStatus('pronto')
  }, [])

  if (!authenticated) {
    return (
      <Login
        onSuccess={(u) => {
          setUser(u)
          setStatus('pronto')
        }}
      />
    )
  }

  const active = plugins.filter((p) => p.active)
  const current = view ? active.find((p) => p.view === view) : undefined

  return (
    <div className="shell">
      <IconRail
        plugins={active}
        currentView={view}
        onSelect={(p) => {
          setView(p.view)
          setStatus('')
        }}
        onManage={() => setManage(true)}
      />
      <main className="main">
        {view && current?.has_ui ? (
          <PluginView pluginId={current.id} user={user ?? ''} />
        ) : view ? (
          <div className="empty">
            <p>Il plugin selezionato non espone una UI.</p>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-mosaic" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </div>
            <p>Seleziona un'icona dalla barra laterale, oppure gestisci i plugin con 🧩</p>
          </div>
        )}
      </main>
      <StatusBar user={user ?? ''} msg={status} onLogout={doLogout} />
      <ConfirmDialog
        request={confirm}
        onResolve={(v) => {
          confirm?.resolve(v)
          setConfirm(null)
        }}
      />
      {manage && (
        <PluginManager
          plugins={plugins}
          onClose={() => setManage(false)}
          onActivate={(id) =>
            run(
              () => api('POST', `/plugins/${encodeURIComponent(id)}/activate`),
              'attivato: ' + id,
            )
          }
          onDeactivate={(id) =>
            run(
              () => api('POST', `/plugins/${encodeURIComponent(id)}/deactivate`),
              'disattivato: ' + id,
            )
          }
          onUninstall={(id) =>
            run(async () => {
              if (!(await ask(`Disinstallare ${id}?`))) return
              await api('DELETE', `/plugins/${encodeURIComponent(id)}`)
            }, 'disinstallato: ' + id)
          }
          onInstall={(f) => run(() => installPackage(f), 'installato: ' + f.name)}
        />
      )}
    </div>
  )
}
