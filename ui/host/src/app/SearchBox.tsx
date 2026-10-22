// La ricerca nella barra in alto. Chiusa e' un campo da cliccare (o Ctrl K); aperta si scrive e sotto
// si apre una tendina con i filtri a pillole e i risultati. Esc, un clic fuori o un risultato la chiudono.
// La navigazione da tastiera (frecce, Invio) e' di cmdk, come nel componente Command di shadcn.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Building2, Search } from 'lucide-react'
import type { Session, TenantInfo } from '../types.ts'
import { CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { useApi } from './core.ts'
import { go, to, type Route } from './router.ts'
import { t } from './i18n.ts'

export interface SearchItem {
  label: string
  icon: ReactNode
  href: string
  /** testo in piu' su cui cercare (es. lo slug del tenant) */
  extra?: string
  sub?: string
}
export interface SearchGroup {
  id: string
  label: string
  items: SearchItem[]
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

export default function SearchBox({ session, groups }: { session: Session; route: Route; groups: SearchGroup[] }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pill, setPill] = useState('all')
  const box = useRef<HTMLDivElement>(null)
  const admin = session.user.is_system_admin
  const tenants = useApi<TenantInfo[]>(['admin-tenants'], admin && open ? '/api/admin/tenants' : null)

  const all: SearchGroup[] = useMemo(() => {
    const extra: SearchGroup[] = admin
      ? [
          {
            id: 'tenants',
            label: t('Tenant'),
            items: (tenants.data ?? []).map((t) => ({ label: t.name, sub: t.slug, extra: t.slug, icon: <Building2 />, href: to.adminTenant(t.id) })),
          },
        ]
      : session.memberships.length > 1
        ? [{ id: 'tenants', label: t('Tenant'), items: session.memberships.map((m) => ({ label: m.name, sub: m.is_home ? 'appartenenza' : 'ospite', icon: <Building2 />, href: to.tenant(m.slug) })) }]
        : []
    return [...groups, ...extra].filter((g) => g.items.length)
  }, [groups, admin, tenants.data, session.memberships])

  const nq = norm(q.trim())
  const match = (it: SearchItem) => !nq || norm(`${it.label} ${it.extra ?? ''} ${it.sub ?? ''}`).includes(nq)
  const counts = all.map((g) => g.items.filter(match).length)
  const shown = all.map((g) => ({ ...g, items: g.items.filter(match) })).filter((g) => (pill === 'all' || g.id === pill) && g.items.length)

  const openBox = () => {
    setQ('')
    setPill('all')
    setOpen(true)
  }
  const close = () => setOpen(false)
  const pick = (href: string) => {
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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const placeholder = admin ? t('Cerca tenant e pagine') : t('Cerca pagine, app e tenant')
  return (
    <div
      ref={box}
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
          <span className="flex-1 truncate text-left @max-[600px]:sr-only max-[620px]:sr-only">{t('Cerca ovunque')}</span>
          <kbd className="rounded border border-current/30 px-1.5 font-mono text-[11px] @max-[860px]:hidden max-[620px]:hidden">{t('Ctrl K')}</kbd>
        </button>
      ) : (
        <CommandPrimitive
          shouldFilter={false}
          label={t('Cerca')}
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
            aria-label={t('Risultati della ricerca')}
            className="absolute top-[calc(100%+6px)] left-1/2 z-50 flex w-[max(100%,520px)] max-w-[calc(100vw-16px)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg max-[900px]:right-2 max-[900px]:left-2 max-[900px]:w-auto max-[900px]:translate-x-0"
          >
            <div role="tablist" aria-label={t('Mostra')} className="flex flex-wrap gap-1.5 border-b px-3.5 py-3">
              {[{ id: 'all', label: t('Tutto'), n: counts.reduce((s, c) => s + c, 0) }, ...all.map((g, i) => ({ id: g.id, label: g.label, n: counts[i] }))].map((p) => (
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
              <CommandEmpty>{q ? t('Nessun risultato per «{q}».', { q }) : t('Nessun risultato.')}</CommandEmpty>
              {shown.map((g) => (
                <CommandGroup key={g.id} heading={`${g.label} · ${g.items.length}`}>
                  {g.items.map((it) => (
                    <CommandItem key={it.href} value={`${g.id}:${it.href}`} onSelect={() => pick(it.href)}>
                      {it.icon}
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.sub && <span className="text-xs text-muted-foreground">{it.sub}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
            <div className="flex gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
              <span>
                <kbd className="font-mono">↑ ↓</kbd> per scegliere
              </span>
              <span>
                <kbd className="font-mono">{t('Invio')}</kbd> per aprire
              </span>
              <span>
                <kbd className="font-mono">{t('Esc')}</kbd> per chiudere
              </span>
            </div>
          </div>
        </CommandPrimitive>
      )}
    </div>
  )
}
