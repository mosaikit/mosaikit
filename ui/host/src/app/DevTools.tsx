// The developer profile in the shell (docs/plugin-devkit-plan.md, phase 4): a banner that cannot be missed,
// and the developer tools, a panel with the manifest as the server reads it, the host calls of the plugin
// with their timings and errors, the permissions of the person, the switch between the four test users and
// the reset of the data of a plugin. Nothing here is drawn, fetched or recorded unless the server says it runs
// the developer profile (`/api/health`), so a normal installation does not even know this file exists.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bug, RotateCcw, Trash2, UserRound, X } from 'lucide-react'
import { api, appUrl, enc, errText, setCsrf } from '../api.ts'
import type { Session } from '../types.ts'
import { Button } from '@/components/ui/button'
import { useTenantCtx } from './core.ts'
import { clearCalls, setRecording, setReloadError, useCalls, useReloadError } from './devlog.ts'
import { t } from './i18n.ts'
import { Empty } from './kit.tsx'
import { go, type Route } from './router.ts'
import { useUi } from '../ui-context.ts'

interface DevInfo {
  tenant: string
  password: string
  users: { username: string; name: string; role: string; tenant: string | null }[]
}

interface ManifestView {
  id: string
  dev: boolean
  status: string
  sha256: string
  has_logic: boolean
  ui_dir: string | null
  manifest: unknown
}

type Tab = 'manifest' | 'calls' | 'perms' | 'users' | 'data'

/** Is the server running the developer profile? Asked once, before anybody signs in. */
function useDeveloper(): boolean {
  const q = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ developer?: boolean }>('GET', '/api/health'),
    staleTime: Infinity,
    retry: false,
  })
  const on = q.data?.developer === true
  useEffect(() => setRecording(on), [on])
  return on
}

/** The sign-in pages with the banner above them while the developer profile is on; otherwise, and once somebody is
 *  signed in (the frames of the shell draw the banner themselves, where the maintenance notice goes), the children untouched. */
export default function DevShell({ session, route, children }: { session: Session | undefined; route: Route; children: ReactNode }) {
  const on = useDeveloper()
  if (!on || session) return <>{children}</>
  return (
    <div className="flex h-full flex-col">
      <DevBanner session={session} route={route} />
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  )
}

/** The banner that cannot be closed, with the button of the developer tools once somebody is signed in. */
export function DevBanner({ session, route }: { session: Session | undefined; route: Route }) {
  const on = useDeveloper()
  return on ? <DevBannerBody session={session} route={route} /> : null
}

function DevBannerBody({ session, route }: { session: Session | undefined; route: Route }) {
  const [open, setOpen] = useState(false)
  const info = useQuery({ queryKey: ['dev-info'], queryFn: () => api<DevInfo>('GET', '/api/dev/info'), staleTime: Infinity })
  useReloads(session)
  return (
    <>
      <div role="status" data-testid="dev-banner" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-amber-400 px-3 py-1 text-xs font-medium text-black">
        <Bug className="size-4 shrink-0" aria-hidden />
        <span>
          {t('Developer profile: known passwords, unsigned packages, test data. Never use it for real data.')}
          {!session && info.data && (
            <span className="ml-2 font-normal">
              {t('Test users: {users}, password {password}.', { users: info.data.users.map((u) => u.username).join(', '), password: info.data.password })}
            </span>
          )}
        </span>
        {session && (
          <Button size="sm" variant="outline" className="ml-auto h-6 border-black/40 bg-transparent px-2 text-xs text-black hover:bg-black/10" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {t('Developer tools')}
          </Button>
        )}
      </div>
      {session && open && <DevPanel session={session} route={route} info={info.data} onClose={() => setOpen(false)} />}
    </>
  )
}

/** The reloads of the plugins: the manifest is read again, a failed reload is kept for the panel, and a changed
 *  migration asks to run them again (the data of the plugin is deleted: it needs a yes). */
