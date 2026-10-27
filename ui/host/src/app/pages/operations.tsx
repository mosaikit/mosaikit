// Lifecycle of the tenants and operations of the platform (Administrator; docs/architecture.md,
// "Lifecycle of the tenants" and "Operations"): the "New tenant" wizard, trial, export, archive and
// deletion of a tenant, import of an export, System › Backup and Maintenance, the Monitoring pages, the
// services and "To do" panels of the overview, and the notice of the maintenance for everybody.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, Archive, BellRing, Check, CircleAlert, Download, Gauge, HardDrive, Loader2, Play, Server, ShieldAlert, Trash2, Upload, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, appUrl, errText, fmtBytes } from '../../api.ts'
import { reloadBrand, useBrand } from '../../brand.ts'
import type {
  AdminPlugin,
  AdminUser,
  AlertSettings,
  AlertState,
  BackupInfo,
  BackupItem,
  BackupItems,
  BackupSettings,
  CatalogItem,
  Capacity,
  ExportManifest,
  ImportReport,
  ItemRestoreReport,
  Maintenance,
  MetricPoint,
  ServiceState,
  TenantImpact,
  TenantInfo,
  TenantLoad,
} from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { passwordMin, useAction, useApi, useConfig, useConfirm } from '../core.ts'
import { fmtDay, fmtNumber, t } from '../i18n.ts'
import { Empty, ErrorBox, Kpi, Loading, PageHeader, Pills, SaveBar, Sections } from '../kit.tsx'
import { go, to } from '../router.ts'

const enc = encodeURIComponent

/** The time, refreshed every minute (what is planned or ending soon depends on it). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/* ── Notice of the maintenance ───────────────────────────────────────── */

/** The maintenance for everybody: on (only the Administrators work) or planned. The brand is read again
 *  every minute, so a planned maintenance shows up without reloading. */
export function MaintenanceBanner({ admin }: { admin: boolean }) {
  const brand = useBrand()
  const now = useNow()
  useEffect(() => {
    const id = setInterval(reloadBrand, 60_000)
    return () => clearInterval(id)
  }, [])
  const m = brand.maintenance
  if (!m) return null
  const planned = m.planned_at && new Date(m.planned_at).getTime() > now
  if (!m.on && !planned) return null
  return (
    <div role="status" className={cn('flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm', m.on ? 'bg-warn/15 text-foreground' : 'bg-primary/10 text-foreground')}>
      <Wrench className="size-4 shrink-0" />
      {m.on ? (
        <span>
          <b>{t('Maintenance mode is on')}</b> · {t('only the Administrators can work.')} {m.message}
        </span>
      ) : (
        <span>
          <b>{t('Maintenance planned on {date}', { date: fmtDay(m.planned_at, { dateStyle: 'medium', timeStyle: 'short' }) })}</b>
          {m.planned_message ? ` · ${m.planned_message}` : ''}
        </span>
      )}
      {admin && (
        <a className="ml-auto underline-offset-4 hover:underline" href={to.admin('system', 'maintenance')}>
          {t('Maintenance')}
        </a>
      )}
    </div>
  )
}

/** The notice on the sign-in page. */
export function MaintenanceNotice() {
  const m = useBrand().maintenance
  const now = useNow()
  if (!m) return null
  const planned = m.planned_at && new Date(m.planned_at).getTime() > now
  if (!m.on && !planned) return null
  return (
    <div role="status" className="mb-4 flex gap-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm">
      <Wrench className="mt-0.5 size-4 shrink-0" />
      <div>
        <b className="block">{m.on ? t('The platform is under maintenance') : t('Maintenance planned on {date}', { date: fmtDay(m.planned_at, { dateStyle: 'medium', timeStyle: 'short' }) })}</b>
        <span className="text-muted-foreground">{m.on ? m.message || t('Only the Administrators can sign in. Try again later.') : m.planned_message}</span>
      </div>
    </div>
  )
}

/* ── New tenant, in four steps ───────────────────────────────────────── */

interface Wizard {
  name: string
  slug: string
  trial: boolean
  trial_until: string
  oidc: boolean
  issuer: string
  client_id: string
  client_secret: string
  roles_source: 'mosaikit' | 'idp'
  manager_username: string
  manager_display_name: string
  manager_email: string
  manager_password: string
}

const EMPTY: Wizard = {
  name: '',
  slug: '',
  trial: false,
  trial_until: '',
  oidc: false,
  issuer: '',
  client_id: '',
  client_secret: '',
  roles_source: 'mosaikit',
  manager_username: '',
  manager_display_name: '',
  manager_email: '',
  manager_password: '',
}

