// La cornice della shell, come nel mockup (docs/mockup) e secondo docs/refactoring-ui.md: il logo
// nell'angolo sopra la sidebar (solo il simbolo quando e' chiusa), la sidebar a icone o con etichette
// (pannello sul telefono) con il lavoro e la gestione dell'ambito, la barra in alto con il pulsante della
// sidebar, il selettore del tenant, la ricerca al centro (Ctrl K) e a destra lingua, tonalita', aiuto,
// campanella e menu della persona (Account, Notifiche, Esci). Logo, ricerca, lingua, aiuto e tonalita'
// li accende o spegne l'Administrator per tutti (Sistema › Barra in alto).

import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  CirclePlay,
  Contrast,
  Gauge,
  House,
  KeyRound,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Puzzle,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react'
import { api } from '../api.ts'
import { useBrand } from '../brand.ts'
import type { Session, ShellBand } from '../types.ts'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
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
import { LANGS, setLang, t, useLang, type Lang } from './i18n.ts'
import { NotificationsBell } from './notifications.tsx'
import { useNotes } from './notes.ts'
import { bandOf, sidebarOpen } from './prefs.ts'
import { go, personal, to, type Route } from './router.ts'
import { markSvg, type MarkVariant } from './mark.ts'
import { effectiveMode, setTheme, useTheme, type Mode } from './theme.ts'

/** Il simbolo dell'applicazione (o il logo del marchio), come nella favicon (mark.ts): `negative` sulla
 *  barra e sul pannello dell'accesso, sempre scuri; altrove segue il modo chiaro o scuro. */
export function AppMark({ className, variant }: { className?: string; variant?: MarkVariant }) {
  const brand = useBrand()
  const th = useTheme()
  if (brand.logo) return <img src="brand/logo" alt="" className={cn('size-7 object-contain', className)} />
  const v = variant ?? (effectiveMode(th) === 'dark' ? 'negative' : 'positive')
  return <span aria-hidden="true" className={cn('block size-7 shrink-0 [&>svg]:size-full', className)} dangerouslySetInnerHTML={{ __html: markSvg(v) }} />
}

interface NavItem {
  label: string
  /** nome breve sotto l'icona, quando la sidebar e' chiusa */
  short?: string
  icon: ReactNode
  href: string
  active: boolean
}
interface NavGroup {
  label?: string
  items: NavItem[]
}

/** Le voci della sidebar per ruolo (docs/refactoring-ui.md §2): lavoro, gestione dell'ambito, in fondo
 *  le impostazioni dell'ambito. Le pagine personali stanno nel menu della persona. */
function useNav(session: Session, route: Route): { groups: NavGroup[]; bottom: NavItem[] } {
  const slug = route.area === 'tenant' ? route.tenant : ''
  const ctx = useTenantCtx(slug)
  if (route.area === 'admin') {
    const page = route.page
    return {
      groups: [
        {
          items: [
            { label: t('Panoramica della piattaforma'), short: t('Panoramica'), icon: <LayoutDashboard />, href: to.admin(), active: page === 'overview' },
            { label: t('Tenant'), icon: <Building2 />, href: to.admin('tenants'), active: page === 'tenants' || page === 'tenant' },
            { label: t('Plugin'), icon: <Puzzle />, href: to.admin('plugins'), active: page === 'plugins' },
          ],
        },
      ],
      bottom: [{ label: t('Sistema'), icon: <Settings />, href: to.admin('system'), active: page === 'system' }],
    }
  }
  if (route.area !== 'tenant') return { groups: [], bottom: [] }
  const manager = session.memberships.find((m) => m.slug === slug)?.role === 'tenant_manager'
  const hidden = new Set(ctx.data?.prefs.hidden ?? [])
  const page = route.page
  const apps: NavItem[] = (ctx.data?.plugins ?? [])
    .filter((p) => p.has_ui && !hidden.has(p.id))
    .map((p) => ({ label: p.label, icon: <AppIcon id={p.id} />, href: to.plugin(slug, p.id), active: page === 'plugin' && route.id === p.id }))
  const groups: NavGroup[] = [
    {
      items: [
        manager
          ? { label: t('Panoramica del tenant'), short: t('Panoramica'), icon: <LayoutDashboard />, href: to.tenant(slug), active: page === 'home' }
          : { label: t('Home'), icon: <House />, href: to.tenant(slug), active: page === 'home' },
      ],
    },
    { label: t('App'), items: apps },
  ]
  if (manager)
    groups.push({
      label: t('Gestione del tenant'),
      items: [
        { label: t('Gestisci'), icon: <Users />, href: to.tenant(slug, 'manage'), active: page === 'manage' },
        { label: t('Plugin'), icon: <Puzzle />, href: to.tenant(slug, 'plugins'), active: page === 'plugins' },
        { label: t('Condivisioni'), icon: <Share2 />, href: to.tenant(slug, 'shares'), active: page === 'shares' },
        { label: t('Consumi'), icon: <Gauge />, href: to.tenant(slug, 'usage'), active: page === 'usage' },
      ],
    })
  return {
    groups: groups.filter((g) => g.items.length),
    bottom: manager ? [{ label: t('Impostazioni del tenant'), short: t('Impostazioni'), icon: <Settings />, href: to.tenant(slug, 'settings'), active: page === 'settings' }] : [],
  }
}

