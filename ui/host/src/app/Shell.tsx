// The frame of the shell. The layout in use (layouts.ts) arranges the slots (slots.tsx): this file draws
// the built-in Teams layout, as in the mockup (docs/mockup) and according to docs/refactoring-ui.md: the
// logo in the corner above the sidebar (only the symbol when it is closed), the sidebar with icons or
// labels (a drawer with the whole tree on the phone), the top bar with the sidebar button, the tenant
// switcher, the search in the middle (Ctrl K) and on the right language, mode, help, bell and the menu of
// the person. Every other layout is drawn by frames.tsx. Logo, search, language, help and mode are
// turned on or off by the Administrator for everybody (System › Top bar).

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { MaintenanceBanner } from './pages/operations.tsx'
import { useBrand } from '../brand.ts'
import type { Session, ShellBand } from '../types.ts'
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { t } from './i18n.ts'
import { useLiveNotes } from './notes.ts'
import { bandOf, sidebarOpen } from './prefs.ts'
import { type Route } from './router.ts'
import { QuotaAlert } from './Quotas.tsx'
import { HelpLayer } from './HelpLayer.tsx'
import { useTenantCtx } from './core.ts'
import { applyStyle, bandImageOf, styleOf, useBandImage, useLayoutInUse, useLayoutStylesheet } from './layouts.ts'
import { AppMark, BandActions, BandSearch, FlyoutMenu, SkipLink, TenantSwitcher } from './slots.tsx'
import { bandIcon, bandStyle, hasActive, useNav, type NavItem } from './nav.tsx'
import Frame from './frames.tsx'

export { AppMark, TenantBadge } from './slots.tsx'

const railButton = cn(
  // open, as in the mockup: 14px, active item on white with the accent
  '[&>svg]:fill-current [&>svg]:[fill-opacity:0.1] data-[active=true]:[&>svg]:[fill-opacity:0.2] hover:[&>svg]:[fill-opacity:0.16]',
  'msk-nav-item relative h-10 gap-2.5 rounded-[8px] px-2.5 text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground [&>svg]:size-5',
  // closed, like the Teams bar: icon and name below, grey (--rail-foreground); the active item
  // and the one under the mouse in the accent colour, the active one with the bar on the left too
  'group-data-[collapsible=icon]:h-[56px]! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-1.5 group-data-[collapsible=icon]:rounded-none group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:bg-transparent! group-data-[collapsible=icon]:font-normal! group-data-[collapsible=icon]:text-rail-foreground group-data-[collapsible=icon]:hover:text-sidebar-primary group-data-[collapsible=icon]:data-[active=true]:text-sidebar-primary group-data-[collapsible=icon]:[&>svg]:size-5 group-data-[collapsible=icon]:[&>svg]:stroke-[1.6]',
  'group-data-[collapsible=icon]:[&>span:last-child]:block group-data-[collapsible=icon]:[&>span:last-child]:max-w-[60px] group-data-[collapsible=icon]:[&>span:last-child]:truncate group-data-[collapsible=icon]:[&>span:last-child]:text-center group-data-[collapsible=icon]:[&>span:last-child]:text-[10px] group-data-[collapsible=icon]:[&>span:last-child]:leading-3',
  "group-data-[collapsible=icon]:data-[active=true]:before:absolute group-data-[collapsible=icon]:data-[active=true]:before:inset-y-2 group-data-[collapsible=icon]:data-[active=true]:before:left-0 group-data-[collapsible=icon]:data-[active=true]:before:w-[3px] group-data-[collapsible=icon]:data-[active=true]:before:rounded-r-[3px] group-data-[collapsible=icon]:data-[active=true]:before:bg-sidebar-primary group-data-[collapsible=icon]:data-[active=true]:before:content-['']",
)

