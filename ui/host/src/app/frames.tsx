// The layouts other than the rail of Teams (phase 10): the same slots (slots.tsx) arranged as the layout
// asks, from the vocabulary of the shell (`pattern` of `layout.toml`):
//   sidebar  — the band with the breadcrumb, a sidebar (a floating card for Console) with groups that open;
//   drawer   — a top bar with a wide search, a drawer that opens and closes;
//   launcher — a grid of all apps and pages, a bar with the pages of the area under the band;
//   areas    — global areas at the left, the sidebar of the area next to it;
//   tabs     — apps and pages as tabs under the band, a menu for the pages of an app.
// On a phone (< 900 px) every layout opens its navigation in a drawer with the whole tree (or, for a
// launcher layout, in the launcher). Landmarks, the skip link and the order of the keyboard are the same
// in every layout: skip link, band (header), navigation (nav), content (main).

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, Menu, PanelLeft } from 'lucide-react'
import type { Session, ShellBand } from '../types.ts'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { t } from './i18n.ts'
import { HelpLayer } from './HelpLayer.tsx'
import { MaintenanceBanner } from './pages/operations.tsx'
import { QuotaAlert } from './Quotas.tsx'
import type { Route } from './router.ts'
import type { LayoutInfo } from './layouts.ts'
import { BandActions, BandSearch, Brand, Breadcrumb, FlyoutMenu, NavTree, SkipLink, TenantSwitcher } from './slots.tsx'
import { bandIcon, bandStyle, flat, hasActive, useCrumbs, useNav, type Nav, type NavGroup, type NavItem } from './nav.tsx'

const MINI_KEY = 'msk_layout_nav_closed'
function readMini(): boolean {
  try {
    return localStorage.getItem(MINI_KEY) === '1'
  } catch {
    return false
  }
}
function saveMini(v: boolean) {
  try {
    localStorage.setItem(MINI_KEY, v ? '1' : '0')
  } catch {
    /* storage not available */
  }
}

interface FrameProps {
  session: Session
  route: Route
  band: ShellBand
  layout: LayoutInfo
  bandImage: { src: string | null; scrim: number }
  children: ReactNode
}

/** The drawer of the phone: the tenant at the top, then the whole tree. */
function PhoneDrawer({ open, onOpenChange, session, route, nav }: { open: boolean; onOpenChange: (v: boolean) => void; session: Session; route: Route; nav: Nav }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="msk-nav w-[min(320px,85vw)] gap-0 bg-sidebar p-0 text-sidebar-foreground">
        <SheetTitle className="sr-only">{t('Navigation')}</SheetTitle>
        <SheetDescription className="sr-only">{t('The pages and the apps')}</SheetDescription>
        <div className="border-b border-sidebar-border p-2 pr-10">
          <TenantSwitcher session={session} route={route} variant="sidebar" />
        </div>
        <QuotaSlot route={route} session={session} />
        <NavTree groups={nav.groups} bottom={nav.bottom} onPick={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  )
}

function QuotaSlot({ session, route, compact }: { session: Session; route: Route; compact?: boolean }) {
  if (route.area !== 'tenant') return null
  const manager = session.memberships.find((m) => m.slug === route.tenant)?.role === 'tenant_manager'
  return (
    <div className="px-2 pt-2 empty:hidden">
      <QuotaAlert slug={route.tenant} manager={manager} compact={compact} />
    </div>
  )
}

