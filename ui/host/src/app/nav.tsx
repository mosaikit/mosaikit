// The model of the navigation of the shell (phase 10): the entries per role, the pages of the apps from
// the `[[nav]]` of their manifests, the breadcrumb and the image under the band. Every layout draws the
// same model (slots.tsx, Shell.tsx, frames.tsx).

import type { CSSProperties, ReactNode } from 'react'
import { Activity, Building2, CalendarClock, Gauge, History, House, LayoutDashboard, LayoutGrid, Puzzle, Settings, Share2, ShieldCheck, Users } from 'lucide-react'
import type { PluginView, Session } from '../types.ts'
import AppIcon from './AppIcon.tsx'
import { useBrand } from '../brand.ts'
import { allItems, DEFAULT_GROUP_ICON, splitApps, type Grouped } from './navgroups.ts'
import type { SearchGroup } from './SearchBox.tsx'
import { isApp, useTenantCtx } from './core.ts'
import { lang, t } from './i18n.ts'
import { to, type Route } from './router.ts'


/** An entry of the navigation: a page of the shell, an app or a page of an app (`[[nav]]` of its
 *  manifest); an entry with children and no address is only a group. */
export interface NavItem {
  label: string
  /** short name under the icon, when the rail is closed */
  short?: string
  icon?: ReactNode
  href?: string
  active: boolean
  children?: NavItem[]
  /** id of the plugin of an app (to place it in a group of the distribution) */
  plugin?: string
}
export interface NavGroup {
  id: string
  label?: string
  /** the icon of the area (Project layout) */
  icon: ReactNode
  items: NavItem[]
  /** a group of the distribution: collapsible heading in the open sidebar, one icon and a menu in the closed one */
  collapsible?: boolean
  /** subgroups of a group of the distribution or of the layout of the tenant: indented under the apps of the group */
  subgroups?: NavGroup[]
}
export interface Nav {
  groups: NavGroup[]
  bottom: NavItem[]
}

/** The pages of an app from the `[[nav]]` of its manifest: entries at the top and their children. */
export function appChildren(slug: string, p: PluginView, route: Route): NavItem[] | undefined {
  const nav = p.nav ?? []
  if (!nav.length) return undefined
  const here = route.area === 'tenant' && route.page === 'plugin' && route.id === p.id ? (route.section ?? '') : null
  const item = (n: (typeof nav)[number]): NavItem => {
    const kids = nav.filter((c) => c.parent === n.id)
    const place = n.place ?? (kids.length ? undefined : n.id)
    return {
      label: n.label,
      icon: n.icon ? <AppIcon id="" name={n.icon} /> : undefined,
      href: place ? to.plugin(slug, p.id, place) : undefined,
      active: place != null && here === place,
      children: kids.length ? kids.map(item) : undefined,
    }
  }
  return nav.filter((n) => !n.parent).map(item)
}

export const hasActive = (it: NavItem): boolean => it.active || (it.children ?? []).some(hasActive)

/** The items of the navigation per role (docs/refactoring-ui.md §2): work, management of the scope, at the
 *  bottom the settings of the scope. The personal pages are in the menu of the person. */
