// The search in the top bar. Closed it is a field to click (or Ctrl K, or /); open one types and below
// a drop-down opens with the pill filters and the results. Esc, a click outside or a result close it.
// Keyboard navigation (arrows, Enter) comes from cmdk, as in the Command component of shadcn.
// Pages, apps and tenants are filtered here; the items of the apps come from the server
// (`/api/t/<tenant>/search`: only what the person can see), one pill per app with its count; the
// Administrator finds tenants and people (`/api/admin/search`). The last searches are remembered in this
// browser, for this person.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Command as CommandPrimitive } from 'cmdk'
import { Building2, History, Search, UserRound } from 'lucide-react'
import { api } from '../api.ts'
import type { SearchGroupResult, Session } from '../types.ts'
import { CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import AppIcon from './AppIcon.tsx'
import { go, to, type Route } from './router.ts'
import { t } from './i18n.ts'
import { searchable } from './searchwords.ts'

const enc = encodeURIComponent
const RECENT_MAX = 6

function recentKey(user: string) {
  return `msk_recent_search:${user}`
}
function readRecent(user: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(user)) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}
function remember(user: string, q: string) {
  const v = q.trim()
  if (!searchable(v)) return
  try {
    localStorage.setItem(recentKey(user), JSON.stringify([v, ...readRecent(user).filter((x) => x !== v)].slice(0, RECENT_MAX)))
  } catch {
    /* storage not available */
  }
}

interface AdminResults {
  tenants: { id: string; name: string; sub: string }[]
  people: { id: string; name: string; sub: string }[]
}

