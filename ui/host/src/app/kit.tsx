// Building blocks of the pages (docs/refactoring-ui.md §9): header with breadcrumb, status badge, a
// single primary action and the «⋯» menu; page with sections (settings) or tabs (detail of an
// object); save bar only with changes; settings managed by the platform; dialogs
// with a form, empty and loading states.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ChevronRight, Loader2, Lock, MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { PluginKpi } from '../types.ts'
import { t } from './i18n.ts'
import { go } from './router.ts'

export interface Crumb {
  label: string
  href?: string
}

/** Header of the page: breadcrumb, title with the status badge, a single primary action and,
 *  in the «⋯» menu, the other actions and the change of state (DropdownMenu items). */
export function PageHeader({ title, sub, crumbs, badge, lead, bar, actions, more }: { title: string; sub?: ReactNode; crumbs?: Crumb[]; badge?: ReactNode; lead?: ReactNode; bar?: ReactNode; actions?: ReactNode; more?: ReactNode }) {
  return (
    // under the band, and it stays there while the page scrolls
    <div data-tour="page-header" className="msk-page-header sticky top-(--msk-top) z-10 flex min-h-(--msk-head) flex-wrap items-center gap-3 border-b bg-background px-6 py-2 max-[620px]:px-4">
      {lead}
      <div className="min-w-0 flex-1">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label={t('Breadcrumb')} className="mb-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                {c.href ? (
                  <a href={c.href} className="truncate hover:text-foreground hover:underline">
                    {c.label}
                  </a>
                ) : (
                  <span className="truncate">{c.label}</span>
                )}
                <ChevronRight className="size-3 shrink-0" />
              </span>
            ))}
          </nav>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          {badge}
        </div>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      {bar}
      {(actions || more) && (
        <div data-tour="page-actions" className="flex flex-wrap items-center gap-2">
          {actions}
          {more && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t('More actions')}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {more}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  )
}

/** Horizontal tabs of the detail of an object (person, group, tenant, plugin). */
export function Tabs({ tabs, current, href }: { tabs: { id: string; label: string; count?: number }[]; current: string; href: (id: string) => string }) {
  return (
    <nav aria-label={t('Tabs')} className="flex gap-1 overflow-x-auto border-b px-6 max-[620px]:px-4">
      {tabs.map((t) => (
        <a
          key={t.id}
          href={href(t.id)}
          aria-current={t.id === current ? 'page' : undefined}
          className={cn(
            'msk-tab relative flex h-10 shrink-0 items-center gap-1.5 px-3 text-sm text-muted-foreground hover:text-foreground',
            t.id === current && "font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary after:content-['']",
          )}
        >
          {t.label}
          {t.count != null && <span className="text-xs tabular-nums">{t.count}</span>}
        </a>
      ))}
    </nav>
  )
}

