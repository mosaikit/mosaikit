// The shell of Mosaikit: sign-in, then the frame with the page of the route.

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { errText, isUnavailable, setUnauthorizedHandler } from '../api.ts'
import type { Session } from '../types.ts'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSession, useTenantCtx } from './core.ts'
import { setLanguageContext, useLang, t } from './i18n.ts'
import { useFavicon } from './mark.ts'
import { UiServices } from './services.tsx'
import { Empty } from './kit.tsx'
import Login from './Login.tsx'
import { NotificationsPage } from './notifications.tsx'
import { AdminOverview, AdminSystem, AdminTenant, AdminTenants } from './pages/admin.tsx'
import { AdminPluginPage, AdminPlugins, TenantPlugins } from './pages/plugins.tsx'
import { AccountPage } from './pages/common.tsx'
import { LogPage, TrashPage } from './pages/history.tsx'
import { AdminPeople, AdminPersonPage, GroupPage, ItemPage, PersonPage, PluginAccessPage, RequestsPage, ResetPage } from './pages/people.tsx'
import { Manage, PluginPage, Shares, TenantHome, TenantSettingsPage, Usage } from './pages/tenant.tsx'
import { go, href, parse, to, useHash, type Route } from './router.ts'
import Shell from './Shell.tsx'
import { setDefaultMode, setPreset } from './theme.ts'

const LAST_TENANT = 'msk_tenant'

/** Where whoever signed in must be: the administrator in the platform, the others in one of their tenants;
 *  the old addresses lead to the new home. */
function landing(s: Session, r: Route, hash: string): string | null {
  if (r.area === 'reset') return null
  const canonical = r.area === 'login' ? null : href(r)
  if (s.user.is_system_admin) return r.area === 'admin' ? (canonical !== hash ? canonical : null) : to.admin()
  if (r.area === 'tenant' && s.memberships.some((m) => m.slug === r.tenant)) return canonical !== hash ? canonical : null
  let last = ''
  try {
    last = localStorage.getItem(LAST_TENANT) ?? ''
  } catch {
    /* storage not available */
  }
  const slug = [last, s.user.home_tenant_slug].find((x) => s.memberships.some((m) => m.slug === x)) ?? s.memberships[0]?.slug
  // the landing page of the home tenant (Identity and texts): an app instead of Home
  const page = slug === s.user.home_tenant_slug ? s.config?.['identity.landing'] : undefined
  if (slug && typeof page === 'string' && page !== 'home') return to.plugin(slug, page)
  return slug ? to.tenant(slug) : null
}

function Page({ session, route }: { session: Session; route: Route }) {
  if (route.area === 'admin') {
    if (route.page === 'tenants') return <AdminTenants />
    if (route.page === 'tenant') return <AdminTenant id={route.id!} section={route.section} />
    if (route.page === 'people') return <AdminPeople />
    if (route.page === 'person') return <AdminPersonPage id={route.id!} tab={route.section} />
    if (route.page === 'plugins') return <AdminPlugins section={route.section} />
    if (route.page === 'plugin') return <AdminPluginPage id={route.id!} tab={route.section} />
    if (route.page === 'system') return <AdminSystem session={session} section={route.section} />
    if (route.page === 'account') return <AccountPage session={session} route={route} />
    if (route.page === 'notifications') return <NotificationsPage session={session} route={route} />
    if (route.page === 'log') return <LogPage />
    return <AdminOverview session={session} />
  }
  if (route.area === 'tenant') {
    const manager = session.memberships.find((m) => m.slug === route.tenant)?.role === 'tenant_manager'
    if (route.page === 'plugin') return <PluginPage session={session} slug={route.tenant} id={route.id!} at={route.section} />
    if (route.page === 'account') return <AccountPage session={session} route={route} />
    if (route.page === 'notifications') return <NotificationsPage session={session} route={route} />
    if (route.page === 'requests') return <RequestsPage slug={route.tenant} />
    if (route.page === 'item') return <ItemPage slug={route.tenant} id={route.id!} />
    if (route.page === 'trash') return <TrashPage slug={route.tenant} />
    if (route.page !== 'home' && !manager) return <Empty title={t('Reserved to Tenant Managers')} />
    if (route.page === 'person') return <PersonPage slug={route.tenant} id={route.id!} tab={route.section} />
    if (route.page === 'group') return <GroupPage slug={route.tenant} id={route.id!} tab={route.section} />
    if (route.page === 'plugins' && route.section) return <PluginAccessPage slug={route.tenant} plugin={route.section} />
    if (route.page === 'manage') return <Manage slug={route.tenant} section={route.section} />
    if (route.page === 'plugins') return <TenantPlugins slug={route.tenant} />
    if (route.page === 'shares') return <Shares slug={route.tenant} />
    if (route.page === 'usage') return <Usage slug={route.tenant} />
    if (route.page === 'log') return <LogPage slug={route.tenant} />
    if (route.page === 'settings') return <TenantSettingsPage slug={route.tenant} section={route.section} />
    return <TenantHome session={session} slug={route.tenant} />
  }
  return null
}

export default function App() {
  const qc = useQueryClient()
  const session = useSession()
  const hash = useHash()
  const uiLang = useLang() // with the new language everything is drawn again
  // ...and the data of the server, which carry the texts of the plugins in that language
  const shownLanguage = useRef(uiLang)
  useEffect(() => {
    if (shownLanguage.current === uiLang) return
    shownLanguage.current = uiLang
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'session' })
  }, [uiLang, qc])
  const route = parse(hash)
  useFavicon()
  useEffect(() => setUnauthorizedHandler(() => qc.setQueryData(['session'], null)), [qc])
  const s = session.data
  const target = s ? landing(s, route, hash) : null
  // the theme of the tenant one works in, otherwise the one of the platform
  const ctx = useTenantCtx(s && route.area === 'tenant' ? route.tenant : '')
  const preset = route.area === 'tenant' ? ctx.data?.theme?.preset : s?.theme
  useEffect(() => setPreset(preset), [preset])
  // languages, formats and default mode of the tenant one works in, otherwise of the home tenant (the
  // platform's for the Administrator)
  const config = route.area === 'tenant' ? ctx.data?.config : s?.config
  const known = !!config
  const enabled = JSON.stringify(config?.['lang.enabled'] ?? null)
  const language = config?.['lang.default'] as string | undefined
  const locale = config?.['format.locale'] as string | undefined
  const mode = config?.['appearance.mode'] as string | undefined
  useEffect(() => {
    if (!known) return
    setLanguageContext({ enabled: (JSON.parse(enabled) as string[] | null) ?? undefined, language, locale })
    setDefaultMode(mode)
  }, [known, enabled, language, locale, mode])
  useEffect(() => {
    if (target) go(target)
  }, [target])
  useEffect(() => {
    if (route.area === 'tenant')
      try {
        localStorage.setItem(LAST_TENANT, route.tenant)
      } catch {
        /* storage not available */
      }
  }, [route])

  if (session.isLoading)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        {isUnavailable(session.failureReason) && <p role="status">{errText(session.failureReason)}</p>}
      </div>
    )
  return (
    <UiServices>
      <TooltipProvider delayDuration={300}>
        {route.area === 'reset' ? (
          // the page of a link to choose a new password works with or without a session
          <ResetPage token={route.token} />
        ) : !s ? (
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
