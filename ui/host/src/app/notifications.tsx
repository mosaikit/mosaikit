// Notifications, as in the mockup: the bell in the bar opens a panel with the latest ones, «Mark all
// as read», the gear towards Account › Notifications and «See all» towards the page. The page filters by
// unread, kind, period and words, and acts on a selection (read, unread, delete). An invitation to another
// tenant is answered right from the notification.

import { useMemo, useState } from 'react'
import { AppWindow, Bell, BellOff, Check, Link2, Mail, MailOpen, Settings, Share2, ShieldAlert, Trash2 } from 'lucide-react'
import { fmtDate } from '../api.ts'
import type { Session } from '../types.ts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { KINDS, kindLabel, noteBody, noteTitle, pendingInvitation, useNoteActions, useNoteList, useUnread, type Note, type NoteFilter } from './notes.ts'
import { t } from './i18n.ts'
import { Empty, ErrorBox, Loading, PageHeader, Pills } from './kit.tsx'
import { go, personal, to, type Route } from './router.ts'

function KindIcon({ n }: { n: Note }) {
  const Icon = { invitation: Mail, share: Share2, link: Link2, plugin: AppWindow, system: ShieldAlert }[n.kind]
  return (
    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
      <Icon className="size-4" />
    </span>
  )
}

function NoteRow({ n, onOpen, select }: { n: Note; onOpen?: () => void; select?: { on: boolean; set: (on: boolean) => void } }) {
  const act = useNoteActions()
  const inv = pendingInvitation(n)
  const title = noteTitle(n)
  const body = noteBody(n)
  const app = typeof n.data.app === 'string' ? n.data.app : ''
  const open = () => {
    if (!n.read) act.mark.mutate({ ids: [n.id], read: true })
    if (n.link) {
      onOpen?.()
      go(n.link)
    }
  }
  return (
    <li className={cn('flex gap-3 rounded-lg p-2.5', !n.read && 'bg-primary/5', select?.on && 'ring-1 ring-primary')}>
      {select && <Checkbox className="mt-2" aria-label={t('Select: {what}', { what: title })} checked={select.on} onCheckedChange={(v) => select.set(!!v)} />}
      <KindIcon n={n} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {n.link ? (
            <button type="button" className="flex-1 text-left text-sm font-semibold hover:underline" onClick={open}>
              {title}
            </button>
          ) : (
            <b className="flex-1 text-sm">{title}</b>
          )}
          {!n.read && <span role="img" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label={t('unread')} />}
        </div>
        <p className="text-xs text-muted-foreground">
          {[body, app, n.tenant_name, fmtDate(n.created_at)].filter(Boolean).join(' · ')}
        </p>
        {inv && (
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                act.answer.mutate({ id: inv, accept: true })
                onOpen?.()
              }}
            >
              <Check />
              {t('Accept')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => act.answer.mutate({ id: inv, accept: false })}>
              {t('Decline')}
            </Button>
          </div>
        )}
      </div>
      {!select && !n.read && !inv && (
        <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={t('Mark as read')} title={t('Mark as read')} onClick={() => act.mark.mutate({ ids: [n.id], read: true })}>
          <MailOpen className="size-3.5" />
        </Button>
      )}
    </li>
  )
}

const bandIcon =
  'relative flex size-8 shrink-0 items-center justify-center rounded-md text-band-foreground/90 outline-none hover:bg-band-hover hover:text-band-foreground focus-visible:ring-2 focus-visible:ring-white/60 data-[state=open]:bg-band-hover'

/** The bell of the top bar, with the panel of the latest notifications. */
export function NotificationsBell({ route }: { session: Session; route: Route }) {
  const [open, setOpen] = useState(false)
  const unread = useUnread().data ?? 0
  const label = unread ? t('Notifications, {n} new', { n: String(unread) }) : t('Notifications')
  const goTo = (h: string) => {
    setOpen(false)
    go(h)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={bandIcon} aria-label={label} title={label} data-tour="bell">
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <em data-testid="bell-badge" className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white not-italic tabular-nums">
            {unread > 99 ? '99+' : unread}
          </em>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] max-w-[calc(100vw-16px)] p-0">{open && <BellPanel unread={unread} onClose={() => setOpen(false)} goTo={goTo} route={route} />}</PopoverContent>
    </Popover>
  )
}

function BellPanel({ unread, onClose, goTo, route }: { unread: number; onClose: () => void; goTo: (h: string) => void; route: Route }) {
  const list = useNoteList({ limit: 6 })
  const act = useNoteActions()
  const notes = list.data?.items ?? []
  return (
    <>
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <b className="flex-1 text-sm">{t('Notifications')}</b>
        <Button variant="ghost" size="sm" disabled={!unread} onClick={() => act.markAll.mutate()}>
          {t('Mark all as read')}
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('Notification preferences')} title={t('Notification preferences')} onClick={() => goTo(personal(route, 'account', 'notifications'))}>
          <Settings />
        </Button>
      </div>
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorBox error={list.error} />
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 p-8 text-center text-sm text-muted-foreground">
          <BellOff className="size-6" />
          <b className="text-foreground">{t('No notifications')}</b>
          {t('Invitations, shares and messages of the apps arrive here.')}
        </div>
      ) : (
        <ul className="grid max-h-[60vh] gap-1 overflow-auto p-2">
          {notes.map((x) => (
            <NoteRow key={x.id} n={x} onOpen={onClose} />
          ))}
        </ul>
      )}
      <div className="border-t p-1.5">
        <Button variant="ghost" className="w-full" onClick={() => goTo(personal(route, 'notifications'))}>
          {t('See all')}
        </Button>
      </div>
    </>
  )
}