function useReloads(session: Session | undefined) {
  const qc = useQueryClient()
  const ui = useUi()
  const signedIn = !!session
  useEffect(() => {
    if (!signedIn) return
    const es = new EventSource(appUrl('/api/dev/events'))
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as { type: string; id: string; error?: string; migration_changed?: boolean }
        void qc.invalidateQueries({ queryKey: ['dev-manifest', ev.id] })
        if (ev.type === 'plugin_changed') {
          setReloadError(null)
        } else if (ev.type === 'plugin_error') {
          setReloadError({ plugin: ev.id, error: ev.error ?? '', migrationChanged: ev.migration_changed === true })
          if (ev.migration_changed) {
            void ui.confirm(t('The migrations of {plugin} changed after they ran. Delete its data and run them again from the first one?', { plugin: ev.id }), true).then((yes) => {
              if (yes) void resetPlugin(ev.id)
            })
          }
        }
      } catch {
        /* invalid event */
      }
    }
    return () => es.close()
  }, [signedIn, qc, ui])
}

async function resetPlugin(id: string) {
  try {
    await api('POST', `/api/dev/plugins/${enc(id)}/reset`)
    setReloadError(null)
    toast.success(t('Data of {plugin} deleted: its migrations ran again.', { plugin: id }))
  } catch (e) {
    toast.error(errText(e))
  }
}

function DevPanel({ session, route, info, onClose }: { session: Session; route: Route; info?: DevInfo; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('manifest')
  const plugin = route.area === 'tenant' && route.page === 'plugin' ? { slug: route.tenant, id: route.id! } : null
  const tabs: [Tab, string][] = [
    ['manifest', t('Manifest')],
    ['calls', t('Host calls')],
    ['perms', t('Permissions')],
    ['users', t('Test users')],
    ['data', t('Data')],
  ]
  return (
    <section role="region" aria-label={t('Developer tools')} data-testid="dev-panel" className="fixed inset-x-0 bottom-0 z-40 flex h-[min(45vh,420px)] flex-col border-t bg-background shadow-[0_-4px_16px_rgba(0,0,0,.15)]">
      <header className="flex shrink-0 items-center gap-1 border-b px-3 py-1">
        <div role="tablist" className="flex gap-1">
          {tabs.map(([id, label]) => (
            <Button key={id} role="tab" aria-selected={tab === id} size="sm" variant={tab === id ? 'secondary' : 'ghost'} className="h-7 px-2 text-xs" onClick={() => setTab(id)}>
              {label}
            </Button>
          ))}
        </div>
        <span className="ml-3 truncate text-xs text-muted-foreground">{plugin ? plugin.id : t('No plugin open')}</span>
        <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label={t('Close')} onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
        {tab === 'users' ? <UsersTab session={session} info={info} /> : !plugin ? (
          <Empty art="plugins" compact title={t('Open a plugin')}>
            <p>{t('The manifest, the calls, the permissions and the data are those of the plugin you have open.')}</p>
          </Empty>
        ) : tab === 'manifest' ? (
          <ManifestTab id={plugin.id} />
        ) : tab === 'calls' ? (
          <CallsTab id={plugin.id} />
        ) : tab === 'perms' ? (
          <PermsTab slug={plugin.slug} id={plugin.id} />
        ) : (
          <DataTab id={plugin.id} />
        )}
      </div>
    </section>
  )
}

function ManifestTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['dev-manifest', id], queryFn: () => api<ManifestView>('GET', `/api/dev/plugins/${enc(id)}/manifest`) })
  const failed = useReloadError()
  if (q.isLoading) return <p className="text-muted-foreground">{t('Loading…')}</p>
  if (q.error || !q.data) return <p role="alert">{errText(q.error)}</p>
  const m = q.data
  return (
    <div className="space-y-2">
      {failed && failed.plugin === id && (
        <p role="alert" className="rounded border border-destructive/50 bg-destructive/10 p-2 text-destructive">
          {t('The last reload failed: {error}', { error: failed.error })}
        </p>
      )}
      <p className="text-muted-foreground">
        {m.dev ? t('Loaded from its folder') : t('Installed from a package')} · {m.status} · {m.has_logic ? t('with logic') : t('without logic')}
        {m.ui_dir ? ` · ${m.ui_dir}` : ''}
      </p>
      <pre data-testid="dev-manifest" className="overflow-auto rounded border bg-muted/40 p-2 font-mono">
        {JSON.stringify(m.manifest, null, 2)}
      </pre>
    </div>
  )
}