/** The pages of an app under it, in the open sidebar and in the drawer of the phone. */
function SubTree({ items, onPick, depth = 0 }: { items: NavItem[]; onPick: () => void; depth?: number }) {
  return (
    <SidebarMenuSub className={cn(depth > 0 ? 'mr-0 pr-0' : 'ml-[22px]')}>
      {items.map((c) => (
        <SidebarMenuSubItem key={c.label + (c.href ?? '')}>
          {c.href ? (
            <SidebarMenuSubButton asChild isActive={c.active}>
              <a href={c.href} aria-current={c.active ? 'page' : undefined} onClick={onPick}>
                <span>{c.label}</span>
              </a>
            </SidebarMenuSubButton>
          ) : (
            <span className="flex h-7 items-center px-2 text-xs font-medium text-sidebar-foreground/85">{c.label}</span>
          )}
          {c.children && <SubTree items={c.children} onPick={onPick} depth={depth + 1} />}
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  )
}

function RailEntry({ it }: { it: NavItem }) {
  const { isMobile, setOpenMobile, state } = useSidebar()
  const rail = state === 'collapsed' && !isMobile
  // on the phone the whole tree is open; in the open sidebar the app of the active page
  const [open, setOpen] = useState(() => hasActive(it))
  const pick = () => isMobile && setOpenMobile(false)
  const kids = it.children ?? []
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={hasActive(it)} className={railButton}>
        <a href={it.href} aria-label={rail && it.short ? it.label : undefined} title={rail && it.short ? it.label : undefined} onClick={pick}>
          {it.icon}
          <span>{rail ? (it.short ?? it.label) : it.label}</span>
        </a>
      </SidebarMenuButton>
      {kids.length > 0 && rail && (
        // the closed rail: the link opens the app, the small arrow its pages in a menu at the side
        <FlyoutMenu
          item={it}
          trigger={
            <button
              type="button"
              className="msk-nav-toggle absolute top-1 right-0.5 flex size-5 items-center justify-center rounded text-rail-foreground hover:bg-sidebar-hover hover:text-sidebar-primary focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              aria-label={t('Open the pages of {name}', { name: it.label })}
              title={t('Open the pages of {name}', { name: it.label })}
            >
              <ChevronRight className="size-3.5" />
            </button>
          }
        />
      )}
      {kids.length > 0 && !rail && (
        <>
          <button
            type="button"
            className="msk-nav-toggle absolute top-1 right-1 flex size-8 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-expanded={open || isMobile}
            aria-label={open || isMobile ? t('Close the pages of {name}', { name: it.label }) : t('Open the pages of {name}', { name: it.label })}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown className={cn('size-4 transition-transform', !(open || isMobile) && '-rotate-90')} />
          </button>
          {(open || isMobile) && <SubTree items={kids} onPick={pick} />}
        </>
      )}
    </SidebarMenuItem>
  )
}

function NavList({ items }: { items: NavItem[] }) {
  return (
    // closed, like Teams: one item every 56px, without space between them
    <SidebarMenu className="group-data-[collapsible=icon]:gap-0">
      {items.map((it) => (
        <RailEntry key={it.label + (it.href ?? '')} it={it} />
      ))}
    </SidebarMenu>
  )
}

function AppSidebar({ session, route, band }: { session: Session; route: Route; band: ShellBand }) {
  const brand = useBrand()
  const { isMobile, state } = useSidebar()
  const nav = useNav(session, route)
  const admin = session.user.is_system_admin
  const manager = route.area === 'tenant' && session.memberships.find((m) => m.slug === route.tenant)?.role === 'tenant_manager'
  return (
    // the right border is drawn by the parts: light on the top bar, grey below
    <Sidebar collapsible="icon" className="msk-nav msk-hoverscroll border-r-0!" data-tour="sidebar">
      {isMobile && !admin ? (
        // on the phone the drawer starts with the tenant switcher (manager and user)
        <SidebarHeader className="border-b p-2">
          <TenantSwitcher session={session} route={route} variant="sidebar" />
        </SidebarHeader>
      ) : (
        <SidebarHeader className="band-surface h-[50px] flex-row items-center gap-2.5 border-r border-b border-band-line bg-band px-4 text-band-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
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
      <SidebarContent className="msk-hoverscroll border-r border-sidebar-border pt-1 group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:pt-0">
        {nav.groups.map((g) => (
          <SidebarGroup key={g.id} className="py-1 first:pt-0 last:pb-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:not-first:mt-3 group-data-[collapsible=icon]:not-first:border-t group-data-[collapsible=icon]:not-first:border-sidebar-border group-data-[collapsible=icon]:not-first:pt-1">
            {g.id === 'apps' || g.id === 'manage' ? <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">{g.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <NavList items={g.items} />
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-r border-sidebar-border pt-1 pb-1 group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-0">
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

function TopBar({ session, route, band, bandImage }: { session: Session; route: Route; band: ShellBand; bandImage: { src: string | null; scrim: number } }) {
  const nav = useNav(session, route)
  const { isMobile } = useSidebar()
  return (
    // the search stays in the middle; the sides keep their content and the search gives way when the bar is narrow
    <header
      className="msk-band band-surface @container sticky top-0 z-20 grid h-[50px] shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,420px)_minmax(max-content,1fr)] items-center gap-3 bg-band px-4 text-band-foreground max-[900px]:flex"
      {...bandStyle(bandImage)}
    >
      <div className="flex min-w-0 items-center gap-2">
        {(band.logo || isMobile) && <SidebarTrigger className={cn(bandIcon, 'size-8')} aria-label={t('Open or close the sidebar')} />}
        <div className="max-[900px]:hidden">
          <TenantSwitcher session={session} route={route} />
        </div>
      </div>
      {band.search ? <BandSearch session={session} route={route} nav={nav} /> : <div className="max-[900px]:flex-1" />}
      <div className="justify-self-end">
        <BandActions session={session} route={route} band={band} />
      </div>
    </header>
  )
}

/** The rail of Teams (the built-in layout): the sidebar of shadcn, closed to icons or open. */
function RailFrame({ session, route, band, bandImage, children }: { session: Session; route: Route; band: ShellBand; bandImage: { src: string | null; scrim: number }; children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen={sidebarOpen()} className="min-h-svh">
      <SkipLink />
      <AppSidebar session={session} route={route} band={band} />
      <SidebarInset className="min-w-0">
        <TopBar session={session} route={route} band={band} bandImage={bandImage} />
        <MaintenanceBanner admin={session.user.is_system_admin} />
        <div id="main" tabIndex={-1} data-tour="content" className="msk-main flex min-h-0 flex-1 flex-col outline-none">
          {children}
        </div>
        <HelpLayer route={route} search={band.search} />
      </SidebarInset>
    </SidebarProvider>
  )
}

export default function Shell({ session, route, children }: { session: Session; route: Route; children: ReactNode }) {
  const band = bandOf(session)
  useLiveNotes(session)
  const layout = useLayoutInUse(session, route)
  const ctx = useTenantCtx(route.area === 'tenant' ? route.tenant : '')
  const config = route.area === 'tenant' ? ctx.data?.config : session.config
  const style = styleOf(config, layout)
  const bandImage = useBandImage(bandImageOf(config, layout, route.area === 'tenant' ? route.tenant : undefined))
  useLayoutStylesheet(layout)
  useEffect(() => applyStyle(style, layout), [style, layout])
  return (
    <div className={cn('msk-shell contents', layout.class)} data-layout={layout.id}>
      {layout.decl.pattern === 'rail' ? (
        <RailFrame session={session} route={route} band={band} bandImage={bandImage}>
          {children}
        </RailFrame>
      ) : (
        <Frame session={session} route={route} band={band} layout={layout} bandImage={bandImage}>
          {children}
        </Frame>
      )}
    </div>
  )
}
