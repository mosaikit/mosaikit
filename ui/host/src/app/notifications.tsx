// Notifiche, come nel mockup: la campanella nella barra apre un pannello con le ultime, «Segna tutte
// come lette», l'ingranaggio verso Account › Notifiche e «Vedi tutte» verso la pagina. Oggi il kernel
// produce un solo tipo di notifica, gli inviti in altri tenant (accetta o rifiuta); le altre (menzioni,
// scadenze, avvisi dei plugin) arriveranno con l'API delle notifiche.

import { useState } from 'react'
import { Bell, BellOff, Check, Mail, Settings } from 'lucide-react'
import { api, fmtDate } from '../api.ts'
import type { Session } from '../types.ts'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useAction } from './core.ts'
import { useNotes, type Note } from './notes.ts'
import { t } from './i18n.ts'
import { Empty, Loading, PageHeader, Pills } from './kit.tsx'
import { go, personal, to, type Route } from './router.ts'

function useAnswer() {
  return useAction(({ id, accept }: { id: string; accept: boolean }) => api('POST', `/api/me/invitations/${id}/${accept ? 'accept' : 'decline'}`), {
    ok: ({ accept }) => (accept ? t('Invito accettato: trovi il tenant nel selettore in alto') : t('Invito rifiutato')),
    invalidate: [['my-invitations'], ['session']],
  })
}

function NoteRow({ n, onOpen }: { n: Note; onOpen?: () => void }) {
  const answer = useAnswer()
  const inv = n.invitation
  return (
    <li className={cn('flex gap-3 rounded-lg p-2.5', !n.read && 'bg-primary/5')}>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Mail className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <b className="flex-1 text-sm">{n.title}</b>
          {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label={t('non letta')} />}
        </div>
        <p className="text-xs text-muted-foreground">
          {n.body} · {fmtDate(n.when)}
        </p>
        {inv && (
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                answer.mutate({ id: inv.id, accept: true })
                onOpen?.()
              }}
            >
              <Check />
              {t('Accetta')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => answer.mutate({ id: inv.id, accept: false })}>
              {t('Rifiuta')}
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}

const bandIcon =
  'relative flex size-8 shrink-0 items-center justify-center rounded-md text-band-foreground/90 outline-none hover:bg-band-hover hover:text-band-foreground focus-visible:ring-2 focus-visible:ring-white/60 data-[state=open]:bg-band-hover'

/** La campanella della barra in alto, con il pannello delle ultime notifiche. */
export function NotificationsBell({ session, route }: { session: Session; route: Route }) {
  const [open, setOpen] = useState(false)
  const n = useNotes(session)
  const label = n.unread ? t('Notifiche, {n} nuove', { n: String(n.unread) }) : t('Notifiche')
  const goTo = (h: string) => {
    setOpen(false)
    go(h)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={bandIcon} aria-label={label} title={label}>
        <Bell className="size-[18px]" />
        {n.unread > 0 && (
          <em className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white not-italic tabular-nums">
            {n.unread}
          </em>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-16px)] p-0">
        <div className="flex items-center gap-1 border-b px-3 py-2">
          <b className="flex-1 text-sm">{t('Notifiche')}</b>
          <Button variant="ghost" size="sm" disabled={!n.unread} onClick={n.markAll}>
            {t('Segna tutte come lette')}
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('Preferenze delle notifiche')} title={t('Preferenze delle notifiche')} onClick={() => goTo(personal(route, 'account', 'notifications'))}>
            <Settings />
          </Button>
        </div>
        {n.isLoading ? (
          <Loading />
        ) : n.notes.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 p-8 text-center text-sm text-muted-foreground">
            <BellOff className="size-6" />
            <b className="text-foreground">{t('Nessuna notifica')}</b>
            {t('Qui arrivano inviti, menzioni e avvisi delle app.')}
          </div>
        ) : (
          <ul className="grid max-h-[60vh] gap-1 overflow-auto p-2">
            {n.notes.slice(0, 5).map((x) => (
              <NoteRow key={x.id} n={x} onOpen={() => setOpen(false)} />
            ))}
          </ul>
        )}
        <div className="border-t p-1.5">
          <Button variant="ghost" className="w-full" onClick={() => goTo(personal(route, 'notifications'))}>
            {t('Vedi tutte')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** La pagina Notifiche: tutte, con il filtro sulle non lette. */
export function NotificationsPage({ session, route }: { session: Session; route: Route }) {
  const n = useNotes(session)
  const [show, setShow] = useState('all')
  const rows = n.notes.filter((x) => show === 'all' || !x.read)
  const home = route.area === 'tenant' ? to.tenant(route.tenant) : to.admin()
  return (
    <>
      <PageHeader
        title={t('Notifiche')}
        crumbs={[{ label: t('Account'), href: personal(route, 'account') }]}
        sub={n.unread ? t('{n} da leggere', { n: String(n.unread) }) : t('Tutte lette')}
        actions={
          <Button variant="outline" disabled={!n.unread} onClick={n.markAll}>
            {t('Segna tutte come lette')}
          </Button>
        }
        more={
          <button type="button" className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => go(personal(route, 'account', 'notifications'))}>
            {t('Cosa ricevo')}
          </button>
        }
      />
      <div className="grid max-w-3xl gap-3 p-6 max-[620px]:p-4">
        <Pills
          items={[
            { id: 'all', label: t('Tutte'), count: n.notes.length },
            { id: 'unread', label: t('Non lette'), count: n.unread },
          ]}
          value={show}
          onChange={setShow}
        />
        {n.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty icon={<BellOff />} title={show === 'unread' ? t('Nessuna notifica da leggere') : t('Nessuna notifica')}>
            <a href={home} className="text-primary hover:underline">
              {t('Torna alla panoramica')}
            </a>
          </Empty>
        ) : (
          <ul className="grid gap-1 rounded-xl border bg-card p-2">
            {rows.map((x) => (
              <NoteRow key={x.id} n={x} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
