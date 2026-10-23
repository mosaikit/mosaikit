// Help of the shell, the components: the guided tour over the page, the dialogs of the guide, of what is
// new and of the keyboard shortcuts, and the shortcuts themselves (help.ts has the logic).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import changelog from '../../../../CHANGELOG.md?raw'
import changelogIt from '../../../../CHANGELOG.it.md?raw'
import guideUser from '../../../../docs/guide/user.md?raw'
import guideManager from '../../../../docs/guide/tenant-manager.md?raw'
import guideAdmin from '../../../../docs/guide/administrator.md?raw'
import guideUserIt from '../../../../docs/guide/it/user.md?raw'
import guideManagerIt from '../../../../docs/guide/it/tenant-manager.md?raw'
import guideAdminIt from '../../../../docs/guide/it/administrator.md?raw'
import type { Session } from '../types.ts'
import { useBrand } from '../brand.ts'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { openHelp, openSearch, releaseNotes, set, targetOf, TOURS, useHelpState, useTourDone } from './help.ts'
import { t, useLang, type Lang } from './i18n.ts'
import { useSession } from './core.ts'
import { GuideText } from './GuideText.tsx'
import { go, personal, to, type Route } from './router.ts'
import { press, SHORTCUTS, typing, type ShortcutAction, type ShortcutState } from './shortcuts.ts'