function slugOf(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** "New tenant" (dlg-new-organization): tenant, sign-in, Tenant Manager, summary. */
export function NewTenantWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const pwMin = passwordMin(useConfig())
  const now = useNow()
  const [step, setStep] = useState(0)
  const [w, setW] = useState<Wizard>(EMPTY)
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<Wizard>) => setW((x) => ({ ...x, ...p }))
  useEffect(() => {
    if (open) {
      setStep(0)
      setW(EMPTY)
      setSlugTouched(false)
    }
  }, [open])
  const steps = [t('Tenant'), t('Sign-in'), t('Tenant Manager'), t('Summary')]
  const valid = [
    !!w.name.trim() && /^[a-z0-9][a-z0-9-]{1,39}$/.test(w.slug) && (!w.trial || !!w.trial_until),
    !w.oidc || (!!w.issuer.trim() && !!w.client_id.trim()),
    !!w.manager_username.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.manager_email.trim()) && w.manager_password.length >= pwMin,
    true,
  ]
  async function create() {
    setBusy(true)
    try {
      const tn = await api<TenantInfo>('POST', '/api/admin/tenants', {
        slug: w.slug,
        name: w.name.trim(),
        manager_username: w.manager_username.trim(),
        manager_display_name: w.manager_display_name.trim(),
        manager_email: w.manager_email.trim(),
        manager_password: w.manager_password,
        trial_until: w.trial ? new Date(`${w.trial_until}T23:59:59`).toISOString() : null,
      })
      if (w.oidc) {
        await api('PUT', `/api/admin/tenants/${tn.id}/sign-in`, {
          enabled: true,
          issuer: w.issuer.trim(),
          client_id: w.client_id.trim(),
          client_secret: w.client_secret || undefined,
          roles_source: w.roles_source,
          manager_groups: [],
          user_groups: [],
        })
      }
      await qc.invalidateQueries({ queryKey: ['admin-tenants'] })
      await qc.invalidateQueries({ queryKey: ['admin-overview'] })
      toast.success(t('Tenant {name} created with its Tenant Manager', { name: tn.name }))
      onOpenChange(false)
      go(to.adminTenant(tn.id))
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('New tenant')}</DialogTitle>
          <DialogDescription>{t('Step {n} of {total}: {name}', { n: step + 1, total: steps.length, name: steps[step] })}</DialogDescription>
        </DialogHeader>
        <ol className="flex gap-1" aria-label={t('Steps')}>
          {steps.map((s, i) => (
            <li key={s} aria-current={i === step ? 'step' : undefined} className={cn('h-1.5 flex-1 rounded-full', i <= step ? 'bg-primary' : 'bg-muted')}>
              <span className="sr-only">{s}</span>
            </li>
          ))}
        </ol>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid[step]) return
            if (step < steps.length - 1) setStep(step + 1)
            else void create()
          }}
        >
          {step === 0 && (
            <>
              <Field id="nt-name" label={t('Name')}>
                <Input
                  id="nt-name"
                  required
                  value={w.name}
                  onChange={(e) => set({ name: e.target.value, slug: slugTouched ? w.slug : slugOf(e.target.value) })}
                />
              </Field>
              <Field id="nt-slug" label={t('Identifier')} hint={t('Lowercase letters, digits and hyphens: it goes in the address and does not change')}>
                <Input
                  id="nt-slug"
                  className="font-mono"
                  required
                  value={w.slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    set({ slug: e.target.value.toLowerCase() })
                  }}
                />
              </Field>
              <label className="flex items-center justify-between gap-4 rounded-md border p-3">
                <span>
                  <b className="block text-sm">{t('Trial period')}</b>
                  <span className="text-xs text-muted-foreground">{t('At the end the tenant is suspended; the data stay.')}</span>
                </span>
                <Switch checked={w.trial} onCheckedChange={(v) => set({ trial: v })} aria-label={t('Trial period')} />
              </label>
              {w.trial && (
                <Field id="nt-trial" label={t('End of the trial')}>
                  <Input id="nt-trial" type="date" required value={w.trial_until} min={new Date(now + 86400000).toISOString().slice(0, 10)} onChange={(e) => set({ trial_until: e.target.value })} />
                </Field>
              )}
            </>
          )}
          {step === 1 && (
            <>
              <div className="grid gap-2" role="radiogroup" aria-label={t('Sign-in')}>
                {[
                  [false, t('Local accounts'), t('People sign in with a username and a password kept by Mosaikit.')],
                  [true, t('Identity provider (OIDC)'), t('People sign in with the provider of the tenant (Keycloak, Entra ID…), never both.')],
                ].map(([v, label, hint]) => (
                  <button
                    key={String(v)}
                    type="button"
                    role="radio"
                    aria-checked={w.oidc === v}
                    onClick={() => set({ oidc: v as boolean })}
                    className={cn('rounded-md border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', w.oidc === v && 'border-primary ring-1 ring-primary')}
                  >
                    <b className="block text-sm">{label as string}</b>
                    <span className="text-xs text-muted-foreground">{hint as string}</span>
                  </button>
                ))}
              </div>
              {w.oidc && (
                <>
                  <Field id="nt-issuer" label={t('Address of the provider (issuer)')}>
                    <Input id="nt-issuer" className="font-mono" required placeholder="https://login.example.org/realms/staff" value={w.issuer} onChange={(e) => set({ issuer: e.target.value })} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="nt-client" label={t('Client id')}>
                      <Input id="nt-client" className="font-mono" required value={w.client_id} onChange={(e) => set({ client_id: e.target.value })} />
                    </Field>
                    <Field id="nt-secret" label={t('Client secret')}>
                      <Input id="nt-secret" type="password" autoComplete="new-password" value={w.client_secret} onChange={(e) => set({ client_secret: e.target.value })} />
                    </Field>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('Roles, groups and the check of the configuration are on the Sign-in tab of the tenant.')}</p>
                </>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-sm text-muted-foreground">
                {w.oidc ? t('The first Tenant Manager is a local account, to set the tenant up until the provider gives the roles.') : t('The first Tenant Manager invites the others and chooses the settings of the tenant.')}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="nt-user" label={t('Username of the Tenant Manager')}>
                  <Input id="nt-user" required autoComplete="off" value={w.manager_username} onChange={(e) => set({ manager_username: e.target.value })} />
                </Field>
                <Field id="nt-dname" label={t('Name of the Tenant Manager')}>
                  <Input id="nt-dname" value={w.manager_display_name} onChange={(e) => set({ manager_display_name: e.target.value })} />
                </Field>
              </div>
              <Field id="nt-email" label={t('Email of the Tenant Manager')} hint={t('Required: the password is recovered at this address.')}>
                <Input id="nt-email" type="email" required autoComplete="off" value={w.manager_email} onChange={(e) => set({ manager_email: e.target.value })} />
              </Field>
              <Field id="nt-pw" label={t('Initial password')} hint={t('At least {n} characters', { n: pwMin })}>
                <Input id="nt-pw" type="password" autoComplete="new-password" required minLength={pwMin} value={w.manager_password} onChange={(e) => set({ manager_password: e.target.value })} />
              </Field>
            </>
          )}
          {step === 3 && (
            <div className="grid gap-3 text-sm">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
                <dt className="text-muted-foreground">{t('Tenant')}</dt>
                <dd>
                  {w.name} <span className="font-mono text-muted-foreground">{w.slug}</span>
                </dd>
                <dt className="text-muted-foreground">{t('Trial period')}</dt>
                <dd>{w.trial ? t('until {date}', { date: fmtDay(w.trial_until) }) : t('No')}</dd>
                <dt className="text-muted-foreground">{t('Sign-in')}</dt>
                <dd>{w.oidc ? `${t('Identity provider (OIDC)')} · ${w.issuer}` : t('Local accounts')}</dd>
                <dt className="text-muted-foreground">{t('Tenant Manager')}</dt>
                <dd>{w.manager_display_name || w.manager_username}</dd>
              </dl>
              <div className="rounded-md border bg-muted/40 p-3">
                <b className="mb-1 block">{t('The platform prepares by itself')}</b>
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  <li>{t('the Standard permission profile, for whoever has none')}</li>
                  <li>{t('the plugins available by default, turned on')}</li>
                  <li>{t('the settings of the platform: theme, languages, rules of the passwords')}</li>
                  <li>{t('its place in the backups and in Monitoring')}</li>
                </ul>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                {t('Back')}
              </Button>
            )}
            <Button type="submit" disabled={!valid[step] || busy}>
              {busy && <Loader2 className="animate-spin" />}
              {step < steps.length - 1 ? t('Next') : t('Create the tenant')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Import of an export ─────────────────────────────────────────────── */

export function ImportTenantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  async function send(replace: boolean): Promise<void> {
    if (!file) return
    setBusy(true)
    try {
      const r = await api<ImportReport>('POST', `/api/admin/tenants/import${replace ? '?replace=true' : ''}`, undefined, { raw: file })
      await qc.invalidateQueries({ queryKey: ['admin-tenants'] })
      toast.success(t('Tenant {name} imported: {rows} rows, {files} files', { name: r.name, rows: r.rows, files: r.files }))
      if (r.people_missing > 0) toast.info(t('{n} people of other tenants were not found: their rows were left out', { n: r.people_missing }))
      onOpenChange(false)
      go(to.adminTenant(r.tenant_id))
    } catch (e) {
      if (e instanceof ApiError && e.code === 'tenant_exists' && !replace) {
        setBusy(false)
        if (await confirm(t('The tenant of this export exists. Replace it? Everything it holds now is deleted.'), true)) return send(true)
        return
      }
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Import a tenant')}</DialogTitle>
          <DialogDescription>{t('From the zip of an export: the tenant comes back with its people, items and contents.')}</DialogDescription>
        </DialogHeader>
        <Field id="imp-file" label={t('Export (zip)')}>
          <Input id="imp-file" type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button disabled={!file || busy} onClick={() => void send(false)}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            {t('Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Lifecycle of a tenant (its Details tab) ─────────────────────────── */

function downloadUrl(path: string): string {
  return appUrl(path)
}

/** Trial period, read-only logo, export, archive and delete (mockup tenant/details). */
export function TenantLifecycle({ tn }: { tn: TenantInfo }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const impact = useApi<TenantImpact>(['admin-impact', tn.id], `/api/admin/tenants/${tn.id}/impact`)
  const [trial, setTrial] = useState(tn.trial_until ? tn.trial_until.slice(0, 10) : '')
  const [exported, setExported] = useState<{ file: string; size: number; manifest: ExportManifest } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-tenants'] })
    void qc.invalidateQueries({ queryKey: ['admin-overview'] })
    void qc.invalidateQueries({ queryKey: ['admin-impact', tn.id] })
  }
  const saveTrial = useAction((until: string | null) => api('PUT', `/api/admin/tenants/${tn.id}/trial`, { until }), {
    ok: (u) => (u ? t('Trial period saved') : t('Trial period removed')),
    invalidate: [['admin-tenants']],
  })
  const archive = useAction(() => api('POST', `/api/admin/tenants/${tn.id}/archive`), { ok: t('Tenant archived'), invalidate: [['admin-tenants'], ['admin-overview']] })
  async function doExport() {
    setExporting(true)
    try {
      setExported(await api('POST', `/api/admin/tenants/${tn.id}/export`))
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setExporting(false)
    }
  }
  const lost = impact.data
    ? t('{people} people, {guests} guests, {groups} groups, {items} items ({bytes}), {links} public links', {
        people: impact.data.people,
        guests: impact.data.guests,
        groups: impact.data.groups,
        items: impact.data.items,
        bytes: fmtBytes(impact.data.bytes),
        links: impact.data.public_links,
      })
    : ''
  const archived = !!tn.archived_at
  return (
    <div className="grid max-w-2xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Trial period')}</CardTitle>
          <CardDescription>{t('A week and a day before the end its Tenant Managers and the Administrators are told; at the end the tenant is suspended.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field id="tr-until" label={t('End of the trial')}>
            <Input id="tr-until" type="date" className="w-48" value={trial} onChange={(e) => setTrial(e.target.value)} />
          </Field>
          <Button variant="outline" disabled={!trial || saveTrial.isPending} onClick={() => saveTrial.mutate(new Date(`${trial}T23:59:59`).toISOString())}>
            {t('Update the trial')}
          </Button>
          {tn.trial_until && (
            <Button
              variant="ghost"
              onClick={() => {
                setTrial('')
                saveTrial.mutate(null)
              }}
            >
              {t('Remove the trial')}
            </Button>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Logo of the tenant')}</CardTitle>
          <CardDescription>{t('Its Tenant Manager chooses it in Tenant settings › Identity and texts.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <TenantLogo slug={tn.slug} name={tn.name} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Export')}</CardTitle>
          <CardDescription>{t('A zip with the data of the tenant, the rows of its plugins and its contents: to keep it, or to bring it back with Import.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={exporting} onClick={() => void doExport()}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            {t('Export the tenant')}
          </Button>
          {exported && (
            <a className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline" href={downloadUrl(`/api/admin/exports/${enc(exported.file)}`)} download>
              <Download className="size-4" />
              {exported.file} · {fmtBytes(exported.size)}
            </a>
          )}
        </CardContent>
      </Card>
      <section aria-labelledby="danger" className="grid gap-3 rounded-xl border border-destructive/40 p-4">
        <h2 id="danger" className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <ShieldAlert className="size-4" />
          {t('Archive or delete')}
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-sm text-muted-foreground">{t('Archive: nobody signs in, nothing is deleted; Reactivate brings it back.')}</p>
          <Button
            variant="outline"
            disabled={archived || archive.isPending}
            onClick={async () => {
              if (await confirm(t('Archive {name}? Nobody will sign in until it is reactivated. It holds: {lost}.', { name: tn.name, lost }), true)) archive.mutate(undefined as never)
            }}
          >
            <Archive />
            {archived ? t('Archived') : t('Archive the tenant')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p className="max-w-md text-sm text-muted-foreground">{t('Delete: everything goes, for good. Export it first if you may need it.')}</p>
          <Button variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2 />
            {t('Delete the tenant')}
          </Button>
        </div>
      </section>
      <DeleteTenantDialog tn={tn} impact={impact.data} open={deleting} onOpenChange={setDeleting} onDone={refresh} />
    </div>
  )
}

function TenantLogo({ slug, name }: { slug: string; name: string }) {
  const [ok, setOk] = useState(true)
  return ok ? (
    <img src={appUrl(`/api/auth/tenants/${enc(slug)}/logo/logo_light`)} alt={t('Logo of {name}', { name })} className="h-12 max-w-48 object-contain" onError={() => setOk(false)} />
  ) : (
    <p className="text-sm text-muted-foreground">{t('No logo: the initials of the tenant are shown.')}</p>
  )
}

function DeleteTenantDialog({ tn, impact, open, onOpenChange, onDone }: { tn: TenantInfo; impact?: TenantImpact; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setTyped('')
  }, [open])
  async function del() {
    setBusy(true)
    try {
      await api('POST', `/api/admin/tenants/${tn.id}/delete`, { confirm: typed })
      toast.success(t('Tenant {name} deleted', { name: tn.name }))
      onOpenChange(false)
      onDone()
      go(to.admin('tenants'))
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Delete {name} for good?', { name: tn.name })}</DialogTitle>
          <DialogDescription>{t('It cannot be undone. Export it first if you may need it.')}</DialogDescription>
        </DialogHeader>
        {impact && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            <li>{t('{n} people whose home is the tenant, with their accounts', { n: impact.people })}</li>
            <li>{t('{n} guests lose the access', { n: impact.guests })}</li>
            <li>{t('{n} items and their contents ({bytes})', { n: impact.items, bytes: fmtBytes(impact.bytes) })}</li>
            <li>{t('{n} groups, the settings and the log of the tenant', { n: impact.groups })}</li>
            {impact.items_elsewhere > 0 && <li>{t('{n} items its people own in other tenants pass to the Tenant Managers there', { n: impact.items_elsewhere })}</li>}
          </ul>
        )}
        <Field id="del-confirm" label={t('Type {slug} to confirm', { slug: tn.slug })}>
          <Input id="del-confirm" className="font-mono" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button variant="destructive" disabled={typed !== tn.slug || busy} onClick={() => void del()}>
            {busy && <Loader2 className="animate-spin" />}
            {t('Delete for good')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The state of a tenant with its trial and archive. */
export function TenantState({ tn }: { tn: TenantInfo }) {
  const cls = 'font-normal'
  if (tn.archived_at) return <Badge variant="secondary" className={cn(cls, 'bg-muted text-muted-foreground')}>{t('archived')}</Badge>
  if (tn.status !== 'active') return <Badge variant="secondary" className={cn(cls, 'bg-destructive/10 text-destructive dark:text-red-300')}>{t('suspended')}</Badge>
  if (tn.trial_until) return <Badge variant="secondary" className={cn(cls, 'bg-warn/10 text-warn')}>{t('on trial until {date}', { date: fmtDay(tn.trial_until) })}</Badge>
  return <Badge variant="secondary" className={cn(cls, 'bg-ok/10 text-ok')}>{t('active')}</Badge>
}

/* ── System › Backup ─────────────────────────────────────────────────── */

export function BackupPanel() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const q = useApi<{ backups: BackupInfo[]; settings: BackupSettings; running: boolean }>(['admin-backups'], '/api/admin/backups')
  const running = !!q.data?.running || !!q.data?.backups.some((b) => b.status === 'running')
  // while a backup runs the list is read again every 2 seconds
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => void qc.invalidateQueries({ queryKey: ['admin-backups'] }), 2000)
    return () => clearInterval(id)
  }, [running, qc])
  const [v, setV] = useState<BackupSettings | null>(null)
  const [restore, setRestore] = useState<BackupInfo | null>(null)
  const [restoreItem, setRestoreItem] = useState<BackupInfo | null>(null)
  const run = useAction(() => api('POST', '/api/admin/backups'), { ok: t('Backup started'), invalidate: [['admin-backups']] })
  const save = useAction((s: BackupSettings) => api('PUT', '/api/admin/backups/settings', s), {
    ok: t('Settings saved'),
    invalidate: [['admin-backups']],
  })
  const del = useAction((id: string) => api('DELETE', `/api/admin/backups/${id}`), { ok: t('Backup deleted'), invalidate: [['admin-backups']] })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const saved = q.data!.settings
  const s = v ?? saved
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(saved)
  return (
    <div className="grid max-w-4xl gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t('Backups')}</CardTitle>
            <CardDescription>{t('The database, the contents, the plugins and every tenant, in a zip in the data folder. The key of the secrets is not inside: keep it apart.')}</CardDescription>
          </div>
          <Button disabled={running || run.isPending} onClick={() => run.mutate(undefined as never)}>
            {running ? <Loader2 className="animate-spin" /> : <Play />}
            {running ? t('Backup running…') : t('Run now')}
          </Button>
        </CardHeader>
        <CardContent>
          {q.data!.backups.length === 0 ? (
            <Empty icon={<HardDrive />} title={t('No backups yet')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Started')}</TableHead>
                  <TableHead>{t('Result')}</TableHead>
                  <TableHead className="text-right">{t('Size')}</TableHead>
                  <TableHead className="text-right">{t('Tenants')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('Actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data!.backups.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      {fmtDay(b.started_at, { dateStyle: 'medium', timeStyle: 'short' })}
                      <span className="block text-xs text-muted-foreground">{b.manual ? t('by {who}', { who: b.by ?? '—' }) : t('scheduled')}</span>
                    </TableCell>
                    <TableCell>
                      {b.status === 'running' ? (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          {t('running')}
                        </span>
                      ) : b.status === 'failed' ? (
                        <span className="text-destructive">{t('failed')}: {b.error}</span>
                      ) : (
                        <span className="inline-flex flex-col">
                          <span className="inline-flex items-center gap-1.5 text-ok">
                            <Check className="size-3.5" />
                            {b.whole ? t('complete') : t('tenants only')}
                          </span>
                          {b.error && <span className="text-xs text-muted-foreground">{b.error}</span>}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.status === 'ok' ? fmtBytes(b.size_bytes) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.status === 'ok' ? b.tenants : '—'}</TableCell>
                    <TableCell className="text-right">
                      {b.status === 'ok' && (
                        <span className="inline-flex gap-1">
                          <Button variant="ghost" size="sm" asChild>
                            <a href={downloadUrl(`/api/admin/backups/${b.id}/file`)} download aria-label={t('Download the backup of {date}', { date: fmtDay(b.started_at, { dateStyle: 'medium', timeStyle: 'short' }) })}>
                              <Download />
                              {t('Download')}
                            </a>
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setRestore(b)}>
                            {t('Restore a tenant')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setRestoreItem(b)}>
                            {t('Restore an item')}
                          </Button>
                        </span>
                      )}
                      {b.status !== 'running' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('Delete the backup')}
                          onClick={async () => {
                            if (await confirm(t('Delete this backup and its file?'), true)) del.mutate(b.id)
                          }}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Schedule')}</CardTitle>
          <CardDescription>{t('Once a day at the hour chosen (UTC); the older backups beyond the number kept are deleted.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">{t('Scheduled backups')}</span>
            <Switch checked={s.enabled} onCheckedChange={(x) => setV({ ...s, enabled: x })} aria-label={t('Scheduled backups')} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="bk-hour" label={t('Hour (UTC)')}>
              <Input id="bk-hour" type="number" min={0} max={23} value={s.hour} onChange={(e) => setV({ ...s, hour: Number(e.target.value) })} />
            </Field>
            <Field id="bk-keep" label={t('Backups kept')}>
              <Input id="bk-keep" type="number" min={1} max={365} value={s.keep} onChange={(e) => setV({ ...s, keep: Number(e.target.value) })} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">{t('Restoring everything is done with the server stopped: the README.txt inside each backup explains how.')}</p>
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => save.mutate(s, { onSuccess: () => setV(null) })} onCancel={() => setV(null)} />
      {restore && <RestoreTenantDialog backup={restore} onOpenChange={(o) => !o && setRestore(null)} />}
      {restoreItem && <RestoreItemDialog backup={restoreItem} onOpenChange={(o) => !o && setRestoreItem(null)} />}
    </div>
  )
}

const ITEM_STATE: Record<BackupItem['state'], string> = {
  missing: 'No longer in the tenant',
  trash: 'In the trash',
  present: 'In the tenant',
}

/** One item of a tenant from a backup: found by title, app or owner, then restored. An item still in the
 *  tenant comes back only as a copy or in place of the current one, by choice (never silently). */
function RestoreItemDialog({ backup, onOpenChange }: { backup: BackupInfo; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const inside = useApi<ExportManifest[]>(['backup-tenants', backup.id], `/api/admin/backups/${backup.id}/tenants`)
  const plugins = useApi<AdminPlugin[]>(['admin-plugins'], '/api/admin/plugins')
  const [slug, setSlug] = useState('')
  const [form, setForm] = useState({ q: '', plugin: '', owner: '' })
  const [filter, setFilter] = useState(form)
  const [pending, setPending] = useState<BackupItem | null>(null)
  const [mode, setMode] = useState<'copy' | 'replace'>('copy')
  const [shares, setShares] = useState(false)
  const [busy, setBusy] = useState(false)
  const tenant = slug || inside.data?.[0]?.tenant.slug || ''
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v.trim())).toString()
  const key = ['backup-items', backup.id, tenant, qs]
  const items = useApi<BackupItems>(key, tenant ? `/api/admin/backups/${backup.id}/tenants/${encodeURIComponent(tenant)}/items${qs ? '?' + qs : ''}` : null)
  const label = (id: string) => plugins.data?.find((p) => p.id === id)?.label ?? id
  async function restore() {
    if (!pending) return
    setBusy(true)
    try {
      const body = pending.state === 'missing' ? { shares } : { shares, mode }
      const r = await api<ItemRestoreReport>('POST', `/api/admin/backups/${backup.id}/tenants/${encodeURIComponent(tenant)}/items/${pending.id}/restore`, body)
      toast.success(r.mode === 'copy' ? t('«{title}» restored as a copy', { title: r.title }) : t('«{title}» restored', { title: r.title }))
      setPending(null)
      await qc.invalidateQueries({ queryKey: ['backup-items', backup.id] })
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const date = fmtDay(backup.started_at, { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('Restore an item')}</DialogTitle>
          <DialogDescription>{t('From the backup of {date}: the item comes back as it was then, with what is in it and its files. Public links do not come back.', { date })}</DialogDescription>
        </DialogHeader>
        {inside.isLoading ? (
          <Loading />
        ) : inside.error ? (
          <ErrorBox error={inside.error} />
        ) : pending ? (
          <div className="grid gap-4">
            <p className="text-sm">
              <b>{pending.title || pending.kind}</b> · {label(pending.plugin_id)} · {pending.owner_name}
              {pending.children > 0 && <span className="text-muted-foreground"> · {t('{n} items inside', { n: String(pending.children) })}</span>}
            </p>
            {pending.state !== 'missing' && (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{pending.state === 'trash' ? t('The item is in the trash of the tenant.') : t('The item is still in the tenant.')}</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="restore-mode" checked={mode === 'copy'} onChange={() => setMode('copy')} className="mt-1" />
                  <span>
                    <b className="block">{t('As a copy')}</b>
                    <span className="text-muted-foreground">{t('A new item next to the current one, which stays as it is.')}</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="restore-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-1" />
                  <span>
                    <b className="block">{t('In place of the current one')}</b>
                    <span className="text-muted-foreground">{t('The current version, with what is in it, is deleted for good.')}</span>
                  </span>
                </label>
              </fieldset>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shares} onChange={(e) => setShares(e.target.checked)} />
              {t('Also its shares with the people and groups that still exist')}
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPending(null)}>
                {t('Back')}
              </Button>
              <Button variant={pending.state !== 'missing' && mode === 'replace' ? 'destructive' : 'default'} disabled={busy} onClick={() => void restore()}>
                {busy && <Loader2 className="animate-spin" />}
                {t('Restore')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <form
              className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault()
                setFilter(form)
              }}
            >
              <Field id="ri-tenant" label={t('Tenant')}>
                <select id="ri-tenant" className="h-9 rounded-md border bg-background px-2 text-sm" value={tenant} onChange={(e) => setSlug(e.target.value)}>
                  {inside.data!.map((m) => (
                    <option key={m.tenant.slug} value={m.tenant.slug}>
                      {m.tenant.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="ri-q" label={t('Title')}>
                <Input id="ri-q" value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} />
              </Field>
              <Field id="ri-app" label={t('App')}>
                <select id="ri-app" className="h-9 rounded-md border bg-background px-2 text-sm" value={form.plugin} onChange={(e) => setForm({ ...form, plugin: e.target.value })}>
                  <option value="">{t('All')}</option>
                  {(plugins.data ?? []).filter((p) => !p.extends).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="ri-owner" label={t('Owner')}>
                <Input id="ri-owner" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
              </Field>
              <Button type="submit" variant="outline">
                {t('Search')}
              </Button>
            </form>
            {items.isLoading ? (
              <Loading />
            ) : items.error ? (
              <ErrorBox error={items.error} />
            ) : !items.data?.items.length ? (
              <p className="text-sm text-muted-foreground">{t('No item of the backup matches.')}</p>
            ) : (
              <div className="max-h-[50vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Title')}</TableHead>
                      <TableHead>{t('App')}</TableHead>
                      <TableHead>{t('Owner')}</TableHead>
                      <TableHead>{t('State')}</TableHead>
                      <TableHead className="text-right">
                        <span className="sr-only">{t('Actions')}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.data.items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>
                          {it.title || it.kind}
                          {it.children > 0 && <span className="text-xs text-muted-foreground"> · {t('{n} items inside', { n: String(it.children) })}</span>}
                        </TableCell>
                        <TableCell>{label(it.plugin_id)}</TableCell>
                        <TableCell>{it.owner_name}</TableCell>
                        <TableCell>
                          <Badge variant={it.state === 'missing' ? 'secondary' : 'outline'}>{t(ITEM_STATE[it.state])}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={t('Restore «{title}»', { title: it.title || it.kind })}
                            onClick={() => {
                              setMode('copy')
                              setShares(false)
                              setPending(it)
                            }}
                          >
                            {t('Restore')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {items.data.total > items.data.items.length && (
                  <p className="mt-2 text-xs text-muted-foreground">{t('The first {n} of {total}: narrow the search.', { n: String(items.data.items.length), total: String(items.data.total) })}</p>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RestoreTenantDialog({ backup, onOpenChange }: { backup: BackupInfo; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const inside = useApi<ExportManifest[]>(['backup-tenants', backup.id], `/api/admin/backups/${backup.id}/tenants`)
  const tenants = useApi<TenantInfo[]>(['admin-tenants'], '/api/admin/tenants')
  const [busy, setBusy] = useState<string | null>(null)
  async function restore(m: ExportManifest) {
    const exists = tenants.data?.some((x) => x.slug === m.tenant.slug || x.id === m.tenant.id)
    if (exists && !(await confirm(t('{name} exists: replace it with the copy of the backup? What it holds now is deleted.', { name: m.tenant.name }), true))) return
    setBusy(m.tenant.slug)
    try {
      const r = await api<ImportReport>('POST', `/api/admin/backups/${backup.id}/restore`, { slug: m.tenant.slug, replace: !!exists })
      await qc.invalidateQueries({ queryKey: ['admin-tenants'] })
      toast.success(t('{name} restored from the backup', { name: r.name }))
      onOpenChange(false)
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Restore a tenant')}</DialogTitle>
          <DialogDescription>{t('From the backup of {date}: the tenant comes back as it was then.', { date: fmtDay(backup.started_at, { dateStyle: 'medium', timeStyle: 'short' }) })}</DialogDescription>
        </DialogHeader>
        {inside.isLoading ? (
          <Loading />
        ) : inside.error ? (
          <ErrorBox error={inside.error} />
        ) : (
          <ul className="grid gap-2">
            {inside.data!.map((m) => (
              <li key={m.tenant.slug} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <span>
                  <b className="block text-sm">{m.tenant.name}</b>
                  <span className="font-mono text-xs text-muted-foreground">{m.tenant.slug}</span>
                </span>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void restore(m)}>
                  {busy === m.tenant.slug && <Loader2 className="animate-spin" />}
                  {t('Restore')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── System › Maintenance ────────────────────────────────────────────── */

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function MaintenancePanel() {
  const q = useApi<Maintenance>(['admin-maintenance'], '/api/admin/maintenance')
  const confirm = useConfirm()
  const [v, setV] = useState<Maintenance | null>(null)
  const save = useAction((m: Maintenance) => api('PUT', '/api/admin/maintenance', m).then(() => reloadBrand()), {
    ok: (m) => (m.on ? t('Maintenance mode is on') : t('Maintenance saved')),
    invalidate: [['admin-maintenance']],
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const saved = q.data!
  const m = v ?? saved
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(saved)
  async function apply() {
    if (m.on && !saved.on && !(await confirm(t('Turn on the maintenance? Everybody except the Administrators is signed out of the work until it is turned off.'), true))) return
    save.mutate(m, { onSuccess: () => setV(null) })
  }
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Maintenance mode')}</CardTitle>
          <CardDescription>{t('While it is on, everybody sees the notice and only the Administrators sign in and work; public links are closed.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span>
              <b className="block text-sm">{t('Maintenance mode')}</b>
              <span className="text-xs text-muted-foreground">{m.on ? t('On: only the Administrators work') : t('Off')}</span>
            </span>
            <Switch checked={m.on} onCheckedChange={(x) => setV({ ...m, on: x })} aria-label={t('Maintenance mode')} />
          </label>
          <Field id="mt-msg" label={t('Notice for everybody')}>
            <Textarea id="mt-msg" rows={2} maxLength={500} value={m.message} placeholder={t('e.g. Update of the platform, back at 10:00')} onChange={(e) => setV({ ...m, message: e.target.value })} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Planned maintenance')}</CardTitle>
          <CardDescription>{t('Its notice is shown in advance to everybody; at the time the maintenance mode turns on by itself.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field id="mt-at" label={t('Start')}>
            <Input
              id="mt-at"
              type="datetime-local"
              className="w-64"
              value={toLocalInput(m.planned_at)}
              onChange={(e) => setV({ ...m, planned_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
            />
          </Field>
          <Field id="mt-pmsg" label={t('Notice in advance')}>
            <Textarea id="mt-pmsg" rows={2} maxLength={500} value={m.planned_message} placeholder={t('e.g. Saturday from 22:00 the platform is not available for two hours')} onChange={(e) => setV({ ...m, planned_message: e.target.value })} />
          </Field>
          {m.planned_at && (
            <Button variant="ghost" className="justify-self-start" onClick={() => setV({ ...m, planned_at: null, planned_message: '' })}>
              {t('Cancel the planned maintenance')}
            </Button>
          )}
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => void apply()} onCancel={() => setV(null)} />
    </div>
  )
}

/* ── Charts ──────────────────────────────────────────────────────────── */

interface Series {
  key: keyof MetricPoint
  label: string
  color: string
}

/** A line chart of the metrics, with the same numbers as a table for whoever does not read the chart. */
function LineChart({ points, series, unit, label }: { points: MetricPoint[]; series: Series[]; unit?: string; label: string }) {
  const W = 600
  const H = 160
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => Number(p[s.key]) || 0)))
  const x = (i: number) => (points.length < 2 ? W / 2 : (i * W) / (points.length - 1))
  const y = (v: number) => H - (v / max) * (H - 12) - 4
  const fmt = (v: number) => `${fmtNumber(v, { maximumFractionDigits: v < 10 ? 1 : 0 })}${unit ?? ''}`
  return (
    <figure className="grid gap-2">
      <figcaption className="flex flex-wrap items-center gap-3 text-sm">
        <b>{label}</b>
        {series.map((s) => (
          <span key={String(s.key)} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{t('max {v}', { v: fmt(max) })}</span>
      </figcaption>
      {points.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t('No data yet: a point is recorded every minute.')}</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full rounded-md border bg-card" preserveAspectRatio="none" role="img" aria-label={label}>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="currentColor" strokeOpacity={0.08} />
          ))}
          {series.map((s) => (
            <polyline
              key={String(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              points={points.map((p, i) => `${x(i)},${y(Number(p[s.key]) || 0)}`).join(' ')}
            />
          ))}
        </svg>
      )}
      {points.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">{t('Show as a table')}</summary>
          <div className="max-h-64 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Time')}</TableHead>
                  {series.map((s) => (
                    <TableHead key={String(s.key)} className="text-right">
                      {s.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {points.map((p) => (
                  <TableRow key={p.ts}>
                    <TableCell>{fmtDay(p.ts, { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                    {series.map((s) => (
                      <TableCell key={String(s.key)} className="text-right tabular-nums">
                        {fmt(Number(p[s.key]) || 0)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      )}
    </figure>
  )
}

const C = {
  primary: 'var(--primary)',
  warn: 'var(--warn)',
  bad: 'var(--destructive)',
  ok: 'var(--ok)',
}

/* ── Monitoring ──────────────────────────────────────────────────────── */

const STATE: Record<ServiceState['state'], [string, string]> = {
  ok: ['ok', 'bg-ok/10 text-ok'],
  degraded: ['degraded', 'bg-warn/10 text-warn'],
  down: ['not answering', 'bg-destructive/10 text-destructive dark:text-red-300'],
  off: ['off', 'bg-muted text-muted-foreground'],
}

function ServiceBadge({ state }: { state: ServiceState['state'] }) {
  const [label, cls] = STATE[state]
  return (
    <Badge variant="secondary" className={cn('font-normal', cls)}>
      {t(label)}
    </Badge>
  )
}

function Period({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Pills label={t('Period')} items={[{ id: '1h', label: t('1 hour') }, { id: '12h', label: t('12 hours') }, { id: '7d', label: t('7 days') }]} value={value} onChange={onChange} />
}

export function MonitoringPage({ section }: { section?: string }) {
  const sections = [
    { id: 'status', label: t('Status'), icon: <Server /> },
    { id: 'performance', label: t('Performance'), icon: <Gauge /> },
    { id: 'errors', label: t('Errors'), icon: <CircleAlert /> },
    { id: 'tenants', label: t('Tenants'), icon: <Activity /> },
    { id: 'capacity', label: t('Capacity'), icon: <HardDrive /> },
    { id: 'alerts', label: t('Alerts'), icon: <BellRing /> },
  ]
  const cur = sections.some((s) => s.id === section) ? section! : 'status'
  return (
    <>
      <PageHeader title={t('Monitoring')} sub={t('State, load and capacity of the platform')} />
      <MonitoringNote />
      <Sections sections={sections} current={cur} href={(id) => to.admin('monitoring', id)}>
        {cur === 'status' && <StatusPanel />}
        {cur === 'performance' && <PerformancePanel />}
        {cur === 'errors' && <ErrorsPanel />}
        {cur === 'tenants' && <TenantsLoadPanel />}
        {cur === 'capacity' && <CapacityPanel />}
        {cur === 'alerts' && <AlertsPanel />}
      </Sections>
    </>
  )
}

/** The figures are real: measured by the server every minute and kept for 8 days. The note says when the page was
 *  last refreshed; it refreshes by itself every minute. */
function MonitoringNote() {
  const qc = useQueryClient()
  useIsFetching() // re-render when a fetch ends
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['mon-'], predicate: (q) => String(q.queryKey[0]).startsWith('mon-') })
      tick((n) => n + 1)
    }, 60_000)
    return () => window.clearInterval(id)
  }, [qc])
  const last = Math.max(0, ...qc.getQueryCache().findAll().filter((q) => String(q.queryKey[0]).startsWith('mon-')).map((q) => q.state.dataUpdatedAt))
  return (
    <p className="px-6 pt-3 text-xs text-muted-foreground max-[620px]:px-4" data-testid="monitoring-note">
      {t('Real measures of this server: collected every minute and kept for 8 days; the page refreshes every minute.')}{' '}
      {last > 0 && t('Last update: {time}', { time: new Date(last).toLocaleTimeString() })}
    </p>
  )
}

interface StatusData {
  services: ServiceState[]
  kernel: string
  uptime_s: number
  jobs: Record<string, string>
}

function uptime(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? t('{d} d {h} h', { d, h }) : h > 0 ? t('{h} h {m} min', { h, m }) : t('{m} min', { m })
}

function StatusPanel() {
  const q = useApi<StatusData>(['mon-status'], '/api/admin/monitoring/status')
  const [open, setOpen] = useState<string | null>(null)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  const down = d.services.filter((s) => s.state === 'down').length
  return (
    <div className="grid max-w-4xl gap-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        <Kpi label={t('Services')} value={`${d.services.filter((s) => s.state === 'ok').length}/${d.services.length}`} hint={down ? t('{n} not answering', { n: down }) : t('all answering')} />
        <Kpi label={t('Version')} value={d.kernel} />
        <Kpi label={t('Up since')} value={uptime(d.uptime_s)} />
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Service')}</TableHead>
              <TableHead>{t('State')}</TableHead>
              <TableHead>{t('Version')}</TableHead>
              <TableHead className="text-right">{t('Response')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.services.map((s) => (
              <TableRow key={s.key} className="cursor-pointer" onClick={() => setOpen(s.key)}>
                <TableCell>
                  <button type="button" className="text-left font-medium hover:underline" aria-haspopup="dialog" onClick={(e) => (e.stopPropagation(), setOpen(s.key))}>
                    {s.name}
                  </button>
                  {s.detail && <span className="mt-0.5 block text-xs text-muted-foreground">{s.detail}</span>}
                </TableCell>
                <TableCell>
                  <ServiceBadge state={s.state} />
                </TableCell>
                <TableCell className="text-muted-foreground">{s.version || '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{s.ms === null ? '—' : `${fmtNumber(s.ms, { maximumFractionDigits: 1 })} ms`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ServiceDetail service={d.services.find((s) => s.key === open) ?? null} onClose={() => setOpen(null)} />
    </div>
  )
}

/** A quick look at a service (refactoring-ui §9: side panel for a quick look): state, version, time of
 *  the check, what the kernel knows of it. */
function ServiceDetail({ service: s, onClose }: { service: ServiceState | null; onClose: () => void }) {
  return (
    <Sheet open={!!s} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[min(28rem,100vw)] sm:max-w-none">
        {s && (
          <>
            <SheetHeader>
              <SheetTitle>{t(s.name)}</SheetTitle>
              <SheetDescription>
                <ServiceBadge state={s.state} />
              </SheetDescription>
            </SheetHeader>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 px-4 pb-6 text-sm">
              <dt className="text-muted-foreground">{t('Version')}</dt>
              <dd>{s.version || '—'}</dd>
              <dt className="text-muted-foreground">{t('Response')}</dt>
              <dd className="tabular-nums">{s.ms === null ? '—' : `${fmtNumber(s.ms, { maximumFractionDigits: 1 })} ms`}</dd>
              <dt className="text-muted-foreground">{t('Details')}</dt>
              <dd className="break-words">{s.detail || '—'}</dd>
              {(s.facts ?? []).map(([k, v]) => (
                <Fragment key={k}>
                  <dt className="text-muted-foreground">{t(k)}</dt>
                  <dd className="break-words">{v === 'delivered' ? t('delivered') : v}</dd>
                </Fragment>
              ))}
            </dl>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function PerformancePanel() {
  const [period, setPeriod] = useState('1h')
  const q = useApi<{ points: MetricPoint[] }>(['mon-perf', period], `/api/admin/monitoring/performance?period=${period}`)
  return (
    <div className="grid max-w-4xl gap-6">
      <Period value={period} onChange={setPeriod} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <LineChart label={t('Requests')} points={q.data!.points} series={[{ key: 'requests', label: t('Requests'), color: C.primary }, { key: 'errors', label: t('Errors'), color: C.bad }]} />
          <LineChart
            label={t('Response time')}
            unit=" ms"
            points={q.data!.points}
            series={[
              { key: 'p50_ms', label: 'p50', color: C.ok },
              { key: 'p95_ms', label: 'p95', color: C.warn },
              { key: 'p99_ms', label: 'p99', color: C.bad },
            ]}
          />
          <LineChart label={t('Sessions and queue of the emails')} points={q.data!.points} series={[{ key: 'sessions', label: t('Sessions'), color: C.primary }, { key: 'mail_pending', label: t('Emails waiting'), color: C.warn }]} />
        </>
      )}
    </div>
  )
}

interface ErrorsData {
  points: MetricPoint[]
  requests: number
  errors: number
  failures_24h: number
  latest: { ts: string; action: string; tenant: string | null; user: string | null; ip: string | null }[]
}

function ErrorsPanel() {
  const [period, setPeriod] = useState('1h')
  const q = useApi<ErrorsData>(['mon-errors', period], `/api/admin/monitoring/errors?period=${period}`)
  return (
    <div className="grid max-w-4xl gap-6">
      <Period value={period} onChange={setPeriod} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            <Kpi label={t('Server errors')} value={fmtNumber(q.data!.errors)} hint={t('of {n} requests', { n: fmtNumber(q.data!.requests) })} />
            <Kpi label={t('Error rate')} value={q.data!.requests ? `${fmtNumber((q.data!.errors * 100) / q.data!.requests, { maximumFractionDigits: 1 })}%` : '—'} />
            <Kpi label={t('Refused operations, 24 hours')} value={fmtNumber(q.data!.failures_24h)} onClick={() => go(`${to.admin('log')}?failures=1`)} />
          </div>
          <LineChart label={t('Server errors')} points={q.data!.points} series={[{ key: 'errors', label: t('Errors'), color: C.bad }]} />
          <section className="grid gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t('Latest refused operations')}</h2>
              <a className="text-sm text-primary underline-offset-4 hover:underline" href={to.admin('log')}>
                {t('See in the log')}
              </a>
            </div>
            {q.data!.latest.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('None.')}</p>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('When')}</TableHead>
                      <TableHead>{t('What')}</TableHead>
                      <TableHead>{t('Who')}</TableHead>
                      <TableHead>{t('Tenant')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.data!.latest.map((f, i) => (
                      <TableRow key={i}>
                        <TableCell>{fmtDay(f.ts, { dateStyle: 'short', timeStyle: 'medium' })}</TableCell>
                        <TableCell className="font-mono text-xs">{f.action}</TableCell>
                        <TableCell>{f.user ?? f.ip ?? '—'}</TableCell>
                        <TableCell>{f.tenant ?? t('Platform')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function TenantsLoadPanel() {
  const q = useApi<TenantLoad[]>(['mon-tenants'], '/api/admin/monitoring/tenants')
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  return (
    <div className="max-w-4xl overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Tenant')}</TableHead>
            <TableHead className="text-right">{t('Requests, 1 hour')}</TableHead>
            <TableHead className="text-right">{t('Requests, 24 hours')}</TableHead>
            <TableHead className="text-right">{t('People')}</TableHead>
            <TableHead className="text-right">{t('Items')}</TableHead>
            <TableHead className="text-right">{t('Space')}</TableHead>
            <TableHead>{t('Nearest quota')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.data!.map((x) => (
            <TableRow key={x.id} className="cursor-pointer" onClick={() => go(to.adminTenant(x.id))}>
              <TableCell>
                <a href={to.adminTenant(x.id)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                  {x.name}
                </a>
                {x.archived ? <span className="ml-2 text-xs text-muted-foreground">{t('archived')}</span> : x.status !== 'active' ? <span className="ml-2 text-xs text-destructive">{t('suspended')}</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtNumber(x.requests_1h)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtNumber(x.requests_24h)}</TableCell>
              <TableCell className="text-right tabular-nums">{x.people}</TableCell>
              <TableCell className="text-right tabular-nums">{x.items}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtBytes(x.bytes)}</TableCell>
              <TableCell>
                {x.nearest_quota && x.nearest_quota.percent !== null ? (
                  <span className={cn('tabular-nums', x.nearest_quota.percent >= 100 ? 'text-destructive' : x.nearest_quota.percent >= 80 ? 'text-warn' : '')}>
                    {({ storage: t('Storage'), people: t('People'), items: t('Items') } as Record<string, string>)[x.nearest_quota.metric]} · {x.nearest_quota.percent}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t('no limit')}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Meter({ label, used, total, detail }: { label: string; used: number; total: number; detail: string }) {
  const pct = total > 0 ? Math.min(100, (used * 100) / total) : 0
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <b>{label}</b>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className={cn('h-full rounded-full', pct > 90 ? 'bg-destructive' : pct > 75 ? 'bg-warn' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function CapacityPanel() {
  const q = useApi<Capacity>(['mon-capacity'], '/api/admin/monitoring/capacity')
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const c = q.data!
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardContent className="grid gap-5 pt-6">
          <Meter label={t('Disk of the data')} used={c.disk_total - c.disk_free} total={c.disk_total} detail={t('{free} free of {total}', { free: fmtBytes(c.disk_free), total: fmtBytes(c.disk_total) })} />
          <Meter label={t('Memory of the server')} used={c.memory_total - c.memory_available} total={c.memory_total} detail={t('{free} free of {total}', { free: fmtBytes(c.memory_available), total: fmtBytes(c.memory_total) })} />
        </CardContent>
      </Card>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        <Kpi label={t('Database')} value={fmtBytes(c.database_bytes)} />
        <Kpi label={t('Contents')} value={fmtBytes(c.contents_bytes)} />
        <Kpi label={t('Backups')} value={fmtBytes(c.backups_bytes)} onClick={() => go(to.admin('system', 'backup'))} />
        <Kpi label={t('Memory of Mosaikit')} value={fmtBytes(c.process_memory)} />
      </div>
    </div>
  )
}

const ALERT_LABEL: Record<string, string> = {
  disk: 'Disk almost full',
  errors: 'Server errors',
  mail: 'Emails failing',
  backup: 'Backup failed',
  service: 'Service not answering',
}

function AlertsPanel() {
  const q = useApi<{ settings: AlertSettings; states: AlertState[] }>(['mon-alerts'], '/api/admin/monitoring/alerts')
  const admins = useApi<AdminUser[]>(['admins'], '/api/admin/administrators')
  const [v, setV] = useState<AlertSettings | null>(null)
  const save = useAction((s: AlertSettings) => api('PUT', '/api/admin/monitoring/alerts', s), { ok: t('Settings saved'), invalidate: [['mon-alerts']] })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const saved = q.data!.settings
  const s = v ?? saved
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(saved)
  const active = q.data!.states.filter((x) => x.active)
  const num = (id: string, label: string, key: 'disk_free_pct' | 'error_rate_pct' | 'mail_failed', hint: string) => (
    <Field id={id} label={label} hint={hint}>
      <Input id={id} type="number" className="w-32" min={1} value={s[key]} onChange={(e) => setV({ ...s, [key]: Number(e.target.value) })} />
    </Field>
  )
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Alerts now')}</CardTitle>
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-ok">
              <Check className="size-4" />
              {t('No alert: every condition is within its threshold.')}
            </p>
          ) : (
            <ul className="grid gap-2">
              {active.map((a) => (
                <li key={a.key} className="flex gap-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <b className="block">{t(ALERT_LABEL[a.key] ?? a.key)}</b>
                    {a.detail} · {t('since {date}', { date: fmtDay(a.since, { dateStyle: 'short', timeStyle: 'short' }) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Conditions')}</CardTitle>
          <CardDescription>{t('Checked every minute; a crossing is notified once, until the condition clears.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {num('al-disk', t('Free disk under (%)'), 'disk_free_pct', t('Space left on the disk of the data folder'))}
          {num('al-err', t('Server errors over (%)'), 'error_rate_pct', t('Of the requests of the last 15 minutes, with at least 20 requests'))}
          {num('al-mail', t('Emails failed in an hour, at least'), 'mail_failed', t('Emails the mail server refused'))}
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">{t('A backup failed')}</span>
            <Switch checked={s.backup_failed} onCheckedChange={(x) => setV({ ...s, backup_failed: x })} aria-label={t('A backup failed')} />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">{t('A service does not answer')}</span>
            <Switch checked={s.service_down} onCheckedChange={(x) => setV({ ...s, service_down: x })} aria-label={t('A service does not answer')} />
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Who receives them')}</CardTitle>
          <CardDescription>{t('A notification in the app, and the email according to the preferences of each one. Nobody chosen: every Administrator.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(admins.data ?? [])
            .filter((a) => a.status === 'active')
            .map((a) => {
              const on = s.recipients.includes(a.user_id)
              return (
                <label key={a.user_id} className="flex items-center justify-between gap-4">
                  <span className="text-sm">{a.display_name || a.username}</span>
                  <Switch
                    checked={on}
                    onCheckedChange={(x) => setV({ ...s, recipients: x ? [...s.recipients, a.user_id] : s.recipients.filter((r) => r !== a.user_id) })}
                    aria-label={t('Alerts to {name}', { name: a.display_name || a.username })}
                  />
                </label>
              )
            })}
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => save.mutate(s, { onSuccess: () => setV(null) })} onCancel={() => setV(null)} />
    </div>
  )
}

/* ── Overview: services and "To do" ──────────────────────────────────── */

export function OverviewOps() {
  const status = useApi<StatusData>(['mon-status'], '/api/admin/monitoring/status')
  const tenants = useApi<TenantInfo[]>(['admin-tenants'], '/api/admin/tenants')
  const backups = useApi<{ backups: BackupInfo[]; settings: BackupSettings; running: boolean }>(['admin-backups'], '/api/admin/backups')
  const alerts = useApi<{ settings: AlertSettings; states: AlertState[] }>(['mon-alerts'], '/api/admin/monitoring/alerts')
  const catalog = useApi<CatalogItem[]>(['admin-catalog'], '/api/admin/catalog')
  const now = useNow()
  const todo = useMemo(() => {
    const out: { key: string; text: string; href: string; tone: 'bad' | 'warn' }[] = []
    for (const a of alerts.data?.states.filter((x) => x.active) ?? []) out.push({ key: `a-${a.key}`, text: `${t(ALERT_LABEL[a.key] ?? a.key)}: ${a.detail}`, href: to.admin('monitoring', 'alerts'), tone: 'bad' })
    const last = backups.data?.backups.find((b) => b.status !== 'running')
    if (last?.status === 'failed') out.push({ key: 'backup', text: t('The last backup failed: {error}', { error: last.error }), href: to.admin('system', 'backup'), tone: 'bad' })
    const soon = now + 7 * 86400000
    for (const tn of tenants.data ?? []) {
      if (tn.trial_until && tn.status === 'active' && new Date(tn.trial_until).getTime() < soon)
        out.push({ key: `t-${tn.id}`, text: t('The trial of {name} ends on {date}', { name: tn.name, date: fmtDay(tn.trial_until) }), href: to.adminTenant(tn.id), tone: 'warn' })
    }
    const updates = (catalog.data ?? []).filter((p) => p.update_available).length
    if (updates > 0) out.push({ key: 'updates', text: t('{n} plugin updates to apply', { n: updates }), href: to.admin('plugins', 'updates'), tone: 'warn' })
    return out
  }, [alerts.data, backups.data, tenants.data, catalog.data, now])
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="grid content-start gap-2 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('Services')}</h2>
          <a className="text-sm text-primary underline-offset-4 hover:underline" href={to.admin('monitoring')}>
            {t('Monitoring')}
          </a>
        </div>
        {status.isLoading ? (
          <Loading />
        ) : (
          <ul className="grid gap-1.5">
            {(status.data?.services ?? []).map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{s.name}</span>
                <ServiceBadge state={s.state} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid content-start gap-2 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">{t('To do')}</h2>
        {todo.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="size-4 text-ok" />
            {t('Nothing waiting for you.')}
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {todo.map((x) => (
              <li key={x.key} className="flex items-start gap-2 text-sm">
                <CircleAlert className={cn('mt-0.5 size-4 shrink-0', x.tone === 'bad' ? 'text-destructive' : 'text-warn')} />
                <a className="underline-offset-4 hover:underline" href={x.href}>
                  {x.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