export function useNav(session: Session, route: Route, grouped = false): Nav {
  const brandDefs = useBrand().nav_groups
  const slug = route.area === 'tenant' ? route.tenant : ''
  const ctx = useTenantCtx(slug)
  // the layout of the platform or of the tenant (Settings › Navigation), else the one of the distribution
  const own = ctx.data?.config?.['nav.layout']
  const defs = Array.isArray(own) ? (own as NonNullable<typeof brandDefs>) : brandDefs
  if (route.area === 'admin') {
    const page = route.page
    return {
      groups: [
        {
          id: 'start',
          label: t('Platform'),
          icon: <ShieldCheck />,
          items: [{ label: t('Platform overview'), short: t('Overview'), icon: <LayoutDashboard />, href: to.admin(), active: page === 'overview' }],
        },
        {
          id: 'platform',
          label: t('Platform'),
          icon: <ShieldCheck />,
          items: [
            { label: t('Tenants'), icon: <Building2 />, href: to.admin('tenants'), active: page === 'tenants' || page === 'tenant' },
            { label: t('People'), icon: <Users />, href: to.admin('people'), active: page === 'people' || page === 'person' },
            { label: t('Plugins'), icon: <Puzzle />, href: to.admin('plugins'), active: page === 'plugins' || page === 'plugin' },
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
    .filter((p) => isApp(p) && !hidden.has(p.id))
    .map((p) => {
      const children = appChildren(slug, p, route)
      return {
        plugin: p.id,
        label: p.label,
        icon: <AppIcon id={p.id} name={p.icon_name} />,
        href: to.plugin(slug, p.id),
        active: page === 'plugin' && route.id === p.id && !(children ?? []).some(hasActive),
        children,
      }
    })
  const groups: NavGroup[] = [
    {
      id: 'start',
      label: manager ? t('Tenant overview') : t('Home'),
      icon: <House />,
      items: [
        manager
          ? { label: t('Tenant overview'), short: t('Overview'), icon: <LayoutDashboard />, href: to.tenant(slug), active: page === 'home' }
          : { label: t('Home'), icon: <House />, href: to.tenant(slug), active: page === 'home' },
      ],
    },
    ...appGroups(apps, grouped ? defs : undefined),
  ]
  if (manager)
    groups.push({
      id: 'manage',
      label: t('Tenant management'),
      icon: <Building2 />,
      items: [
        { label: t('Manage'), icon: <Users />, href: to.tenant(slug, 'manage'), active: page === 'manage' || page === 'person' || page === 'group' },
        { label: t('Plugins'), icon: <Puzzle />, href: to.tenant(slug, 'plugins'), active: page === 'plugins' },
        { label: t('Shares'), icon: <Share2 />, href: to.tenant(slug, 'shares'), active: page === 'shares' },
        { label: t('Usage'), icon: <Gauge />, href: to.tenant(slug, 'usage'), active: page === 'usage' },
        { label: t('Schedules'), icon: <CalendarClock />, href: to.tenant(slug, 'schedules'), active: page === 'schedules' },
        { label: t('Log'), icon: <History />, href: to.tenant(slug, 'log'), active: page === 'log' },
      ],
    })
  return {
    groups: groups.filter((g) => g.items.length),
    bottom: manager ? [{ label: t('Tenant settings'), short: t('Settings'), icon: <Settings />, href: to.tenant(slug, 'settings'), active: page === 'settings' }] : [],
  }
}

/** The apps as one flat group, or, when the distribution declared groups (default sidebar only), its groups in
 *  their order and then the apps no group lists, flat. Layouts that do not ask for groups see the flat list. */
function appGroups(apps: NavItem[], defs: Parameters<typeof splitApps>[1]): NavGroup[] {
  const { groups, rest } = splitApps(apps, defs, lang())
  if (!groups.length) return [{ id: 'apps', label: t('Apps'), icon: <LayoutGrid />, items: apps }]
  const one = (g: Grouped<NavItem>): NavGroup => ({
    id: `dist:${g.def.id}`,
    label: g.label,
    icon: <AppIcon id="" name={g.def.icon} fallback={DEFAULT_GROUP_ICON} />,
    items: g.items,
    collapsible: true,
    ...(g.children ? { subgroups: g.children.map(one) } : {}),
  })
  return [
    ...groups.map(one),
    ...(rest.length ? [{ id: 'apps', label: t('Other apps'), icon: <LayoutGrid />, items: rest }] : []),
  ]
}

/** Every entry with an address, flat (for the search and the launcher). */
export function flat(items: NavItem[]): NavItem[] {
  return items.flatMap((i) => [...(i.href ? [i] : []), ...flat(i.children ?? [])])
}

/** The groups of the search box from the navigation. */
export function searchGroups(nav: Nav): SearchGroup[] {
  const isApps = (g: NavGroup) => g.id === 'apps' || g.collapsible
  const apps = nav.groups.filter(isApps).flatMap((g) => allItems(g))
  const pages = [...nav.groups.filter((g) => !isApps(g)).flatMap((g) => g.items), ...nav.bottom]
  return [
    { id: 'pages', label: t('Pages'), items: pages.map((i) => ({ label: i.label, icon: i.icon, href: i.href ?? '' })) },
    { id: 'apps', label: t('Apps'), items: flat(apps).map((i) => ({ label: i.label, icon: i.icon, href: i.href ?? '' })) },
  ]
}

/** Where the person is: area, page and the page of an app (in the band of the layouts that want it). */
export function useCrumbs(nav: Nav, route: Route): string[] {
  for (const g of nav.groups) {
    for (const it of g.items) {
      const trail = (n: NavItem): string[] | null => {
        if (n.active) return [n.label]
        for (const c of n.children ?? []) {
          const r = trail(c)
          if (r) return [n.label, ...r]
        }
        return null
      }
      const tr = trail(it)
      if (tr) return g.id === 'start' || g.id === 'platform' ? tr : [g.label ?? '', ...tr].filter(Boolean)
    }
  }
  for (const it of nav.bottom) if (it.active) return [it.label]
  const page = route.area === 'admin' || route.area === 'tenant' ? route.page : ''
  const personal: Record<string, string> = { account: t('Account'), notifications: t('Notifications'), trash: t('Trash'), requests: t('Requests'), item: t('Item') }
  return personal[page] ? [personal[page]] : []
}

export const bandIcon =
  'flex size-8 shrink-0 items-center justify-center rounded-md text-band-foreground/90 outline-none hover:bg-band-hover hover:text-band-foreground focus-visible:ring-2 focus-visible:ring-white/60 data-[state=open]:bg-band-hover'

/** The image under the band, as CSS variables of an element with `band-surface`. */
export function bandStyle(image: { src: string | null; scrim: number }): { style?: CSSProperties; 'data-band-image'?: string } {
  if (!image.src) return {}
  return { style: { '--band-image': `url("${image.src}")`, '--band-scrim': String(image.scrim) } as CSSProperties, 'data-band-image': 'on' }
}