function TourOverlay() {
  const { tour } = useHelpState()
  const done = useTourDone()
  const [rect, setRect] = useState<DOMRect | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const steps = tour ? (TOURS[tour.id] ?? []).filter((s) => targetOf(s)) : []
  const step = tour ? steps[tour.step] : undefined

  useLayoutEffect(() => {
    if (!step) return
    const el = targetOf(step)
    el?.scrollIntoView({ block: 'nearest' })
    const measure = () => setRect(targetOf(step)?.getBoundingClientRect() ?? null)
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step])
  useEffect(() => {
    card.current?.focus()
  }, [tour?.step, tour?.id])
  // the keys work wherever the focus is (the menu that started the tour gives the focus back to its
  // button after the card took it)
  const count = steps.length
  useEffect(() => {
    if (!tour) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void done(tour.id)
        set({ tour: null })
      } else if (e.key === 'ArrowRight' && tour.step < count - 1) set({ tour: { ...tour, step: tour.step + 1 } })
      else if (e.key === 'ArrowLeft' && tour.step > 0) set({ tour: { ...tour, step: tour.step - 1 } })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, count, done])
  // no element of the tour on this page: nothing to show
  const missing = !!tour && !step
  useEffect(() => {
    if (missing) set({ tour: null })
  }, [missing])
  if (!tour || !step) return null
  const finish = () => {
    void done(tour.id)
    set({ tour: null })
  }
  const last = tour.step === steps.length - 1
  const pad = 6
  const box = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null
  // the card goes below the element, or above when there is no room
  const below = !box || box.top + box.height + 220 < window.innerHeight
  const left = box ? Math.min(Math.max(12, box.left), window.innerWidth - 340) : 12
  const top = box ? (below ? box.top + box.height + 10 : Math.max(12, box.top - 10 - 200)) : 80
  return (
    <div className="fixed inset-0 z-[60]" aria-live="polite">
      {box && <div aria-hidden="true" className="pointer-events-none fixed rounded-lg ring-3 ring-ring shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-all" style={box} />}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        className="fixed w-80 rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl outline-none"
        style={{ top, left }}
      >
        <p className="text-xs text-muted-foreground">{t('Step {n} of {m}', { n: String(tour.step + 1), m: String(steps.length) })}</p>
        <h2 id="tour-title" className="mt-1 font-semibold">
          {t(step.title)}
        </h2>
        <p className="mt-1 text-sm">{t(step.text)}</p>
        <div className="mt-4 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={finish}>
            {t('Skip the tour')}
          </Button>
          <span className="flex-1" />
          {tour.step > 0 && (
            <Button variant="outline" size="sm" onClick={() => set({ tour: { ...tour, step: tour.step - 1 } })}>
              {t('Back')}
            </Button>
          )}
          {last ? (
            <Button size="sm" onClick={finish}>
              {t('Done')}
            </Button>
          ) : (
            <Button size="sm" onClick={() => set({ tour: { ...tour, step: tour.step + 1 } })}>
              {t('Next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ guide and what is new

/** The guides of docs/guide, in English and Italian, one per role. */
const GUIDES: Record<Lang, Record<GuideName, string>> = {
  en: { user: guideUser, 'tenant-manager': guideManager, administrator: guideAdmin },
  it: { user: guideUserIt, 'tenant-manager': guideManagerIt, administrator: guideAdminIt },
}
type GuideName = 'user' | 'tenant-manager' | 'administrator'

/** The guide of the role of the person: the Administrator's on the platform, the Tenant Manager's in a
 *  tenant they manage, otherwise the one for the people who work in a tenant. */
function guideOf(route: Route, session: Session | null | undefined): GuideName {
  if (route.area === 'admin') return 'administrator'
  if (route.area === 'tenant' && session?.memberships.find((m) => m.slug === route.tenant)?.role === 'tenant_manager') return 'tenant-manager'
  return 'user'
}

/** The guides built into the shell (when the identity has no address of a guide of its own). */
function Guide({ start }: { start: GuideName }) {
  const lang = useLang()
  const [name, setName] = useState<GuideName>(start)
  useEffect(() => setName(start), [start])
  const tabs: [GuideName, string][] = [
    ['user', t('Working in a tenant')],
    ['tenant-manager', t('Tenant Manager')],
    ['administrator', t('Administrator')],
  ]
  return (
    <div className="grid gap-3">
      <div role="tablist" aria-label={t('Guides')} className="flex flex-wrap gap-1 border-b pb-2">
        {tabs.map(([id, label]) => (
          <Button key={id} type="button" role="tab" aria-selected={name === id} size="sm" variant={name === id ? 'secondary' : 'ghost'} onClick={() => setName(id)}>
            {label}
          </Button>
        ))}
      </div>
      <div role="tabpanel">
        <GuideText text={GUIDES[lang][name]} onGuide={(g) => (g === 'user' || g === 'tenant-manager' || g === 'administrator') && setName(g)} />
      </div>
    </div>
  )
}

function WhatsNew({ version }: { version: string }) {
  // the notes in the language of the person (CHANGELOG.md in English, CHANGELOG.it.md in Italian)
  const lang = useLang()
  const notes = releaseNotes(lang === 'it' ? changelogIt : changelog, version)
  if (!notes.length) return <p className="text-sm text-muted-foreground">{t('No notes for this version.')}</p>
  return (
    <div className="grid gap-4">
      {notes.map((g, i) => (
        <section key={i}>
          {g.group && <h3 className="text-sm font-semibold">{g.group}</h3>}
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {g.items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex gap-1">
      {keys.map((k) => (
        <kbd key={k} className="min-w-6 rounded border bg-muted px-1.5 text-center font-mono text-xs">
          {k}
        </kbd>
      ))}
    </span>
  )
}

function HelpDialog({ open, title, description, wide, children }: { open: boolean; title: string; description: string; wide?: boolean; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && set({ open: null })}>
      <DialogContent className={cn('max-h-[85vh] overflow-y-auto', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/** Dialogs, tour and keyboard shortcuts of the shell. */
export function HelpLayer({ route, search }: { route: Route; search: boolean }) {
  const { open } = useHelpState()
  const brand = useBrand()
  const session = useSession().data
  const seq = useRef<ShortcutState>({ pending: null, at: 0 })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e.target) || document.querySelector('[role="dialog"][data-state="open"]')) return
      const r = press(seq.current, e.key, Date.now(), { ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey })
      seq.current = r.state
      if (!r.action) return
      e.preventDefault()
      run(r.action, route, search)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route, search])
  return (
    <>
      <TourOverlay />
      <HelpDialog open={open === 'guide'} title={t('Guide of Mosaikit')} description={t('The guide of your role; the others are a click away.')} wide>
        <Guide start={guideOf(route, session)} />
      </HelpDialog>
      <HelpDialog open={open === 'whatsnew'} title={t('What is new in version {v}', { v: brand.version || '1.0' })} description={t('The changes of this version.')}>
        <WhatsNew version={brand.version} />
      </HelpDialog>
      <HelpDialog open={open === 'shortcuts'} title={t('Keyboard shortcuts')} description={t('Outside the fields where you type.')}>
        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.filter((s) => search || s.action !== 'search').map((s) => (
              <tr key={s.keys.join('+')} className="border-b last:border-0">
                <td className="py-2 pr-4">
                  <Keys keys={s.keys} />
                </td>
                <td className="py-2">{t(s.label)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </HelpDialog>
    </>
  )
}

function run(a: ShortcutAction, route: Route, search: boolean) {
  const tenant = route.area === 'tenant' ? route.tenant : null
  if (a === 'search') return search && openSearch()
  if (a === 'help') return openHelp('shortcuts')
  if (a === 'home') return go(tenant ? to.tenant(tenant) : to.admin())
  if (a === 'notifications') return go(personal(route, 'notifications'))
  if (a === 'account') return go(personal(route, 'account'))
  if (a === 'trash' && tenant) return go(to.tenant(tenant, 'trash'))
}
