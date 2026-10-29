// The detail of a plugin as the brochure of an application: a hero with the icon and the name, a gallery of
// pictures (they open in a lightbox), the description, what it asks of the platform, the release notes and, at
// the side, who made it, the licence, the version and the links. Every part of the manifest is optional: a
// part without data does not show.

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2, ShieldCheck } from 'lucide-react'
import { appUrl } from '../../api.ts'
import type { AdminPlugin } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import AppIcon from '../AppIcon.tsx'
import { t } from '../i18n.ts'

const enc = encodeURIComponent

function Gallery({ p }: { p: AdminPlugin }) {
  const shots = p.screenshots ?? []
  const [shot, setShot] = useState(0)
  const [open, setOpen] = useState(false)
  const src = (n: string) => appUrl(`/api/plugins/${enc(p.id)}/media/${enc(n)}`)
  const alt = (i: number) => t('Picture {n} of {total} of {name}', { n: i + 1, total: shots.length, name: p.label })
  const step = (d: number) => setShot((i) => (i + d + shots.length) % shots.length)
  useEffect(() => {
    if (!open || shots.length < 2) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  if (!shots.length) return null
  return (
    <section className="grid min-w-0 gap-3" data-testid="plugin-gallery" aria-label={t('Pictures')}>
      <div className="relative overflow-hidden rounded-xl border bg-muted">
        <button type="button" className="group block w-full cursor-zoom-in" aria-label={t('Enlarge the picture')} onClick={() => setOpen(true)}>
          <img className="mx-auto max-h-[26rem] w-full object-contain" src={src(shots[shot] ?? shots[0])} alt={alt(shot)} />
          <span className="absolute right-3 bottom-3 flex items-center gap-1 rounded-md bg-background/85 px-2 py-1 text-xs opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Maximize2 className="size-3.5" />
            {t('Enlarge')}
          </span>
        </button>
        {shots.length > 1 && (
          <>
            <Button variant="secondary" size="icon" className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full" aria-label={t('Previous picture')} onClick={() => step(-1)}>
              <ChevronLeft />
            </Button>
            <Button variant="secondary" size="icon" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full" aria-label={t('Next picture')} onClick={() => step(1)}>
              <ChevronRight />
            </Button>
          </>
        )}
      </div>
      {shots.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {shots.map((n, i) => (
            <button key={n} type="button" aria-label={t('Show picture {n}', { n: i + 1 })} aria-current={i === shot} onClick={() => setShot(i)} className={cn('overflow-hidden rounded-md border bg-muted opacity-70 transition-opacity hover:opacity-100', i === shot && 'opacity-100 ring-2 ring-primary')}>
              <img className="h-14 w-24 object-cover" src={src(n)} alt="" />
            </button>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] gap-3 sm:max-w-5xl" data-testid="plugin-lightbox">
          <DialogTitle>{p.label}</DialogTitle>
          <DialogDescription>{alt(shot)}</DialogDescription>
          <div className="relative flex min-h-0 items-center justify-center rounded-lg bg-muted">
            <img className="max-h-[70vh] w-full object-contain" src={src(shots[shot] ?? shots[0])} alt={alt(shot)} />
            {shots.length > 1 && (
              <>
                <Button variant="secondary" size="icon" className="absolute left-2 rounded-full" aria-label={t('Previous picture')} onClick={() => step(-1)}>
                  <ChevronLeft />
                </Button>
                <Button variant="secondary" size="icon" className="absolute right-2 rounded-full" aria-label={t('Next picture')} onClick={() => step(1)}>
                  <ChevronRight />
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="max-w-full rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs break-words">{children}</span>
}

/** What it needs and may do, in short (the full list is in the tab «What it asks»). */
function Requirements({ p }: { p: AdminPlugin }) {
  const perm = p.permissions
  const chips: string[] = []
  if (p.has_logic) chips.push(t('Server logic (sandbox)'))
  if (perm.hooks.length) chips.push(t('Reacts to: {list}', { list: perm.hooks.join(', ') }))
  if (perm.files) chips.push(t('Files on disk'))
  if (perm.content) chips.push(t('Folders from zip archives'))
  if (perm.network.length) chips.push(t('Network: {list}', { list: perm.network.join(', ') }))
  if (perm.frame_src.length) chips.push(t('Embeds: {list}', { list: perm.frame_src.join(', ') }))
  if (perm.calls?.length) chips.push(t('Calls: {list}', { list: perm.calls.join(', ') }))
  if (p.requires?.database) chips.push(t('Database: {db}', { db: p.requires.database }))
  return (
    <section className="grid gap-2" data-testid="plugin-requirements">
      <h3 className="text-sm font-semibold">{t('Permissions and requirements')}</h3>
      <div className="flex flex-wrap gap-1.5">
        {chips.length ? chips.map((c) => <Chip key={c}>{c}</Chip>) : <span className="text-sm text-muted-foreground">{t('It asks nothing special of the platform.')}</span>}
        {p.min_kernel && <Chip>{t('Needs Mosaikit {v}', { v: p.min_kernel })}</Chip>}
      </div>
    </section>
  )
}

/** The identity of a plugin: its icon, name, description and the badges of kind, version, licence and signature.
 *  The hero of the brochure draws it large, the cards of the list of plugins draw it small (`card`). */
export function PluginSummary({ p, kind, card, href, className }: { p: AdminPlugin; kind: string; card?: boolean; href?: string; className?: string }) {
  const name = card ? (
    <h3 className="text-base font-semibold">{href ? <a href={href} className="after:absolute after:inset-0 hover:underline focus-visible:outline-none">{p.label}</a> : p.label}</h3>
  ) : (
    <h2 className="text-2xl font-semibold tracking-tight max-[620px]:text-xl">{p.label}</h2>
  )
  const badges = (
    <div className={cn('flex items-center gap-1.5', card ? 'min-w-0 flex-nowrap gap-1 p-px [&_[data-slot=badge]]:px-1.5 [&_[data-slot=badge]]:text-[11px]' : 'flex-wrap pt-1')}>
      <Badge variant="secondary" className="border-foreground/25 bg-card font-normal">{kind}</Badge>
      <Badge variant="outline" className="border-foreground/25 bg-card font-mono font-normal">v{p.version}</Badge>
      {p.license && <Badge variant="outline" className="border-foreground/25 bg-card font-normal">{p.license}</Badge>}
      {p.signed_by && (
        <Badge variant="outline" className="gap-1 font-normal text-ok">
          <ShieldCheck className="size-3" />
          {t('Signed')}
        </Badge>
      )}
    </div>
  )
  const tile = (
    <span className={cn('flex shrink-0 items-center justify-center rounded-2xl border bg-card shadow-sm', card ? 'size-14' : 'size-20 max-[620px]:size-16')}>
      <AppIcon id={p.id} name={p.icon_name} className={cn('text-primary', card ? 'size-7' : 'size-10 max-[620px]:size-8')} />
    </span>
  )
  // the card: icon, name and badges on one row, the description under them across the whole width
  if (card)
    return (
      <div className={cn('grid gap-3', className)}>
        <div className="flex items-center gap-3">
          {tile}
          <div className="grid min-w-0 flex-1 gap-1.5">
            {name}
            {badges}
          </div>
        </div>
        <p className="line-clamp-3 text-sm text-muted-foreground">{p.description}</p>
      </div>
    )
  return (
    <div className={cn('flex items-center gap-5', className)}>
      {tile}
      <div className="grid min-w-0 flex-1 gap-1.5">
        {name}
        <p className="text-sm text-muted-foreground">{p.description}</p>
        {badges}
      </div>
    </div>
  )
}

export function Brochure({ p, kind, notes, aside }: { p: AdminPlugin; kind: string; notes?: { version: string; notes: string }[]; aside?: ReactNode }) {
  const paragraphs = (p.details ?? '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)
  const nd = <span className="text-muted-foreground">{t('not declared')}</span>
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6" data-testid="plugin-brochure">
      <header className="flex flex-wrap items-center gap-5 rounded-2xl border bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 max-[620px]:p-4">
        <PluginSummary p={p} kind={kind} className="min-w-0 flex-1" />
        {p.homepage && (
          <Button asChild variant="outline" className="max-[620px]:w-full">
            <a href={p.homepage} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              {t('More information')}
            </a>
          </Button>
        )}
      </header>
      <Gallery p={p} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="grid min-w-0 gap-6">
          {paragraphs.length > 0 && (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{t('About')}</h3>
              {paragraphs.map((x, i) => (
                <p key={i} className="max-w-prose text-sm leading-relaxed whitespace-pre-line">
                  {x}
                </p>
              ))}
            </section>
          )}
          <Requirements p={p} />
          {!!notes?.length && (
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold">{t('Version history')}</h3>
              {notes.map((n) => (
                <div key={n.version} className="border-l-2 pl-3 text-sm">
                  <b className="font-mono text-xs">{n.version}</b>
                  <p className="whitespace-pre-line text-muted-foreground">{n.notes}</p>
                </div>
              ))}
            </section>
          )}
        </div>
        <aside className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-3 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold">{t('Publisher')}</h3>
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm [&>dd]:min-w-0 [&>dd]:break-words">
              <dt className="text-muted-foreground">{t('Author')}</dt>
              <dd>{p.author ?? nd}</dd>
              <dt className="text-muted-foreground">{t('Licence')}</dt>
              <dd>{p.license ?? nd}</dd>
              <dt className="text-muted-foreground">{t('Version')}</dt>
              <dd className="font-mono">{p.version}</dd>
              <dt className="text-muted-foreground">{t('Signature')}</dt>
              <dd>{p.signed_by ?? <span className="text-warn">{t('unsigned')}</span>}</dd>
              {p.homepage && (
                <>
                  <dt className="text-muted-foreground">{t('Links')}</dt>
                  <dd className="min-w-0 break-words">
                    <a className="underline underline-offset-4" href={p.homepage} target="_blank" rel="noopener noreferrer">
                      {p.homepage.replace(/^https?:\/\//, '')}
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </div>
          {aside}
        </aside>
      </div>
    </div>
  )
}