function CallsTab({ id }: { id: string }) {
  const all = useCalls()
  const calls = useMemo(() => all.filter((c) => c.plugin === id), [all, id])
  if (calls.length === 0)
    return (
      <Empty art="plugins" compact title={t('No host calls yet')}>
        <p>{t('Use the plugin: every call it makes to the host shows here, with its time and its errors.')}</p>
      </Empty>
    )
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-muted-foreground">{t('Calls: {count}', { count: calls.length })}</span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={clearCalls}>
          <Trash2 />
          {t('Clear')}
        </Button>
      </div>
      <table className="w-full" data-testid="dev-calls">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="pr-3 font-medium">{t('Time')}</th>
            <th className="pr-3 font-medium">{t('Operation')}</th>
            <th className="pr-3 text-right font-medium">{t('ms')}</th>
            <th className="font-medium">{t('Result')}</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.n} className={c.ok ? '' : 'text-destructive'}>
              <td className="pr-3 tabular-nums">{new Date(c.at).toLocaleTimeString()}</td>
              <td className="pr-3 font-mono">{c.op}</td>
              <td className="pr-3 text-right tabular-nums">{c.ms.toFixed(0)}</td>
              <td>{c.ok ? t('ok') : c.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PermsTab({ slug, id }: { slug: string; id: string }) {
  const ctx = useTenantCtx(slug)
  if (ctx.isLoading) return <p className="text-muted-foreground">{t('Loading…')}</p>
  if (!ctx.data) return <p role="alert">{errText(ctx.error)}</p>
  const perms = ctx.data.perms?.[id]
  return (
    <div className="space-y-2" data-testid="dev-perms">
      <p>
        {t('Role in {tenant}:', { tenant: ctx.data.tenant.name })} <strong>{ctx.data.tenant.role === 'tenant_manager' ? t('Tenant Manager') : t('User')}</strong>
      </p>
      {perms === undefined ? (
        <p className="text-muted-foreground">{t('The server sends no permission list for this person: the plugin has all it declares.')}</p>
      ) : perms.length === 0 ? (
        <p className="text-muted-foreground">{t('This person has no permission on this plugin.')}</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {perms.map((p) => (
            <li key={p} className="rounded bg-muted px-2 py-0.5 font-mono">
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function UsersTab({ session, info }: { session: Session; info?: DevInfo }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState('')
  async function switchTo(username: string) {
    setBusy(username)
    try {
      const s = await api<Session>('POST', '/api/dev/switch-user', { username })
      setCsrf(s.csrf)
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'health' && q.queryKey[0] !== 'dev-info' })
      qc.setQueryData(['session'], s)
      go('#/')
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy('')
    }
  }
  if (!info) return <p className="text-muted-foreground">{t('Loading…')}</p>
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">{t('Password of every test user: {password}', { password: info.password })}</p>
      <ul className="grid gap-1 sm:grid-cols-2" data-testid="dev-users">
        {info.users.map((u) => (
          <li key={u.username} className="flex items-center gap-2 rounded border p-2">
            <UserRound className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <strong>{u.username}</strong> · {u.role}
              <span className="block truncate text-muted-foreground">{u.tenant ? t('Tenant {tenant}', { tenant: u.tenant }) : t('Whole platform')}</span>
            </span>
            {session.user.username === u.username ? (
              <span className="text-muted-foreground">{t('Signed in')}</span>
            ) : (
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busy !== ''} aria-label={t('Switch to {user}', { user: u.username })} onClick={() => void switchTo(u.username)}>
                {t('Switch')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DataTab({ id }: { id: string }) {
  const ui = useUi()
  const failed = useReloadError()
  async function reset() {
    if (await ui.confirm(t('Delete all the data of {plugin} and run its migrations again?', { plugin: id }), true)) await resetPlugin(id)
  }
  return (
    <div className="space-y-3">
      <p>{t('Deletes the tables and the items of this plugin in every tenant, then runs its migrations again from the first one. The plugin stays loaded from its folder.')}</p>
      {failed?.plugin === id && failed.migrationChanged && <p className="text-muted-foreground">{t('A migration changed after it ran: a reset is the way to apply it.')}</p>}
      <Button variant="destructive" size="sm" onClick={() => void reset()}>
        <RotateCcw />
        {t('Reset the data of this plugin')}
      </Button>
    </div>
  )
}