/** Pill filters above a list («Show: All · Public»). */
export function Pills({ items, value, onChange, label = t('Show') }: { items: { id: string; label: string; count?: number }[]; value: string; onChange: (id: string) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="msk-pills sticky top-[calc(var(--msk-top)+var(--msk-head))] z-[5] -mx-1 flex flex-wrap items-center gap-1.5 bg-background px-1 py-1.5">
      <span className="mr-1 text-xs text-muted-foreground">{label}</span>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={it.id === value}
          onClick={() => onChange(it.id)}
          className={cn(
            'h-7 rounded-full border px-3 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
            it.id === value && 'border-primary bg-primary text-primary-foreground hover:bg-primary',
          )}
        >
          {it.label}
          {it.count != null && <span className={cn("ml-1.5 tabular-nums", it.id !== value && "opacity-80")}>{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** «Unsaved changes» bar: it appears only when something changed. */
export function SaveBar({ dirty, busy, onSave, onCancel }: { dirty: boolean; busy?: boolean; onSave: () => void; onCancel: () => void }) {
  if (!dirty) return null
  return (
    <div role="region" aria-label={t('Unsaved changes')} className="sticky bottom-0 z-10 -mx-6 mt-6 flex items-center gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur max-[620px]:-mx-4 max-[620px]:px-4">
      <span className="flex-1 text-sm font-medium">{t('Unsaved changes')}</span>
      <Button variant="outline" onClick={onCancel} disabled={busy}>
        {t('Cancel')}
      </Button>
      <Button onClick={onSave} disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        {t('Save')}
      </Button>
    </div>
  )
}

/** A setting managed by the platform: the value read only, with the padlock. */
export function Locked({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/40 p-3">
      <span className="min-w-0">
        <b className="block text-sm">{label}</b>
        <span className="text-sm">{value}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
        <Lock className="size-3" />
        {t('Managed by the Administrator')}
      </Badge>
    </div>
  )
}

export interface Section {
  id: string
  label: string
  icon: ReactNode
  count?: number
  /** group heading before the section */
  group?: string
}

/** A page with sections: the list on the left (a drop-down menu on the phone), one section at a time. */
export function Sections({ sections, current, href, children }: { sections: Section[]; current: string; href: (id: string) => string; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 max-[760px]:flex-col">
      <nav data-tour="sections" aria-label={t('Sections')} className="w-60 shrink-0 border-r bg-pane p-3 max-[760px]:w-auto max-[760px]:border-r-0 max-[760px]:border-b">
        <div className="hidden max-[760px]:block">
          <Select value={current} onValueChange={(v) => go(href(v))}>
            <SelectTrigger className="w-full bg-background" aria-label={t('Section')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul className="grid gap-0.5 max-[760px]:hidden">
          {sections.map((s) => (
            <li key={s.id}>
              {s.group && <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase first:pt-0">{s.group}</div>}
              <a
                href={href(s.id)}
                aria-current={s.id === current ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center gap-2.5 rounded-md px-3 text-sm text-foreground/85 hover:bg-accent [&>svg]:size-4 [&>svg]:shrink-0',
                  // under a group heading the sections are indented
                  sections.some((x) => x.group) && 'pl-5',
                  s.id === current && 'bg-primary/10 font-medium text-primary-strong hover:bg-primary/10',
                )}
              >
                {s.icon}
                <span className="flex-1 truncate">{s.label}</span>
                {s.count != null && <span className="text-xs text-muted-foreground tabular-nums">{s.count}</span>}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 overflow-auto p-6 max-[620px]:p-4">{children}</div>
    </div>
  )
}

/** The foot of a long list: how many rows are shown of how many. The next page loads by itself when
 *  the foot comes into view (infinite scroll); «Load more» stays for the keyboard and for browsers
 *  without IntersectionObserver. */
export function MoreRows({ shown, total, more, loading, onMore }: { shown: number; total: number; more: boolean; loading?: boolean; onMore: () => void }) {
  const foot = useRef<HTMLDivElement>(null)
  const act = useRef(onMore)
  useEffect(() => {
    act.current = onMore
  })
  useEffect(() => {
    const el = foot.current
    if (!el || !more || loading || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && act.current(), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
    // a page that arrived and left the foot in view must ask for the next: observe again
  }, [more, loading, shown])
  if (!total) return null
  return (
    <div ref={foot} className="flex flex-wrap items-center justify-center gap-3 py-2 text-sm text-muted-foreground">
      <span className="tabular-nums">{t('{shown} of {total}', { shown: String(shown), total: String(total) })}</span>
      {more && (
        <Button variant="outline" size="sm" disabled={loading} onClick={onMore}>
          {loading && <Loader2 className="animate-spin" />}
          {t('Load more')}
        </Button>
      )}
    </div>
  )
}

/** With a whole page selected and more rows matching: «Select all N». The selection then holds every
 *  row of the filter (up to 10,000), loaded or not; the actions apply to all of them. */
export function SelectAllRows({ selected, total, onAll }: { selected: number; total: number; onAll: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  if (selected >= total) return null
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto p-0"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void onAll().finally(() => setBusy(false))
      }}
    >
      {t('Select all {total}', { total: String(total) })}
    </Button>
  )
}

export function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center p-10 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground [&>svg]:size-7">
      {icon}
      <b className="text-foreground">{title}</b>
      {children}
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  return <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error instanceof Error ? error.message : String(error)}</p>
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    active: [t('active'), 'bg-ok/10 text-ok'],
    suspended: [t('suspended'), 'bg-destructive/10 text-destructive'],
    disabled: [t('disabled'), 'bg-destructive/10 text-destructive'],
    pending: [t('pending'), 'bg-warn/10 text-warn'],
    installed: [t('installed'), 'bg-warn/10 text-warn'],
    blocked: [t('blocked'), 'bg-destructive/10 text-destructive'],
  }
  const [label, cls] = map[status] ?? [status, '']
  return (
    <Badge variant="secondary" className={cn('font-normal', cls)}>
      {label}
    </Badge>
  )
}

export interface FieldDef {
  name: string
  label: string
  type?: 'text' | 'password' | 'number' | 'email'
  required?: boolean
  hint?: string
  options?: [string, string][]
  initial?: string
}

/** A dialog with a form: the fields are text, password or a choice. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  submit,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  fields: FieldDef[]
  submit: string
  onSubmit: (v: Record<string, string>) => Promise<unknown>
}) {
  const init = () => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.options ? f.options[0][0] : '')]))
  const [v, setV] = useState<Record<string, string>>(init)
  const [busy, setBusy] = useState(false)
  async function send(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await onSubmit(v)
      onOpenChange(false)
      setV(init())
    } catch {
      /* the caller shows the error message (toast) */
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setV(init())
        onOpenChange(o)
      }}
    >
      <DialogContent>
        <form onSubmit={(e) => void send(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {fields.map((f) => (
            <div key={f.name} className="grid gap-1.5">
              <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
              {f.options ? (
                <Select value={v[f.name]} onValueChange={(x) => setV({ ...v, [f.name]: x })}>
                  <SelectTrigger id={`f-${f.name}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map(([val, lab]) => (
                      <SelectItem key={val} value={val}>
                        {lab}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`f-${f.name}`}
                  type={f.type ?? 'text'}
                  autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                  minLength={f.type === 'password' ? 10 : undefined}
                  required={f.required}
                  value={v[f.name] ?? ''}
                  onChange={(e) => setV({ ...v, [f.name]: e.target.value })}
                />
              )}
              {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function Kpi({ label, value, hint, onClick }: { label: string; value: ReactNode; hint?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <b className="text-2xl font-semibold tabular-nums">{value}</b>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </>
  )
  const cls = 'flex flex-col gap-1 rounded-xl border bg-card p-4 text-left'
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'hover:border-primary/50 hover:bg-accent/40')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** A table of any rows (the KPIs of the plugins): the columns are the keys of the first row. */
export function DataTable({ rows, label, columns = {} }: { rows: Record<string, unknown>[]; label?: string; columns?: Record<string, string> }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t('No data.')}</p>
  const cols = Object.keys(rows[0])
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c} className={columns[c] ? undefined : 'capitalize'}>
                {columns[c] ?? c.replace(/_/g, ' ')}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {cols.map((c) => (
                <TableCell key={c} className={typeof r[c] === 'number' ? 'text-right tabular-nums' : undefined}>
                  {r[c] === null || r[c] === undefined ? '—' : String(r[c])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** The KPIs declared by the plugins, one table each. */
export function PluginKpis({ items }: { items: PluginKpi[] }) {
  if (!items.length) return null
  return (
    <>
      {items.map((p) => (
        <section key={p.plugin_id + p.view} className="grid gap-3">
          <h2 className="text-sm font-semibold">
            {p.plugin} · {p.label}
          </h2>
          <DataTable rows={p.rows} label={`${p.plugin} · ${p.label}`} columns={p.columns} />
        </section>
      ))}
    </>
  )
}