export interface SearchItem {
  label: string
  icon: ReactNode
  href: string
  /** extra text to search on (e.g. the slug of the tenant) */
  extra?: string
  sub?: string
}
export interface SearchGroup {
  id: string
  label: string
  items: SearchItem[]
  /** found by the server: shown as they come, with the total count */
  remote?: boolean
  count?: number
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

export default function SearchBox({ session, route, groups }: { session: Session; route: Route; groups: SearchGroup[] }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [pill, setPill] = useState('all')
  // every opening of the box asks the server again: a share, a restore or a delete made meanwhile (by
  // anybody) shows at once, never a stale answer of an earlier search
  const [opened, setOpened] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const admin = session.user.is_system_admin
  const me = session.user.user_id
  const slug = route.area === 'tenant' ? route.tenant : ''
  // the server is asked once the person stops typing for a moment
  useEffect(() => {
    const h = setTimeout(() => setDq(q.trim()), 180)
    return () => clearTimeout(h)
  }, [q])
  const ask = open && searchable(dq)
  const items = useQuery({
    queryKey: ['search', slug, dq, opened],
    queryFn: () => api<SearchGroupResult[]>('GET', `/api/t/${enc(slug)}/search?q=${enc(dq)}`),
    enabled: ask && !admin && !!slug,
    staleTime: 0,
    gcTime: 30_000,
  })
  const found = useQuery({
    queryKey: ['admin-search', dq, opened],
    queryFn: () => api<AdminResults>('GET', `/api/admin/search?q=${enc(dq)}`),
    enabled: ask && admin,
    staleTime: 0,
    gcTime: 30_000,
  })
  const [recent, setRecent] = useState<string[]>([])

  const all: SearchGroup[] = useMemo(() => {
    const extra: SearchGroup[] = admin
      ? [
          { id: 'tenants', label: t('Tenants'), remote: true, items: (found.data?.tenants ?? []).map((x) => ({ label: x.name, sub: x.sub, icon: <Building2 />, href: to.adminTenant(x.id) })) },
          { id: 'people', label: t('People'), remote: true, items: (found.data?.people ?? []).map((x) => ({ label: x.name, sub: x.sub, icon: <UserRound />, href: to.adminPerson(x.id) })) },
        ]
      : session.memberships.length > 1
        ? [{ id: 'tenants', label: t('Tenants'), items: session.memberships.map((m) => ({ label: m.name, sub: m.is_home ? 'home' : 'guest', icon: <Building2 />, href: to.tenant(m.slug) })) }]
        : []
    const apps: SearchGroup[] = (items.data ?? []).map((g) => ({
      id: `app:${g.plugin_id}`,
      label: g.label,
      remote: true,
      count: g.count,
      items: g.items.map((h) => ({
        label: h.title || t('(untitled)'),
        sub: h.snippet || h.owner_name,
        icon: <AppIcon id={g.plugin_id} name={g.icon} />,
        href: to.item(slug, h.id),
      })),
    }))
    return [...groups, ...apps, ...extra].filter((g) => g.items.length)
  }, [groups, admin, found.data, items.data, session.memberships, slug])

  const nq = norm(q.trim())
  const match = (g: SearchGroup, it: SearchItem) => g.remote || !nq || norm(`${it.label} ${it.extra ?? ''} ${it.sub ?? ''}`).includes(nq)
  const counts = all.map((g) => (g.remote ? (g.count ?? g.items.length) : g.items.filter((it) => match(g, it)).length))
  const shown = all.map((g) => ({ ...g, items: g.items.filter((it) => match(g, it)) })).filter((g) => (pill === 'all' || g.id === pill) && g.items.length)
  const loading = (items.isFetching || found.isFetching) && ask
  const recents = !q.trim() && pill === 'all' ? recent : []

  const openBox = useCallback(() => {
    setQ('')
    setDq('')
    setPill('all')
    setRecent(readRecent(me))
    setOpened((n) => n + 1)
    setOpen(true)
  }, [me])
  const close = () => setOpen(false)
  // a search that found something is remembered also when no result is opened (the person read the answer)
  const found_any = (items.data?.some((g) => g.items.length) ?? false) || !!found.data?.tenants.length || !!found.data?.people.length
  useEffect(() => {
    if (open && found_any && searchable(dq)) remember(me, dq)
  }, [open, found_any, dq, me])
  const pick = (href: string) => {
    remember(me, q)
    close()
    go(href)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (open) close()
        else openBox()
      }
    }
    // the "/" shortcut and the help ask for the search with this event
    const onAsk = () => {
      if (!open) openBox()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('msk:search', onAsk)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('msk:search', onAsk)
    }
  }, [open, openBox])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const placeholder = admin ? t('Search tenants, people and pages') : t('Search pages, apps and their items')
  return (
    <div
      ref={box}
      data-tour="search"
      className={cn(
        'relative flex min-w-0 justify-center @max-[600px]:justify-end max-[900px]:static max-[900px]:ml-auto max-[900px]:basis-80 max-[620px]:basis-auto',
        open && 'max-[900px]:flex-1 max-[620px]:basis-auto',
      )}
    >
      {!open ? (
        <button
          type="button"
          onClick={openBox}
          aria-keyshortcuts="Control+K"
          aria-haspopup="dialog"
          className="flex h-8 w-full items-center gap-2.5 rounded-md bg-search px-3 text-sm text-search-foreground outline-none hover:brightness-[1.04] focus-visible:ring-2 focus-visible:ring-white/70 @max-[600px]:w-8 @max-[600px]:justify-center @max-[600px]:bg-transparent @max-[600px]:px-0 @max-[600px]:text-band-foreground/90 @max-[600px]:hover:bg-band-hover max-[620px]:w-8! max-[620px]:justify-center max-[620px]:bg-transparent max-[620px]:px-0 max-[620px]:text-band-foreground/90"
        >
          <Search className="size-4 shrink-0" />
          {/* on a narrow bar only the icon shows: the text becomes sr-only and still names the button */}
          <span className="flex-1 truncate text-left @max-[600px]:sr-only max-[620px]:sr-only">{t('Search everywhere')}</span>
          <kbd className="rounded border border-current/30 px-1.5 font-mono text-[11px] @max-[860px]:hidden max-[620px]:hidden">{t('Ctrl K')}</kbd>
        </button>
      ) : (
        <CommandPrimitive
          shouldFilter={false}
          label={t('Search')}
          className="w-full"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
        >
          <div className="flex h-8 w-full items-center gap-2.5 rounded-md bg-search px-3 text-sm text-search-foreground ring-2 ring-white/55">
            <Search className="size-4 shrink-0" />
            <CommandPrimitive.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-search-foreground"
            />
            <kbd className="rounded border border-current/30 px-1.5 font-mono text-[11px] max-[620px]:hidden">{t('Esc')}</kbd>
          </div>
          <div
            role="dialog"
            aria-label={t('Search results')}
            className="absolute top-[calc(100%+6px)] left-1/2 z-50 flex w-[max(100%,520px)] max-w-[calc(100vw-16px)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg max-[900px]:right-2 max-[900px]:left-2 max-[900px]:w-auto max-[900px]:translate-x-0"
          >
            <div role="tablist" aria-label={t('Show')} className="flex flex-wrap gap-1.5 border-b px-3.5 py-3">
              {[{ id: 'all', label: t('All'), n: counts.reduce((s, c) => s + c, 0) }, ...all.map((g, i) => ({ id: g.id, label: g.label, n: counts[i] })).filter((p) => p.n > 0 || p.id === pill)].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={pill === p.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setPill(p.id)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[13px] text-foreground/80 hover:bg-accent',
                    pill === p.id && 'border-primary bg-primary text-primary-foreground hover:bg-primary',
                  )}
                >
                  {p.label}
                  <span className={cn('text-[11px] tabular-nums', pill === p.id ? 'opacity-85' : 'text-muted-foreground')}>{p.n}</span>
                </button>
              ))}
            </div>
            <CommandList className="max-h-[min(55vh,460px)]">
              {loading && !shown.some((g) => g.remote) ? (
                <div className="py-6 text-center text-sm text-muted-foreground" role="status">
                  {t('Searching…')}
                </div>
              ) : (
                <CommandEmpty>{q ? t('No results for «{q}».', { q }) : t('No results.')}</CommandEmpty>
              )}
              {recents.length > 0 && (
                <CommandGroup heading={t('Recent searches')}>
                  {recents.map((r) => (
                    <CommandItem key={`recent:${r}`} value={`recent:${r}`} onSelect={() => setQ(r)}>
                      <History />
                      <span className="flex-1 truncate">{r}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {shown.map((g) => (
                <CommandGroup key={g.id} heading={`${g.label} · ${g.remote ? (g.count ?? g.items.length) : g.items.length}`}>
                  {g.items.map((it) => (
                    <CommandItem key={it.href} value={`${g.id}:${it.href}`} onSelect={() => pick(it.href)}>
                      {it.icon}
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.sub && <span className="max-w-[55%] truncate text-xs text-muted-foreground">{it.sub}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
            <div className="flex gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
              <span>
                <kbd className="font-mono">↑ ↓</kbd> {t('to choose')}
              </span>
              <span>
                <kbd className="font-mono">{t('Enter')}</kbd> {t('to open')}
              </span>
              <span>
                <kbd className="font-mono">{t('Esc')}</kbd> {t('to close')}
              </span>
            </div>
          </div>
        </CommandPrimitive>
      )}
    </div>
  )
}
