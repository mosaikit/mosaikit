// La shell di Mosaikit: accesso, poi la cornice con la pagina della rotta.

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { setUnauthorizedHandler } from '../api.ts'
import type { Session } from '../types.ts'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSession, useTenantCtx } from './core.ts'
import { useLang, t } from './i18n.ts'
import { useFavicon } from './mark.ts'
import { UiServices } from './services.tsx'
import { Empty } from './kit.tsx'
import Login from './Login.tsx'
import { NotificationsPage } from './notifications.tsx'
import { AdminOverview, AdminPlugins, AdminSystem, AdminTenant, AdminTenants } from './pages/admin.tsx'
import { AccountPage } from './pages/common.tsx'
import { Manage, PluginPage, Shares, TenantHome, TenantPlugins, TenantSettingsPage, Usage } from './pages/tenant.tsx'
import { go, href, parse, to, useHash, type Route } from './router.ts'
import Shell from './Shell.tsx'
import { setPreset } from './theme.ts'

const LAST_TENANT = 'msk_tenant'

/** Dove deve stare chi e' entrato: l'amministratore nella piattaforma, gli altri in un loro tenant; gli
 *  indirizzi di prima portano alla casa nuova. */
function landing(s: Session, r: Route, hash: string): string | null {
  const canonical = r.area === 'login' ? null : href(r)
  if (s.user.is_system_admin) return r.area === 'admin' ? (canonical !== hash ? canonical : null) : to.admin()
  if (r.area === 'tenant' && s.memberships.some((m) => m.slug === r.tenant)) return canonical !== hash ? canonical : null
  let last = ''
  try {
    last = localStorage.getItem(LAST_TENANT) ?? ''
  } catch {
    /* storage non disponibile */
  }
  const slug = [last, s.user.home_tenant_slug].find((x) => s.memberships.some((m) => m.slug === x)) ?? s.memberships[0]?.slug
  return slug ? to.tenant(slug) : null
}

function Page({ session, route }: { session: Session; route: Route }) {
  if (route.area === 'admin') {
    if (route.page === 'tenants') return <AdminTenants />
    if (route.page === 'tenant') return <AdminTenant id={route.id!} section={route.section} />
    if (route.page === 'plugins') return <AdminPlugins section={route.section} />
    if (route.page === 'system') return <AdminSystem session={session} section={route.section} />
    if (route.page === 'account') return <AccountPage session={session} route={route} />
    if (route.page === 'notifications') return <NotificationsPage session={session} route={route} />
    return <AdminOverview session={session} />
  }
  if (route.area === 'tenant') {
    const manager = session.memberships.find((m) => m.slug === route.tenant)?.role === 'tenant_manager'
    if (route.page === 'plugin') return <PluginPage session={session} slug={route.tenant} id={route.id!} />
    if (route.page === 'account') return <AccountPage session={session} route={route} />
    if (route.page === 'notifications') return <NotificationsPage session={session} route={route} />
    if (route.page !== 'home' && !manager) return <Empty title={t('Riservato ai Tenant Manager')} />
    if (route.page === 'manage') return <Manage slug={route.tenant} section={route.section} />
    if (route.page === 'plugins') return <TenantPlugins slug={route.tenant} />
    if (route.page === 'shares') return <Shares slug={route.tenant} />
    if (route.page === 'usage') return <Usage slug={route.tenant} />
    if (route.page === 'settings') return <TenantSettingsPage slug={route.tenant} section={route.section} />
    return <TenantHome session={session} slug={route.tenant} />
  }
  return null
}

export default function App() {
  const qc = useQueryClient()
  const session = useSession()
  const hash = useHash()
  useLang() // con la lingua nuova si ridisegna tutto
  const route = parse(hash)
  useFavicon()
  useEffect(() => setUnauthorizedHandler(() => qc.setQueryData(['session'], null)), [qc])
  const s = session.data
  const target = s ? landing(s, route, hash) : null
  // il tema del tenant in cui si lavora, altrimenti quello della piattaforma
  const ctx = useTenantCtx(s && route.area === 'tenant' ? route.tenant : '')
  const preset = route.area === 'tenant' ? ctx.data?.theme?.preset : s?.theme
  useEffect(() => setPreset(preset), [preset])
  useEffect(() => {
    if (target) go(target)
  }, [target])
  useEffect(() => {
    if (route.area === 'tenant')
      try {
        localStorage.setItem(LAST_TENANT, route.tenant)
      } catch {
        /* storage non disponibile */
      }
  }, [route])

  if (session.isLoading)
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    )
  return (
    <UiServices>
      <TooltipProvider delayDuration={300}>
        {!s ? (
          <Login door={route.area === 'login' ? route.door : route.area === 'admin' ? 'admin' : 'tenant'} tenant={route.area === 'login' ? route.tenant : undefined} />
        ) : target ? null : (
          <Shell session={s} route={route}>
            <Page session={s} route={route} />
          </Shell>
        )}
      </TooltipProvider>
      <Toaster richColors closeButton position="bottom-right" />
    </UiServices>
  )
}
