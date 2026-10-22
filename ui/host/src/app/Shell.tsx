// The frame of the shell, as in the mockup (docs/mockup) and according to docs/refactoring-ui.md: the logo
// in the corner above the sidebar (only the symbol when it is closed), the sidebar with icons or labels
// (a drawer on the phone) with the work and the management of the scope, the top bar with the sidebar
// button, the tenant switcher, the search in the middle (Ctrl K) and on the right language, mode, help,
// bell and the menu of the person (Account, Notifications, Sign out). Logo, search, language, help and mode
// are turned on or off by the Administrator for everybody (System › Top bar).

import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Bell,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  Contrast,
  Gauge,
  History,
  House,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Puzzle,
  Settings,
  Share2,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import { api } from '../api.ts'
import { MaintenanceBanner } from './pages/operations.tsx'
import { useBrand } from '../brand.ts'
import type { Session, ShellBand } from '../types.ts'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import AppIcon from './AppIcon.tsx'
import SearchBox, { type SearchGroup } from './SearchBox.tsx'
import { initials, useTenantCtx } from './core.ts'
import { setLang, t, useLang, useLanguages, type Lang } from './i18n.ts'
import { NotificationsBell } from './notifications.tsx'
import { useLiveNotes, useUnread } from './notes.ts'
import { bandOf, sidebarOpen } from './prefs.ts'
import { go, personal, to, type Route } from './router.ts'
import { markSvg, type MarkVariant } from './mark.ts'
import { QuotaAlert } from './Quotas.tsx'
import { useFreshTour, useHelpItems } from './help.ts'
import { HelpLayer } from './HelpLayer.tsx'
import { useSetContrast } from './personal.ts'
import { effectiveMode, setTheme, useTheme, type Mode } from './theme.ts'

/** The symbol of the application (or the brand logo), as in the favicon (mark.ts): `negative` on the
 *  bar and on the sign-in panel, always dark; elsewhere it follows the light or dark mode. */
export function AppMark({ className, variant }: { className?: string; variant?: MarkVariant }) {
  const brand = useBrand()
  const th = useTheme()
  const v = variant ?? (effectiveMode(th) === 'dark' ? 'negative' : 'positive')
  // the logo of the platform (System › Identity and texts, or brand.toml): the one for dark backgrounds on
  // the bar and on the sign-in panel, if there is one
  if (v === 'negative' && brand.logo_dark) return <img src="brand/logo-dark" alt="" className={cn('size-7 object-contain', className)} />
  if (brand.logo) return <img src="brand/logo" alt="" className={cn('size-7 object-contain', className)} />
  return <span aria-hidden="true" className={cn('block size-7 shrink-0 [&>svg]:size-full', className)} dangerouslySetInnerHTML={{ __html: markSvg(v) }} />
}

interface NavItem {
  label: string
  /** short name under the icon, when the sidebar is closed */
  short?: string
  icon: ReactNode
  href: string
  active: boolean
}
interface NavGroup {
  label?: string
  items: NavItem[]
}

/** The items of the sidebar per role (docs/refactoring-ui.md §2): work, management of the scope, at the
 *  bottom the settings of the scope. The personal pages are in the menu of the person. */