function NavList({ items }: { items: NavItem[] }) {
  const { isMobile, setOpenMobile, state } = useSidebar()
  const rail = state === 'collapsed' && !isMobile
  return (
    // chiusa, come Teams: una voce ogni 56px, senza spazio fra l'una e l'altra
    <SidebarMenu className="group-data-[collapsible=icon]:gap-0">
      {items.map((it) => (
        <SidebarMenuItem key={it.href}>
          <SidebarMenuButton
            asChild
            isActive={it.active}
            className={cn(
              // aperta, come nel mockup: 14px, voce attiva su bianco con l'accento
              '[&>svg]:fill-current [&>svg]:[fill-opacity:0.1] data-[active=true]:[&>svg]:[fill-opacity:0.2] hover:[&>svg]:[fill-opacity:0.16]',
              'relative h-10 gap-2.5 rounded-[8px] px-2.5 text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground [&>svg]:size-5',
              // chiusa, come la barra di Teams: icona e nome sotto, grigi (--rail-foreground); la voce attiva
              // e quella sotto il mouse col colore di accento, l'attiva anche con la barretta a sinistra
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
  const { isMobile } = useSidebar()
  const nav = useNav(session, route)
  const admin = session.user.is_system_admin
  return (
    // il bordo destro e' disegnato dalle parti: chiaro sulla barra in alto, grigio sotto
    <Sidebar collapsible="icon" className="border-r-0!">
      {isMobile && !admin ? (
        // sul telefono il pannello comincia dal selettore del tenant (gestore e utente)
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
            // senza logo, il pulsante della sidebar ne prende il posto
            <SidebarTrigger className={cn(bandIcon, 'size-8 -ml-1.5 group-data-[collapsible=icon]:ml-0')} aria-label={t('Apri o chiudi la sidebar')} />
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
        <NavList items={nav.bottom} />
      </SidebarFooter>
    </Sidebar>
  )
}

/** Il tenant attivo, con il menu per cambiarlo (solo se i tenant sono piu' d'uno). L'Administrator
 *  lavora sulla piattaforma: lo dice un badge fisso, senza menu. */
function TenantSwitcher({ session, route, variant = 'band' }: { session: Session; route: Route; variant?: 'band' | 'sidebar' }) {
  const band = variant === 'band'
  if (session.user.is_system_admin)
    return (
      <span
        title={t('L’Administrator lavora sulla piattaforma, non dentro un tenant')}
        className={cn('flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold', band ? 'bg-white/15 text-band-foreground ring-1 ring-white/25' : 'bg-primary/10 text-primary-strong')}
      >
        <ShieldCheck className="size-4" />
        {t('Piattaforma')}
      </span>
    )
  const slug = route.area === 'tenant' ? route.tenant : ''
  const cur = session.memberships.find((m) => m.slug === slug)
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
        <TenantBadge name={cur?.name ?? '?'} />
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
        aria-label={t('Tenant: {name}. Cambia tenant', { name: cur?.name ?? '' })}
      >
        <TenantBadge name={cur?.name ?? '?'} />
        <span className={cn('truncate', band ? 'max-w-44' : 'flex-1 text-left')}>{cur?.name ?? 'Tenant'}</span>
        <ChevronDown className="size-4 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">{t('Appartenenza')}</DropdownMenuLabel>
        {home.map(item)}
        {guest.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">{t('Ospite in')}</DropdownMenuLabel>
            {guest.map(item)}
          </>
        )}
        <DropdownMenuSeparator />
        <p className="flex gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" />
          {t('Accedi sempre con le credenziali di {home}: cambiare tenant non chiede di rientrare.', { home: home[0]?.name ?? '' })}
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

/** La tonalita' per se': chiaro, scuro o automatico; tema e altre preferenze stanno in Account. */
function ModeMenu({ route }: { route: Route }) {
  const th = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={bandIcon} aria-label={t('Tonalità')} title={t('Tonalità: chiaro, scuro o automatico')}>
        <Contrast className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">{t('Tonalità')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={th.mode} onValueChange={(v) => setTheme({ mode: v as Mode })}>
          <DropdownMenuRadioItem value="light">{t('Chiaro')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('Scuro')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="auto">{t('Automatico')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => go(personal(route, 'account', 'appearance'))}>
          <Settings />
          {t('Tema e altre preferenze')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LanguageMenu() {
  const lang = useLang()
  const name = LANGS.find((l) => l.id === lang)?.name ?? lang
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(bandIcon, 'font-mono text-xs font-semibold')} aria-label={`${lang.toUpperCase()} · ${t('Lingua: {name}', { name })}`} title={t('Lingua: {name}', { name })}>
        {lang.toUpperCase()}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">{t('Lingua')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)}>
          {LANGS.map((l) => (
            <DropdownMenuRadioItem key={l.id} value={l.id}>
              {l.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Le voci dell'aiuto, come nel mockup: nella barra (menu ?) o, se l'aiuto e' spento, nel menu della persona. */
function useHelpItems() {
  const brand = useBrand()
  return [
    { icon: CirclePlay, label: t('Tour guidato di questa pagina') },
    { icon: CircleHelp, label: t('Guida di Mosaikit') },
    { icon: Sparkles, label: t('Novità della versione {v}', { v: brand.version || '1.0' }) },
    { icon: Keyboard, label: t('Scorciatoie da tastiera') },
  ].map((x) => ({ ...x, run: () => toast.info(t('Nel prodotto: {what}.', { what: x.label.toLowerCase() })) }))
}

function HelpMenu() {
  const brand = useBrand()
  const items = useHelpItems()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={bandIcon} aria-label={t('Aiuto')} title={t('Aiuto e versione')}>
        <CircleHelp className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {items.map((x) => (
          <DropdownMenuItem key={x.label} onSelect={x.run}>
            <x.icon />
            {x.label}
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

/** Il menu della persona: Account, Notifiche, Esci (e l'aiuto, se la barra non lo mostra). */
function UserMenu({ session, route, band }: { session: Session; route: Route; band: ShellBand }) {
  const qc = useQueryClient()
  const notes = useNotes(session)
  const help = useHelpItems()
  const u = session.user
  const name = u.display_name || u.username
  async function logout() {
    try {
      await api('POST', '/api/auth/logout')
    } catch {
      /* sessione gia' chiusa */
    }
    qc.setQueryData(['session'], null)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' })
    go(u.is_system_admin ? '#/admin' : '#/')
  }
  const role = u.is_system_admin ? 'Administrator' : roleOf(session, route)
  const tenant = route.area === 'tenant' ? session.memberships.find((m) => m.slug === route.tenant)?.name : t('Piattaforma')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md py-0.5 pr-0.5 pl-2 text-band-foreground outline-none hover:bg-band-hover focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {/* the name comes from the content, so it always holds the visible text (WCAG 2.5.3); on a
            narrow bar person and role are sr-only */}
        <span className="sr-only text-right leading-tight min-[1100px]:not-sr-only min-[1100px]:block">
          <span className="block text-[13px] font-semibold">{name}</span>
          <span className="block text-[11px] text-band-muted">{role}</span>
        </span>
        <span className="sr-only">{t('menu della persona')}</span>
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
          <span className="flex-1">{t('Notifiche')}</span>
          {notes.unread > 0 && <span className="text-xs text-muted-foreground">{t('{n} nuove', { n: String(notes.unread) })}</span>}
        </DropdownMenuItem>
        {!band.help && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">{t('Aiuto')}</DropdownMenuLabel>
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
          {t('Esci')}
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
  const apps = new Set(nav.groups.find((g) => g.label === t('App'))?.items.map((i) => i.href))
  const searchGroups: SearchGroup[] = [
    { id: 'pages', label: t('Pagine'), items: [...items.filter((i) => !apps.has(i.href)), ...nav.bottom] },
    { id: 'apps', label: t('App'), items: items.filter((i) => apps.has(i.href)) },
  ]
  return (
    // la ricerca sta al centro; i lati tengono il loro contenuto e la ricerca cede quando la barra e' stretta
    <header className="@container sticky top-0 z-20 grid h-[50px] shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,420px)_minmax(max-content,1fr)] items-center gap-3 bg-band px-4 text-band-foreground max-[900px]:flex">
      <div className="flex min-w-0 items-center gap-2">
        {(band.logo || isMobile) && <SidebarTrigger className={cn(bandIcon, 'size-8')} aria-label={t('Apri o chiudi la sidebar')} />}
        <div className="max-[900px]:hidden">
          <TenantSwitcher session={session} route={route} />
        </div>
      </div>
      {band.search ? <SearchBox session={session} route={route} groups={searchGroups} /> : <div className="max-[900px]:flex-1" />}
      <div className="flex items-center gap-1 justify-self-end">
        {band.lang && <LanguageMenu />}
        {band.mode && <ModeMenu route={route} />}
        {band.help && <HelpMenu />}
        <NotificationsBell session={session} route={route} />
        <UserMenu session={session} route={route} band={band} />
      </div>
    </header>
  )
}

export default function Shell({ session, route, children }: { session: Session; route: Route; children: ReactNode }) {
  const band = bandOf(session)
  return (
    <SidebarProvider defaultOpen={sidebarOpen()} className="min-h-svh">
      <AppSidebar session={session} route={route} band={band} />
      <SidebarInset className="min-w-0">
        <TopBar session={session} route={route} band={band} />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
