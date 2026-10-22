// Mattoni delle pagine (docs/refactoring-ui.md §9): intestazione con breadcrumb, badge di stato, una
// sola azione primaria e il menu «⋯»; pagina a sezioni (impostazioni) o a schede (dettaglio di un
// oggetto); barra di salvataggio solo con modifiche; impostazioni gestite dalla piattaforma; dialoghi
// con un modulo, stati vuoti e di caricamento.

import { useState, type FormEvent, type ReactNode } from 'react'
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

/** Intestazione della pagina: breadcrumb, titolo con il badge di stato, una sola azione primaria e,
 *  nel menu «⋯», le altre azioni e il cambio di stato (voci di DropdownMenu). */
export function PageHeader({ title, sub, crumbs, badge, actions, more }: { title: string; sub?: ReactNode; crumbs?: Crumb[]; badge?: ReactNode; actions?: ReactNode; more?: ReactNode }) {
  return (
    <div className="flex min-h-[57px] flex-wrap items-center gap-3 border-b px-6 py-2 max-[620px]:px-4">
      <div className="min-w-0 flex-1">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label={t('Percorso')} className="mb-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
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
      {(actions || more) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {more && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t('Altre azioni')}>
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

/** Schede orizzontali del dettaglio di un oggetto (persona, gruppo, tenant, plugin). */
export function Tabs({ tabs, current, href }: { tabs: { id: string; label: string; count?: number }[]; current: string; href: (id: string) => string }) {
  return (
    <nav aria-label={t('Schede')} className="flex gap-1 overflow-x-auto border-b px-6 max-[620px]:px-4">
      {tabs.map((t) => (
        <a
          key={t.id}
          href={href(t.id)}
          aria-current={t.id === current ? 'page' : undefined}
          className={cn(
            'relative flex h-10 shrink-0 items-center gap-1.5 px-3 text-sm text-muted-foreground hover:text-foreground',
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

/** Filtri a pillole sopra un elenco («Mostra: Tutte · Pubbliche»). */
export function Pills({ items, value, onChange, label = t('Mostra') }: { items: { id: string; label: string; count?: number }[]; value: string; onChange: (id: string) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
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
          {it.count != null && <span className="ml-1.5 tabular-nums opacity-80">{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Barra «Modifiche non salvate»: compare solo quando qualcosa e' cambiato. */
export function SaveBar({ dirty, busy, onSave, onCancel }: { dirty: boolean; busy?: boolean; onSave: () => void; onCancel: () => void }) {
  if (!dirty) return null
  return (
    <div role="region" aria-label={t('Modifiche non salvate')} className="sticky bottom-0 z-10 -mx-6 mt-6 flex items-center gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur max-[620px]:-mx-4 max-[620px]:px-4">
      <span className="flex-1 text-sm font-medium">{t('Modifiche non salvate')}</span>
      <Button variant="outline" onClick={onCancel} disabled={busy}>
        {t('Annulla')}
      </Button>
      <Button onClick={onSave} disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        Salva
      </Button>
    </div>
  )
}

/** Un'impostazione gestita dalla piattaforma: il valore in sola lettura, con il lucchetto. */
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
        {t('Gestita dall’Administrator')}
      </Badge>
    </div>
  )
}

export interface Section {
  id: string
  label: string
  icon: ReactNode
  count?: number
  /** intestazione di gruppo prima della sezione */
  group?: string
}

/** Una pagina a sezioni: l'elenco a sinistra (un menu a tendina sul telefono), una sezione alla volta. */
export function Sections({ sections, current, href, children }: { sections: Section[]; current: string; href: (id: string) => string; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 max-[760px]:flex-col">
      <nav aria-label={t('Sezioni')} className="w-60 shrink-0 border-r bg-pane p-3 max-[760px]:w-auto max-[760px]:border-r-0 max-[760px]:border-b">
        <div className="hidden max-[760px]:block">
          <Select value={current} onValueChange={(v) => go(href(v))}>
            <SelectTrigger className="w-full bg-background" aria-label={t('Sezione')}>
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
    active: [t('attivo'), 'bg-ok/10 text-ok'],
    suspended: [t('sospeso'), 'bg-destructive/10 text-destructive'],
    disabled: [t('disabilitato'), 'bg-destructive/10 text-destructive'],
    pending: [t('in attesa'), 'bg-warn/10 text-warn'],
    installed: [t('installato'), 'bg-warn/10 text-warn'],
    blocked: [t('bloccato'), 'bg-destructive/10 text-destructive'],
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
  type?: 'text' | 'password' | 'number'
  required?: boolean
  hint?: string
  options?: [string, string][]
  initial?: string
}

/** Un dialogo con un modulo: i campi sono testo, password o una scelta. */
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
      /* il messaggio d'errore lo mostra chi chiama (toast) */
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
              {t('Annulla')}
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

/** Una tabella di righe qualsiasi (i KPI dei plugin): le colonne sono le chiavi della prima riga. */
export function DataTable({ rows, label }: { rows: Record<string, unknown>[]; label?: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t('Nessun dato.')}</p>
  const cols = Object.keys(rows[0])
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c} className="capitalize">
                {c.replace(/_/g, ' ')}
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

/** I KPI dichiarati dai plugin, una tabella ciascuno. */
export function PluginKpis({ items }: { items: PluginKpi[] }) {
  if (!items.length) return null
  return (
    <>
      {items.map((p) => (
        <section key={p.plugin_id + p.view} className="grid gap-3">
          <h2 className="text-sm font-semibold">
            {p.plugin} · {p.label}
          </h2>
          <DataTable rows={p.rows} label={`${p.plugin} · ${p.label}`} />
        </section>
      ))}
    </>
  )
}