function useNav(session: Session, route: Route): { groups: NavGroup[]; bottom: NavItem[] } {
  const slug = route.area === 'tenant' ? route.tenant : ''
  const ctx = useTenantCtx(slug)
  if (route.area === 'admin') {
    const page = route.page
    return {
      groups: [
        {
          items: [
            { label: t('Platform overview'), short: t('Overview'), icon: <LayoutDashboard />, href: to.admin(), active: page === 'overview' },
            { label: t('Tenant'), icon: <Building2 />, href: to.admin('tenants'), active: page === 'tenants' || page === 'tenant' },
            { label: t('People'), icon: <Users />, href: to.admin('people'), active: page === 'people' || page === 'person' },
            { label: t('Plugins'), icon: <Puzzle />, href: to.admin('plugins'), active: page === 'plugins' },
            { label: t('Monitoring'), icon: <Activity />, href: to.admin('monitoring'), active: page === 'monitoring' },
            { label: t('Log'), icon: <History />, href: to.admin('log'), active: page === 'log' },
          ],
        },
      ],
      bottom: [{ label: t('System'), icon: <Settings />, href: to.admin('system'), active: page === 'system' }],
    }
  }
  if (route.area !== 'tenant') return { groups: [], bottom: [] }
  const manager = session.memberships.find((m) => m.slug === slug)?.role === 'tenant_manager'
  const hidden = new Set(ctx.data?.prefs.hidden ?? [])
  const page = route.page
  const apps: NavItem[] = (ctx.data?.plugins ?? [])
    .filter((p) => p.has_ui && !hidden.has(p.id))
    .map((p) => ({ label: p.label, icon: <AppIcon id={p.id} name={p.icon_name} />, href: to.plugin(slug, p.id), active: page === 'plugin' && route.id === p.id }))
  const groups: NavGroup[] = [
    {
      items: [
        manager
          ? { label: t('Tenant overview'), short: t('Overview'), icon: <LayoutDashboard />, href: to.tenant(slug), active: page === 'home' }
          : { label: t('Home'), icon: <House />, href: to.tenant(slug), active: page === 'home' },
      ],
    },
    { label: t('Apps'), items: apps },
  ]
  if (manager)
    groups.push({
      label: t('Tenant management'),
      items: [
        { label: t('Manage'), icon: <Users />, href: to.tenant(slug, 'manage'), active: page === 'manage' || page === 'person' || page === 'group' },
        { label: t('Plugins'), icon: <Puzzle />, href: to.tenant(slug, 'plugins'), active: page === 'plugins' },
        { label: t('Shares'), icon: <Share2 />, href: to.tenant(slug, 'shares'), active: page === 'shares' },
        { label: t('Usage'), icon: <Gauge />, href: to.tenant(slug, 'usage'), active: page === 'usage' },
        { label: t('Log'), icon: <History />, href: to.tenant(slug, 'log'), active: page === 'log' },
      ],
    })
  return {
    groups: groups.filter((g) => g.items.length),
    bottom: manager ? [{ label: t('Tenant settings'), short: t('Settings'), icon: <Settings />, href: to.tenant(slug, 'settings'), active: page === 'settings' }] : [],
  }
}