/** The launcher: every app and page as a tile, by group (Suite layout, and its phone). */
function Launcher({ open, onOpenChange, nav }: { open: boolean; onOpenChange: (v: boolean) => void; nav: Nav }) {
  const groups: NavGroup[] = [...nav.groups, ...(nav.bottom.length ? [{ id: 'bottom', label: t('Settings'), icon: null, items: nav.bottom }] : [])]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="msk-launcher max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>{t('All apps and pages')}</DialogTitle>
        <DialogDescription className="sr-only">{t('Open an app or a page')}</DialogDescription>
        {groups.map((g) => (
          <section key={g.id} aria-label={g.label}>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{g.label}</h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {flat(g.items).map((it) => (
                <li key={it.label + it.href}>
                  <a
                    href={it.href}
                    onClick={() => onOpenChange(false)}
                    aria-current={it.active ? 'page' : undefined}
                    className={cn(
                      'msk-launcher-tile flex h-16 items-center gap-3 rounded-lg border px-3 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-5 [&>svg]:shrink-0',
                      it.active && 'border-primary font-semibold',
                    )}
                  >
                    {it.icon}
                    <span className="line-clamp-2">{it.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  )
}

/** A tab of the Tabs and Suite layouts: a page, or an app with pages that opens a menu. */
function TabItem({ it }: { it: NavItem }) {
  const cls = (on: boolean) =>
    cn(
      'msk-tab-item relative flex h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm whitespace-nowrap text-foreground/80 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-4',
      on && "font-semibold text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary after:content-['']",
    )
  if (it.children?.length)
    return (
      <li>
        <FlyoutMenu
          side="bottom"
          item={it}
          trigger={
            <button type="button" className={cls(hasActive(it))}>
              {it.icon}
              {it.label}
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
          }
        />
      </li>
    )
  return (
    <li>
      <a href={it.href} className={cls(it.active)} aria-current={it.active ? 'page' : undefined}>
        {it.icon}
        {it.label}
      </a>
    </li>
  )
}

export default function Frame({ session, route, band, layout, bandImage, children }: FrameProps) {
  const nav = useNav(session, route)
  const crumbs = useCrumbs(nav, route)
  const phone = useIsMobile()
  const [drawer, setDrawer] = useState(false)
  const [launcher, setLauncher] = useState(false)
  const [mini, setMiniState] = useState(readMini)
  const setMini = (v: boolean) => {
    setMiniState(v)
    saveMini(v)
  }
  const d = layout.decl
  const pattern = d.pattern
  // the area of the Project layout: the group of the active page, or the one chosen
  const activeGroup = nav.groups.find((g) => g.items.some(hasActive))?.id ?? nav.groups[0]?.id
  const [area, setArea] = useState<string | undefined>(undefined)
  const shownArea = nav.groups.find((g) => g.id === (area ?? activeGroup)) ?? nav.groups[0]
  const phoneNav = () => (d.phone.nav === 'launcher' ? setLauncher(true) : setDrawer(true))
  const wideSearch = d.band.search === 'wide'

  const navToggle =
    pattern === 'drawer' && !phone ? (
      <button type="button" className={bandIcon} aria-expanded={!mini} aria-controls="msk-nav" aria-label={mini ? t('Open the navigation') : t('Close the navigation')} onClick={() => setMini(!mini)}>
        <Menu className="size-[18px]" />
      </button>
    ) : pattern === 'launcher' && !phone ? (
      <button type="button" className={bandIcon} aria-haspopup="dialog" aria-label={t('All apps and pages')} onClick={() => setLauncher(true)}>
        <LayoutGrid className="size-[18px]" />
      </button>
    ) : null

  const header = (
    <header className={cn('msk-band band-surface sticky top-0 z-20 flex h-[50px] shrink-0 items-center gap-3 bg-band px-4 text-band-foreground', pattern === 'sidebar' && 'h-[56px]')} {...bandStyle(bandImage)}>
      {phone && (
        <button type="button" className={bandIcon} aria-haspopup="dialog" aria-label={t('Open the navigation')} onClick={phoneNav}>
          <Menu className="size-[18px]" />
        </button>
      )}
      {navToggle}
      {(band.logo || !phone) && d.band.brand && <Brand compact={phone} />}
      {d.band.tenant === 'band' && !phone && <TenantSwitcher session={session} route={route} />}
      {d.band.breadcrumb && !phone && (
        <>
          <span aria-hidden="true" className="h-5 w-px bg-band-line" />
          <Breadcrumb crumbs={crumbs} />
        </>
      )}
      <div className={cn('flex min-w-0 flex-1', wideSearch ? 'justify-start' : 'justify-center')}>
        {band.search && (
          <div className={cn('@container w-full', wideSearch ? 'max-w-[720px]' : 'max-w-[420px]')}>
            <BandSearch session={session} route={route} nav={nav} />
          </div>
        )}
      </div>
      <BandActions session={session} route={route} band={band} />
    </header>
  )

  const main = (
    <main id="main" tabIndex={-1} data-tour="content" className="msk-main relative flex min-h-0 min-w-0 flex-1 flex-col bg-background outline-none">
      <MaintenanceBanner admin={session.user.is_system_admin} />
      {children}
    </main>
  )

  let body: ReactNode
  if (phone) {
    body = main
  } else if (pattern === 'sidebar' || pattern === 'drawer') {
    const card = d.nav.card
    const closed = pattern === 'drawer' && mini
    body = (
      <div className={cn('flex min-h-0 flex-1', card && 'bg-pane')}>
        {!closed && (
          <nav
            id="msk-nav"
            aria-label={t('Navigation')}
            data-tour="sidebar"
            className={cn(
              'msk-nav msk-hoverscroll sticky flex shrink-0 flex-col self-start overflow-hidden bg-sidebar text-sidebar-foreground',
              card
                ? 'top-[68px] m-3 mr-0 h-[calc(100svh-80px)] rounded-xl border border-sidebar-border shadow-sm'
                : cn('border-r border-sidebar-border', pattern === 'sidebar' ? 'top-[56px] h-[calc(100svh-56px)]' : 'top-[50px] h-[calc(100svh-50px)]'),
              pattern === 'sidebar' && mini ? 'w-[60px]' : 'w-60',
            )}
          >
            {pattern === 'sidebar' && (
              <div className={cn('flex items-center border-b border-sidebar-border p-2', mini ? 'justify-center' : 'justify-between')}>
                {!mini && d.band.tenant === 'nav' && (
                  <div className="min-w-0 flex-1">
                    <div className="px-2 pt-1 text-[11px] font-medium tracking-wide text-sidebar-foreground/85 uppercase">{session.user.is_system_admin ? t('Platform') : t('Tenant')}</div>
                    <TenantSwitcher session={session} route={route} variant="sidebar" />
                  </div>
                )}
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  aria-expanded={!mini}
                  aria-label={mini ? t('Open the sidebar') : t('Close the sidebar')}
                  onClick={() => setMini(!mini)}
                >
                  {mini ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
                </button>
              </div>
            )}
            {pattern === 'drawer' && d.band.tenant === 'nav' && (
              <div className="border-b border-sidebar-border p-2">
                <TenantSwitcher session={session} route={route} variant="sidebar" />
              </div>
            )}
            <QuotaSlot session={session} route={route} compact={mini} />
            <NavTree groups={nav.groups} bottom={nav.bottom} mini={pattern === 'sidebar' && mini} />
          </nav>
        )}
        {card ? <div className="m-3 flex min-w-0 flex-1 flex-col rounded-xl border bg-background">{main}</div> : main}
      </div>
    )
  } else if (pattern === 'areas') {
    body = (
      <div className="flex min-h-0 flex-1">
        <nav id="msk-nav" aria-label={t('Navigation')} data-tour="sidebar" className="msk-nav msk-hoverscroll msk-areas sticky top-[50px] flex h-[calc(100svh-50px)] shrink-0 self-start bg-sidebar text-sidebar-foreground">
          <div role="tablist" aria-label={t('Areas')} aria-orientation="vertical" className="flex w-[72px] flex-col items-center gap-1 border-r border-sidebar-border bg-band py-2 text-band-foreground">
            {[...nav.groups, ...(nav.bottom.length ? [{ id: 'bottom', label: t('Settings'), icon: nav.bottom[0].icon, items: nav.bottom }] : [])].map((g) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={g.id === shownArea?.id}
                aria-controls="msk-area"
                onClick={() => (g.id === 'bottom' ? g.items[0]?.href && (window.location.hash = g.items[0].href) : setArea(g.id))}
                className={cn(
                  'msk-area flex w-16 flex-col items-center gap-1 rounded-md py-2 text-[10px] leading-3 outline-none hover:bg-band-hover focus-visible:ring-2 focus-visible:ring-white/60 [&>svg]:size-5',
                  g.id === shownArea?.id && 'bg-band-hover font-semibold',
                )}
              >
                {g.icon}
                <span className="max-w-[60px] truncate">{g.label}</span>
              </button>
            ))}
          </div>
          <div id="msk-area" role="tabpanel" aria-label={shownArea?.label} className="flex w-56 flex-col border-r border-sidebar-border">
            <div className="px-4 pt-3 pb-1 text-sm font-semibold">{shownArea?.label}</div>
            {d.band.tenant === 'nav' && (
              <div className="px-2">
                <TenantSwitcher session={session} route={route} variant="sidebar" />
              </div>
            )}
            <QuotaSlot session={session} route={route} />
            {shownArea && <NavTree groups={[{ ...shownArea, label: undefined }]} labels={false} />}
          </div>
        </nav>
        {main}
      </div>
    )
  } else {
    // tabs and launcher: a bar under the band
    const items = pattern === 'tabs' ? [...nav.groups.flatMap((g) => g.items), ...nav.bottom] : (nav.groups.find((g) => g.items.some(hasActive))?.items ?? nav.bottom)
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <nav aria-label={pattern === 'tabs' ? t('Navigation') : t('Pages of the area')} data-tour="sidebar" className="msk-nav msk-tabs sticky top-[50px] z-10 flex shrink-0 items-center gap-2 overflow-x-auto border-b bg-background px-3">
          {pattern === 'launcher' && <PanelLeft aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
          <ul className="flex items-center gap-1">
            {items.map((it) => (
              <TabItem key={it.label + (it.href ?? '')} it={it} />
            ))}
          </ul>
        </nav>
        <QuotaSlot session={session} route={route} />
        {main}
      </div>
    )
  }

  return (
    <div className="msk-frame flex min-h-svh flex-col">
      <SkipLink />
      {header}
      {body}
      <PhoneDrawer open={drawer} onOpenChange={setDrawer} session={session} route={route} nav={nav} />
      <Launcher open={launcher} onOpenChange={setLauncher} nav={nav} />
      <HelpLayer route={route} search={band.search} />
    </div>
  )
}