const PERIODS: { id: string; days?: number }[] = [{ id: 'any' }, { id: '1', days: 1 }, { id: '7', days: 7 }, { id: '30', days: 30 }]

function periodLabel(id: string): string {
  return { any: t('Any time'), '1': t('Today'), '7': t('Last 7 days'), '30': t('Last 30 days') }[id] ?? id
}

/** The Notifications page: filters, selection and pages of older ones. */
export function NotificationsPage({ session, route }: { session: Session; route: Route }) {
  const [show, setShow] = useState('all')
  const [kind, setKind] = useState('any')
  const [period, setPeriod] = useState('any')
  const [words, setWords] = useState('')
  const [pages, setPages] = useState<string[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const filter: NoteFilter = useMemo(
    () => ({ unread: show === 'unread', kind: kind === 'any' ? undefined : kind, days: PERIODS.find((p) => p.id === period)?.days, q: words || undefined, limit: 30 }),
    [show, kind, period, words],
  )
  const reset = () => {
    setPages([])
    setSel(new Set())
  }
  const unread = useUnread().data ?? 0
  const act = useNoteActions()
  const home = route.area === 'tenant' ? to.tenant(route.tenant) : to.admin()
  const admin = session.user.is_system_admin
  const kinds = KINDS.filter((k) => admin || k !== 'system')
  return (
    <>
      <PageHeader
        title={t('Notifications')}
        crumbs={[{ label: t('Account'), href: personal(route, 'account') }]}
        sub={unread ? t('{n} to read', { n: String(unread) }) : t('All read')}
        actions={
          <Button variant="outline" disabled={!unread} onClick={() => act.markAll.mutate()}>
            {t('Mark all as read')}
          </Button>
        }
        more={
          <button type="button" className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => go(personal(route, 'account', 'notifications'))}>
            {t('What I receive')}
          </button>
        }
      />
      <div className="grid max-w-3xl gap-3 p-6 max-[620px]:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pills
            items={[
              { id: 'all', label: t('All') },
              { id: 'unread', label: t('Unread'), count: unread },
            ]}
            value={show}
            onChange={(v) => {
              setShow(v)
              reset()
            }}
          />
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v)
              reset()
            }}
          >
            <SelectTrigger size="sm" className="w-44" aria-label={t('Kind')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{t('Every kind')}</SelectItem>
              {kinds.map((k) => (
                <SelectItem key={k} value={k}>
                  {kindLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={period}
            onValueChange={(v) => {
              setPeriod(v)
              reset()
            }}
          >
            <SelectTrigger size="sm" className="w-40" aria-label={t('Period')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {periodLabel(p.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="search"
            className="h-8 w-56 max-w-full"
            placeholder={t('Search the notifications')}
            aria-label={t('Search the notifications')}
            value={words}
            onChange={(e) => {
              setWords(e.target.value)
              reset()
            }}
          />
        </div>
        {sel.size > 0 && (
          // the action bar appears only with a selection
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/10 py-1 pr-1 pl-3" role="group" aria-label={t('Actions on the selection')}>
            <span className="text-sm font-medium tabular-nums">{t('{count} selected', { count: sel.size })}</span>
            <Button variant="outline" size="sm" onClick={() => act.mark.mutate({ ids: [...sel], read: true }, { onSuccess: () => setSel(new Set()) })}>
              <MailOpen />
              {t('Mark as read')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => act.mark.mutate({ ids: [...sel], read: false }, { onSuccess: () => setSel(new Set()) })}>
              <Mail />
              {t('Mark as unread')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => act.remove.mutate([...sel], { onSuccess: () => setSel(new Set()) })}>
              <Trash2 />
              {t('Delete')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>
              {t('Deselect')}
            </Button>
          </div>
        )}
        <ListPage filter={filter} before={undefined} sel={sel} setSel={setSel} home={home} first onMore={(next) => setPages([next])} more={pages.length === 0} />
        {pages.map((p, i) => (
          <ListPage key={p} filter={filter} before={p} sel={sel} setSel={setSel} home={home} onMore={(next) => setPages((x) => [...x, next])} more={i === pages.length - 1} />
        ))}
      </div>
    </>
  )
}

function ListPage({
  filter,
  before,
  sel,
  setSel,
  home,
  first,
  onMore,
  more,
}: {
  filter: NoteFilter
  before?: string
  sel: Set<string>
  setSel: (s: Set<string>) => void
  home: string
  first?: boolean
  onMore: (next: string) => void
  more: boolean
}) {
  const q = useNoteList({ ...filter, before })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const rows = q.data!.items
  if (first && rows.length === 0)
    return (
      <Empty icon={<BellOff />} title={filter.unread ? t('Nothing to read') : t('No notifications')}>
        <a href={home} className="text-primary hover:underline">
          {t('Back to the overview')}
        </a>
      </Empty>
    )
  return (
    <>
      <ul className="grid gap-1 rounded-xl border bg-card p-2">
        {rows.map((x) => (
          <NoteRow
            key={x.id}
            n={x}
            select={{
              on: sel.has(x.id),
              set: (on) => {
                const s = new Set(sel)
                if (on) s.add(x.id)
                else s.delete(x.id)
                setSel(s)
              },
            }}
          />
        ))}
      </ul>
      {more && q.data!.next && (
        <Button variant="outline" className="justify-self-center" onClick={() => onMore(q.data!.next!)}>
          {t('Show older ones')}
        </Button>
      )}
    </>
  )
}