function NavList({ items }: { items: NavItem[] }) {
  const { isMobile, setOpenMobile, state } = useSidebar()
  const rail = state === 'collapsed' && !isMobile
  return (
    // closed, like Teams: one item every 56px, without space between them
    <SidebarMenu className="group-data-[collapsible=icon]:gap-0">
      {items.map((it) => (
        <SidebarMenuItem key={it.href}>
          <SidebarMenuButton
            asChild
            isActive={it.active}
            className={cn(
              // open, as in the mockup: 14px, active item on white with the accent
              '[&>svg]:fill-current [&>svg]:[fill-opacity:0.1] data-[active=true]:[&>svg]:[fill-opacity:0.2] hover:[&>svg]:[fill-opacity:0.16]',
              'relative h-10 gap-2.5 rounded-[8px] px-2.5 text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground [&>svg]:size-5',
              // closed, like the Teams bar: icon and name below, grey (--rail-foreground); the active item
              // and the one under the mouse in the accent colour, the active one with the bar on the left too
              'group-data-[collapsible=icon]:h-[56px]! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-1.5 group-data-[collapsible=icon]:rounded-none group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:bg-transparent! group-data-[collapsible=icon]:font-normal! group-data-[collapsible=icon]:text-rail-foreground group-data-[collapsible=icon]:hover:text-sidebar-primary group-data-[collapsible=icon]:data-[active=true]:text-sidebar-primary group-data-[collapsible=icon]:[&>svg]:size-5 group-data-[collapsible=icon]:[&>svg]:stroke-[1.6]',
              'group-data-[collapsible=icon]:[&>span:last-child]:block group-data-[collapsible=icon]:[&>span:last-child]:max-w-[60px] group-data-[collapsible=icon]:[&>span:last-child]:truncate group-data-[collapsible=icon]:[&>span:last-child]:text-center group-data-[collapsible=icon]:[&>span:last-child]:text-[10px] group-data-[collapsible=icon]:[&>span:last-child]:leading-3',
              "group-data-[collapsible=icon]:data-[active=true]:before:absolute group-data-[collapsible=icon]:data-[active=true]:before:inset-y-2 group-data-[collapsible=icon]:data-[active=true]:before:left-0 group-data-[collapsible=icon]:data-[active=true]:before:w-[3px] group-data-[collapsible=icon]:data-[active=true]:before:rounded-r-[3px] group-data-[collapsible=icon]:data-[active=true]:before:bg-sidebar-primary group-data-[collapsible=icon]:data-[active=true]:before:content-['']",
            )}
          >
            <a href={it.href} aria-label={rail && it.short ? it.label : undefined} title={rail && it.short ? it.label : undefined} onClick={() => isMobile && setOpenMobile(false)}>
              {it.icon}
              <span>{rail ? (it.short ?? it.label) : it.label}</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

const bandIcon =
  'flex size-8 shrink-0 items-center justify-center rounded-md text-band-foreground/90 outline-none hover:bg-band-hover hover:text-band-foreground focus-visible:ring-2 focus-visible:ring-white/60 data-[state=open]:bg-band-hover'

function AppSidebar({ session, route, band }: { session: Session; route: Route; band: ShellBand }) {
  const brand = useBrand()
  const { isMobile, state } = useSidebar()
  const nav = useNav(session, route)
  const admin = session.user.is_system_admin
  const manager = route.area === 'tenant' && session.memberships.find((m) => m.slug === route.tenant)?.role === 'tenant_manager'
  return (
    // the right border is drawn by the parts: light on the top bar, grey below
    <Sidebar collapsible="icon" className="border-r-0!" data-tour="sidebar">
      {isMobile && !admin ? (
        // on the phone the drawer starts with the tenant switcher (manager and user)
        <SidebarHeader className="border-b p-2">
          <TenantSwitcher session={session} route={route} variant="sidebar" />
        </SidebarHeader>
      ) : (
        <SidebarHeader className="h-[50px] flex-row items-center gap-2.5 border-r border-b border-band-line bg-band px-4 text-band-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          {band.logo || isMobile ? (
            <>
              <AppMark variant="negative" />
              <span className="truncate text-[17px] font-bold group-data-[collapsible=icon]:hidden">{brand.name}</span>
            </>
          ) : (
            // without a logo, the sidebar button takes its place
            <SidebarTrigger className={cn(bandIcon, 'size-8 -ml-1.5 group-data-[collapsible=icon]:ml-0')} aria-label={t('Open or close the sidebar')} />
          )}
        </SidebarHeader>
      )}
      <SidebarContent className="border-r border-sidebar-border pt-2 group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:pt-[9px]">
        {nav.groups.map((g, i) => (
          <SidebarGroup key={i} className="group-data-[collapsible=icon]:p-0">
            {g.label && <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">{g.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <NavList items={g.items} />
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-r border-sidebar-border pb-3 group-data-[collapsible=icon]:px-0">
        {/* only when a quota of the tenant passes 80 %: no fixed widget */}
        {route.area === 'tenant' && (
          <div className="px-2 group-data-[collapsible=icon]:px-2.5">
            <QuotaAlert slug={route.tenant} manager={manager} compact={state === 'collapsed' && !isMobile} />
          </div>
        )}
        <NavList items={nav.bottom} />
      </SidebarFooter>
    </Sidebar>
  )
}

/** The active tenant, with the menu to switch it (only if there is more than one tenant). The Administrator
 *  works on the platform: a fixed badge says so, without a menu. */
function TenantSwitcher({ session, route, variant = 'band' }: { session: Session; route: Route; variant?: 'band' | 'sidebar' }) {
  const band = variant === 'band'
  const ctx = useTenantCtx(route.area === 'tenant' && !session.user.is_system_admin ? route.tenant : '')
  if (session.user.is_system_admin)
    return (
      <span
        title={t('The Administrator works on the platform, not inside a tenant')}
        className={cn('flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold', band ? 'bg-white/15 text-band-foreground ring-1 ring-white/25' : 'bg-primary/10 text-primary-strong')}
      >
        <ShieldCheck className="size-4" />
        {t('Platform')}
      </span>
    )
  const slug = route.area === 'tenant' ? route.tenant : ''
  const member = session.memberships.find((m) => m.slug === slug)
  // the identity of the tenant (Tenant settings › Identity and texts): its name and logo
  const ctxName = ctx.data?.config?.['identity.name']
  const cur = member && { ...member, name: typeof ctxName === 'string' && ctxName ? ctxName : member.name }
  const logo = ctx.data?.config?.['identity.logo_dark'] ? 'logo_dark' : ctx.data?.config?.['identity.logo_light'] ? 'logo_light' : null
  const badge = (name: string) => (logo && slug ? <img src={`api/auth/tenants/${encodeURIComponent(slug)}/logo/${logo}`} alt="" className="size-6 shrink-0 object-contain" /> : <TenantBadge name={name} />)
  const home = session.memberships.filter((m) => m.is_home)
  const guest = session.memberships.filter((m) => !m.is_home)
  const item = (m: (typeof session.memberships)[number]) => (
    <DropdownMenuItem key={m.slug} onSelect={() => go(to.tenant(m.slug))} className="gap-2">
      <TenantBadge name={m.name} />
      <span className="flex-1">
        <span className="block font-medium">{m.name}</span>
        <span className="block text-xs text-muted-foreground">{m.role === 'tenant_manager' ? 'Tenant Manager' : 'User'}</span>
      </span>
      {m.slug === slug && <Check className="size-4" />}
    </DropdownMenuItem>
  )
  if (session.memberships.length <= 1)
    return (
      <span className={cn('flex h-9 min-w-0 items-center gap-2 px-2 text-sm font-semibold', band ? 'text-band-foreground' : 'w-full')}>
        {badge(cur?.name ?? '?')}
        <span className={cn('truncate', band ? 'max-w-44' : 'flex-1')}>{cur?.name ?? 'Tenant'}</span>
      </span>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex h-9 min-w-0 items-center gap-2 rounded-md px-2 text-sm font-semibold outline-none focus-visible:ring-2',
          band ? 'text-band-foreground hover:bg-band-hover focus-visible:ring-white/60' : 'w-full hover:bg-sidebar-accent',
        )}
      >
        {/* the name comes from the content (an aria-label would differ from the visible text): the initials
            repeat the name and are hidden, the words around the name are only for screen readers */}
        <span aria-hidden="true" className="contents">
          {badge(cur?.name ?? '?')}
        </span>
        <span className="sr-only">{t('Tenant:')} </span>
        <span className={cn('truncate', band ? 'max-w-44' : 'flex-1 text-left')}>{cur?.name ?? 'Tenant'}</span>
        <span className="sr-only">. {t('Switch tenant')}</span>
        <ChevronDown className="size-4 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">{t('Home tenant')}</DropdownMenuLabel>
        {home.map(item)}
        {guest.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">{t('Guest in')}</DropdownMenuLabel>
            {guest.map(item)}
          </>
        )}
        <DropdownMenuSeparator />
        <p className="flex gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" />
          {t('You always sign in with the credentials of {home}: switching tenant does not ask you to sign in again.', { home: home[0]?.name ?? '' })}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TenantBadge({ name }: { name: string }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground ring-1 ring-white/30">
      {initials(name)}
    </span>
  )
}

/** The mode for oneself: light, dark or automatic; theme and other preferences are in Account. */
function ModeMenu({ route }: { route: Route }) {
  const th = useTheme()
  const setContrast = useSetContrast()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={bandIcon} aria-label={t('Mode')} title={t('Mode: light, dark or automatic')}>
        <Contrast className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">{t('Mode')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={th.mode} onValueChange={(v) => setTheme({ mode: v as Mode })}>
          <DropdownMenuRadioItem value="light">{t('Light')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('Dark')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="auto">{t('Automatic')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={th.contrast} onCheckedChange={(v) => void setContrast(v === true)}>
          {t('High contrast')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => go(personal(route, 'account', 'appearance'))}>
          <Settings />
          {t('Theme and other preferences')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The languages offered here (Languages and formats); with only one there is nothing to choose. */
function LanguageMenu() {
  const lang = useLang()
  const langs = useLanguages()
  const name = langs.find((l) => l.id === lang)?.name ?? lang
  if (langs.length < 2) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(bandIcon, 'font-mono text-xs font-semibold')} aria-label={`${lang.toUpperCase()} · ${t('Language: {name}', { name })}`} title={t('Language: {name}', { name })}>
        {lang.toUpperCase()}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">{t('Language')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)}>
          {langs.map((l) => (
            <DropdownMenuRadioItem key={l.id} value={l.id}>
              {l.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The items of the help, as in the mockup: in the bar (? menu) or, if the help is off, in the menu of the person. */
function HelpMenu({ session, route }: { session: Session; route: Route }) {
  const brand = useBrand()
  const items = useHelpItems(session, route)
  const fresh = useFreshTour(session, route)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(bandIcon, 'relative')} aria-label={t('Help')} aria-description={fresh ? t('A guided tour of this page is available') : undefined} data-fresh={fresh ? 'true' : undefined} title={t('Help and version')} data-tour="help">
        <CircleHelp className="size-[18px]" />
        {fresh && <span aria-hidden="true" className="absolute top-1 right-1 size-2 rounded-full bg-band-foreground ring-2 ring-band" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {items.map((x) => (
          <DropdownMenuItem key={x.label} onSelect={x.run} disabled={x.disabled}>
            <x.icon />
            <span className="flex-1">{x.label}</span>
            {x.fresh && <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{t('new')}</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <AppMark className="size-[18px]" />
          <span className="text-xs font-semibold">
            {brand.name || 'Mosaikit'} {brand.version}
          </span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The menu of the person: Account, Notifications, Sign out (and the help, if the bar does not show it). */
function UserMenu({ session, route, band }: { session: Session; route: Route; band: ShellBand }) {
  const qc = useQueryClient()
  const unread = useUnread().data ?? 0
  const help = useHelpItems(session, route)
  const u = session.user
  const name = u.display_name || u.username
  async function logout() {
    let endSession: string | null = null
    try {
      // a person of a tenant with an identity provider also signs out of the provider
      endSession = (await api<{ end_session?: string | null }>('POST', '/api/auth/logout')).end_session ?? null
    } catch {
      /* session already closed */
    }
    qc.setQueryData(['session'], null)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' })
    if (endSession) window.location.assign(endSession)
    else go(u.is_system_admin ? '#/admin' : '#/')
  }
  const role = u.is_system_admin ? 'Administrator' : roleOf(session, route)
  const tenant = route.area === 'tenant' ? session.memberships.find((m) => m.slug === route.tenant)?.name : t('Platform')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-tour="person"
        className="flex items-center gap-2 rounded-md py-0.5 pr-0.5 pl-2 text-band-foreground outline-none hover:bg-band-hover focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {/* the name comes from the content, so it always holds the visible text (WCAG 2.5.3); on a
            narrow bar person and role are sr-only */}
        <span className="sr-only text-right leading-tight min-[1100px]:not-sr-only min-[1100px]:block">
          <span className="block text-[13px] font-semibold">{name}</span>
          <span className="block text-[11px] text-band-muted">{role}</span>
        </span>
        <span className="sr-only">{t('person menu')}</span>
        <Avatar className="size-7" aria-hidden="true">
          <AvatarFallback className="bg-teal-700 text-[11px] font-semibold text-white">{initials(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block">{name}</span>
          <span className="block text-xs font-normal text-muted-foreground">{u.is_system_admin ? u.username : `${u.username}@${u.home_tenant_slug}`}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {role} · {tenant}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => go(personal(route, 'account'))}>
          <UserRound />
          {t('Account')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => go(personal(route, 'notifications'))}>
          <Bell />
          <span className="flex-1">{t('Notifications')}</span>
          {unread > 0 && <span className="text-xs text-muted-foreground">{t('{n} new', { n: String(unread) })}</span>}
        </DropdownMenuItem>
        {route.area === 'tenant' && (
          <DropdownMenuItem onSelect={() => go(to.tenant(route.tenant, 'trash'))}>
            <Trash2 />
            {t('Trash')}
          </DropdownMenuItem>
        )}
        {!band.help && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">{t('Help')}</DropdownMenuLabel>
            {help.map((x) => (
              <DropdownMenuItem key={x.label} onSelect={x.run}>
                <x.icon />
                {x.label}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut />
          {t('Sign out')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function roleOf(session: Session, route: Route): string {
  const slug = route.area === 'tenant' ? route.tenant : ''
  return session.memberships.find((m) => m.slug === slug)?.role === 'tenant_manager' ? 'Tenant Manager' : 'User'
}

function TopBar({ session, route, band }: { session: Session; route: Route; band: ShellBand }) {
  const nav = useNav(session, route)
  const { isMobile } = useSidebar()
  const items = nav.groups.flatMap((g) => g.items)
  const apps = new Set(nav.groups.find((g) => g.label === t('Apps'))?.items.map((i) => i.href))
  const searchGroups: SearchGroup[] = [
    { id: 'pages', label: t('Pages'), items: [...items.filter((i) => !apps.has(i.href)), ...nav.bottom] },
    { id: 'apps', label: t('Apps'), items: items.filter((i) => apps.has(i.href)) },
  ]
  return (
    // the search stays in the middle; the sides keep their content and the search gives way when the bar is narrow
    <header className="@container sticky top-0 z-20 grid h-[50px] shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,420px)_minmax(max-content,1fr)] items-center gap-3 bg-band px-4 text-band-foreground max-[900px]:flex">
      <div className="flex min-w-0 items-center gap-2">
        {(band.logo || isMobile) && <SidebarTrigger className={cn(bandIcon, 'size-8')} aria-label={t('Open or close the sidebar')} />}
        <div className="max-[900px]:hidden">
          <TenantSwitcher session={session} route={route} />
        </div>
      </div>
      {band.search ? <SearchBox session={session} route={route} groups={searchGroups} /> : <div className="max-[900px]:flex-1" />}
      <div className="flex items-center gap-1 justify-self-end">
        {band.lang && <LanguageMenu />}
        {band.mode && <ModeMenu route={route} />}
        {band.help && <HelpMenu session={session} route={route} />}
        <NotificationsBell session={session} route={route} />
        <UserMenu session={session} route={route} band={band} />
      </div>
    </header>
  )
}

export default function Shell({ session, route, children }: { session: Session; route: Route; children: ReactNode }) {
  const band = bandOf(session)
  useLiveNotes(session)
  return (
    <SidebarProvider defaultOpen={sidebarOpen()} className="min-h-svh">
      <AppSidebar session={session} route={route} band={band} />
      <SidebarInset className="min-w-0">
        <TopBar session={session} route={route} band={band} />
        <MaintenanceBanner admin={session.user.is_system_admin} />
        <div data-tour="content" className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
        <HelpLayer route={route} search={band.search} />
      </SidebarInset>
    </SidebarProvider>
  )
}
