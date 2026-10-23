// Settings on three levels (docs/refactoring-ui.md §5), the same panels for the platform (System) and for a
// tenant (Tenant settings): the Administrator sets the values and decides what tenants may customize; a
// Tenant Manager sees what comes from the platform, may customize it (and restore it) or, for the
// settings with a limit, only be stricter. Managed settings show with the padlock. Keys of outside
// services are at a third level too, the person's (Account › Keys).

import { useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Lock, Pencil, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { api, errText } from '../api.ts'
import { reloadBrand } from '../brand.ts'
import type { ServiceKey, Setting } from '../types.ts'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { isApp, useApi, useTenantCtx } from './core.ts'
import { useTenantSignIn } from './signin.ts'
import { LANGS, t } from './i18n.ts'
import { ErrorBox, Loading, Locked, SaveBar } from './kit.tsx'
import { QuotasLocked } from './Quotas.tsx'

const enc = encodeURIComponent

/** Where the settings are changed: the platform (Administrator) or a tenant (Tenant Manager). */
export type Level = { kind: 'platform' } | { kind: 'tenant'; slug: string }

const path = (l: Level) => (l.kind === 'platform' ? '/api/admin/settings' : `/api/t/${enc(l.slug)}/manage/config`)
const queryKey = (l: Level) => ['levels', l.kind === 'platform' ? '' : l.slug]

/** Labels of the settings: name and description. */
function labels(): Record<string, [string, string]> {
  return {
    'identity.name': [t('Name'), t('In the top bar, on the sign-in page and in the title of the browser')],
    'identity.welcome': [t('Welcome text'), t('On the sign-in page, under the title')],
    'identity.footer': [t('Footer'), t('At the foot of the sign-in page and of the messages')],
    'identity.privacy_url': [t('Privacy notice'), t('Address of the page, starting with https://')],
    'identity.legal_url': [t('Legal notes'), t('Address of the page, starting with https://')],
    'identity.guide_url': [t('Guide'), t('Address of the guide in the help menu, starting with https://; empty: the short guide of the shell')],
    'identity.landing': [t('Landing page'), t('What people see after signing in')],
    'appearance.mode': [t('Default mode'), t('For whoever did not choose one; everyone can change it in Account')],
    'lang.enabled': [t('Languages offered'), t('The ones people can choose')],
    'lang.default': [t('Default language'), t('For whoever did not choose one')],
    'format.locale': [t('Format of dates and numbers'), t('“As the language” follows the language of each person')],
    'security.password_min': [t('Minimum length of the password'), t('Characters, for local accounts')],
    'security.lock_attempts': [t('Attempts before the lock'), t('Failed sign-ins of the same account or address')],
    'security.lock_minutes': [t('Length of the lock, in minutes'), t('Then the sign-in is possible again')],
    'security.session_hours': [t('Length of the session, in hours'), t('Then the person signs in again')],
    'security.remember_days': [t('«Remember me», in days'), t('0: the option does not show on the sign-in page')],
    'embed.sites': [t('Sites that may embed public pages'), t('For instance the website of the tenant: https://www.example.com')],
    'notify.email_mode': [t('Emails of the notifications'), t('For whoever did not choose; everyone can change it in Account › Notifications')],
    'notify.digest_hour': [t('Hour of the daily summary'), t('0-23, UTC time of the server')],
    'notify.retention_days': [t('Notifications kept, in days'), t('Older ones are deleted, read or not')],
    'trash.retention_days': [t('Trash kept, in days'), t('Then what was deleted is deleted for good')],
    'log.retention_days': [t('Log kept, in days'), t('Older events are deleted')],
    theme: [t('Theme'), ''],
    band: [t('Top bar'), ''],
  }
}

function useLevelSettings(l: Level) {
  return useApi<Setting[]>(queryKey(l), path(l))
}

/** Changes not saved yet: values (null = back to the platform, or to the default) and switches. */
function useDraft(l: Level, list: Setting[] | undefined) {
  const qc = useQueryClient()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [switches, setSwitches] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const find = (key: string) => list?.find((s) => s.key === key)
  const dirty = Object.keys(values).length > 0 || Object.keys(switches).length > 0
  return {
    find,
    dirty,
    busy,
    /** the value shown: the change, otherwise the one in use */
    value(key: string): unknown {
      const s = find(key)
      if (key in values) return values[key] === null ? (l.kind === 'tenant' ? s?.platform : null) : values[key]
      return s?.value
    },
    /** the tenant has a value of its own (saved or being saved) */
    own(key: string): boolean {
      if (key in values) return values[key] !== null
      const s = find(key)
      return s?.tenant !== undefined && s?.tenant !== null
    },
    set(key: string, v: unknown) {
      setValues((x) => ({ ...x, [key]: v }))
    },
    customizable(key: string): boolean {
      return key in switches ? switches[key] : (find(key)?.customizable ?? true)
    },
    setCustomizable(key: string, on: boolean) {
      setSwitches((x) => ({ ...x, [key]: on }))
    },
    cancel() {
      setValues({})
      setSwitches({})
    },
    async save() {
      setBusy(true)
      try {
        const body = l.kind === 'platform' ? { values, customizable: switches } : { values }
        const next = await api<Setting[]>('PUT', path(l), body)
        qc.setQueryData(queryKey(l), next)
        void qc.invalidateQueries({ queryKey: l.kind === 'platform' ? ['session'] : ['ctx', l.slug] })
        if (l.kind === 'platform') reloadBrand()
        setValues({})
        setSwitches({})
        toast.success(t('Settings saved'))
      } catch (e) {
        toast.error(errText(e))
      } finally {
        setBusy(false)
      }
    },
  }
}

type Draft = ReturnType<typeof useDraft>

/** A group of settings with its save bar (it appears only after a change). */
function Panel({ level, keys, title, description, children }: { level: Level; keys: string[]; title: string; description?: string; children: (d: Draft, s: (key: string) => Setting | undefined) => ReactNode }) {
  const q = useLevelSettings(level)
  const d = useDraft(level, q.data)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const shown = keys.filter((k) => d.find(k))
  return (
    <div className="max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-5">{shown.length ? children(d, d.find) : null}</CardContent>
      </Card>
      <SaveBar dirty={d.dirty} busy={d.busy} onSave={() => void d.save()} onCancel={d.cancel} />
    </div>
  )
}

/** Where a value of the tenant comes from: inherited from the platform or customized. */
function SourceBadge({ own }: { own: boolean }) {
  return <Badge variant={own ? 'default' : 'secondary'}>{own ? t('Customized') : t('Inherited')}</Badge>
}

function limitText(s: Setting): string {
  const p = s.platform
  if (s.rule === 'min') return t('Platform minimum: {n}', { n: String(p) })
  if (s.rule === 'max') return t('Platform maximum: {n}', { n: String(p) })
  return t('Only among the ones the platform allows')
}

function show(v: unknown): string {
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

/** A row: label, description, the control and, per level, what it inherits or allows. */
function Row({ level, d, s, children, display }: { level: Level; d: Draft; s: Setting; children: ReactNode; display?: (v: unknown) => string }) {
  const [label, hint] = labels()[s.key] ?? [s.key, '']
  const id = `set-${s.key.replace(/\W/g, '-')}`
  if (level.kind === 'tenant' && s.locked) return <Locked label={label} value={(display ?? show)(s.value)} hint={hint} />
  const tenant = level.kind === 'tenant'
  const custom = s.kind === 'custom'
  const own = tenant && d.own(s.key)
  // a customizable value inherited from the platform: «Customize» to change it
  const inherits = tenant && custom && s.inherits && !own
  return (
    <div className="grid gap-1.5 border-b pb-5 last:border-0 last:pb-0" data-setting={s.key}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-semibold">
          {label}
        </Label>
        <span className="flex items-center gap-2">
          {tenant && s.inherits && <SourceBadge own={own} />}
          {inherits && (
            <Button type="button" variant="outline" size="sm" onClick={() => d.set(s.key, s.value)}>
              <Pencil />
              {t('Customize')}
            </Button>
          )}
          {own && s.scope !== 'platform' && (
            <Button type="button" variant="outline" size="sm" onClick={() => d.set(s.key, null)}>
              <RotateCcw />
              {t('Restore')}
            </Button>
          )}
        </span>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <fieldset id={`${id}-box`} disabled={inherits} className={cn('min-w-0', inherits && 'opacity-70')}>
        {children}
      </fieldset>
      {tenant && s.kind === 'limit' && <p className="text-xs text-muted-foreground">{limitText(s)}</p>}
      {level.kind === 'platform' && custom && s.scope === 'both' && (
        <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={d.customizable(s.key)} onCheckedChange={(on) => d.setCustomizable(s.key, on)} aria-label={t('Tenants may customize it: {name}', { name: label })} />
          {t('Tenants may customize it')}
        </label>
      )}
    </div>
  )
}

function TextRow({ level, d, s, multiline, placeholder }: { level: Level; d: Draft; s: Setting; multiline?: boolean; placeholder?: string }) {
  const id = `set-${s.key.replace(/\W/g, '-')}`
  const v = String(d.value(s.key) ?? '')
  return (
    <Row level={level} d={d} s={s}>
      {multiline ? (
        <Textarea id={id} value={v} placeholder={placeholder} onChange={(e) => d.set(s.key, e.target.value)} rows={2} />
      ) : (
        <Input id={id} value={v} placeholder={placeholder} onChange={(e) => d.set(s.key, e.target.value)} />
      )}
    </Row>
  )
}

function NumberRow({ level, d, s }: { level: Level; d: Draft; s: Setting }) {
  const id = `set-${s.key.replace(/\W/g, '-')}`
  return (
    <Row level={level} d={d} s={s}>
      <Input id={id} type="number" className="w-32" value={String(d.value(s.key) ?? '')} onChange={(e) => d.set(s.key, e.target.value === '' ? null : Number(e.target.value))} />
    </Row>
  )
}

function ChoiceRow({ level, d, s, options }: { level: Level; d: Draft; s: Setting; options: [string, string][] }) {
  const id = `set-${s.key.replace(/\W/g, '-')}`
  const name = (v: unknown) => options.find((o) => o[0] === v)?.[1] ?? show(v)
  return (
    <Row level={level} d={d} s={s} display={name}>
      <Select value={String(d.value(s.key) ?? '')} onValueChange={(v) => d.set(s.key, v)}>
        <SelectTrigger id={id} className="w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, label]) => (
            <SelectItem key={v} value={v}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  )
}

/* ── Identity and texts ──────────────────────────────────────────────── */

/** Name, logos (light and dark backgrounds), browser icon (platform), texts of the sign-in page, landing
 *  page (tenant). Images are saved at once; the texts with the save bar. */
export function IdentityPanel({ level }: { level: Level }) {
  const ctx = useTenantCtx(level.kind === 'tenant' ? level.slug : '')
  const apps = ctx.data?.plugins.filter(isApp) ?? []
  return (
    <div className="grid gap-6">
      <Images level={level} />
      <Panel
        level={level}
        keys={['identity.name', 'identity.welcome', 'identity.footer', 'identity.privacy_url', 'identity.legal_url', 'identity.guide_url', 'identity.landing']}
        title={t('Identity and texts')}
        description={level.kind === 'platform' ? t('Of the platform: the sign-in page and the pages of the Administrator; tenants inherit the texts.') : t('Of the tenant: its sign-in page and the top bar of its people.')}
      >
        {(d, s) => (
          <>
            {s('identity.name') && <TextRow level={level} d={d} s={s('identity.name')!} />}
            {s('identity.welcome') && <TextRow level={level} d={d} s={s('identity.welcome')!} multiline placeholder={t('The apps of your tenant, for the people who work in it every day.')} />}
            {s('identity.footer') && <TextRow level={level} d={d} s={s('identity.footer')!} />}
            {s('identity.privacy_url') && <TextRow level={level} d={d} s={s('identity.privacy_url')!} placeholder="https://" />}
            {s('identity.legal_url') && <TextRow level={level} d={d} s={s('identity.legal_url')!} placeholder="https://" />}
            {s('identity.guide_url') && <TextRow level={level} d={d} s={s('identity.guide_url')!} placeholder="https://" />}
            {s('identity.landing') && (
              <ChoiceRow level={level} d={d} s={s('identity.landing')!} options={[['home', t('Home')], ...apps.map((p): [string, string] => [p.id, p.label])]} />
            )}
          </>
        )}
      </Panel>
    </div>
  )
}

function imageUrl(level: Level, slot: string, v: unknown): string {
  const ver = v && typeof v === 'object' && 'v' in v ? String((v as { v: unknown }).v) : ''
  if (level.kind === 'tenant') return `api/auth/tenants/${enc(level.slug)}/logo/${slot}?v=${ver}`
  return `brand/${slot === 'logo_light' ? 'logo' : slot === 'logo_dark' ? 'logo-dark' : 'favicon'}?v=${ver}`
}

function Images({ level }: { level: Level }) {
  const q = useLevelSettings(level)
  const slots: [string, string, string][] = [
    ['logo_light', t('Logo for light backgrounds'), t('Pages and menus')],
    ['logo_dark', t('Logo for dark backgrounds'), t('Top bar and sign-in panel')],
    ...(level.kind === 'platform' ? ([['icon', t('Browser icon'), t('Square, at least 32 px')]] as [string, string, string][]) : []),
  ]
  if (!q.data) return null
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t('Logos')}</CardTitle>
        <CardDescription>{t('SVG, PNG or WebP, at most 512 KB. An SVG with scripts or external references is refused.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {slots.map(([slot, label, hint]) => (
          <ImageSlot key={slot} level={level} slot={slot} label={label} hint={hint} setting={q.data.find((s) => s.key === `identity.${slot}`)} />
        ))}
      </CardContent>
    </Card>
  )
}

function ImageSlot({ level, slot, label, hint, setting }: { level: Level; slot: string; label: string; hint: string; setting?: Setting }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  if (!setting) return null
  const locked = level.kind === 'tenant' && setting.locked
  const value = setting.value
  const base = level.kind === 'platform' ? '/api/admin/identity' : `/api/t/${enc(level.slug)}/manage/identity`
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKey(level) })
    if (level.kind === 'platform') reloadBrand()
    if (level.kind === 'tenant') void qc.invalidateQueries({ queryKey: ['ctx', level.slug] })
  }
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      refresh()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const dark = slot === 'logo_dark'
  return (
    <div className="grid gap-2 rounded-lg border p-3" data-image={slot}>
      <b className="text-sm">{label}</b>
      <span className="text-xs text-muted-foreground">{hint}</span>
      <div className={cn('flex h-20 items-center justify-center rounded-md border', dark ? 'bg-band' : 'bg-background')}>
        {value ? <img src={imageUrl(level, slot, value)} alt={label} className="max-h-16 max-w-[80%] object-contain" /> : <span className={cn('text-xs', dark ? 'text-band-muted' : 'text-muted-foreground')}>{t('None')}</span>}
      </div>
      {locked ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" />
          {t('Managed by the Administrator')}
        </span>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/svg+xml,image/png,image/webp,.ico"
            className="sr-only"
            aria-label={t('Upload: {name}', { name: label })}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void run(() => api('PUT', `${base}/${slot}`, undefined, { raw: f }), t('Image saved'))
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            <Upload />
            {value ? t('Replace') : t('Upload')}
          </Button>
          {!!value && (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => api('DELETE', `${base}/${slot}`), t('Image removed'))}>
              <Trash2 />
              {t('Remove')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Mode, languages and formats, security, embedding ─────────────────── */

export function ModePanel({ level }: { level: Level }) {
  return (
    <Panel level={level} keys={['appearance.mode']} title={t('Mode')}>
      {(d, s) => (
        <ChoiceRow
          level={level}
          d={d}
          s={s('appearance.mode')!}
          options={[
            ['auto', t('Automatic (as the system)')],
            ['light', t('Light')],
            ['dark', t('Dark')],
          ]}
        />
      )}
    </Panel>
  )
}

/** "Tenants may customize it" for the theme (platform). */
export function ThemeSwitch() {
  return (
    <Panel level={{ kind: 'platform' }} keys={['theme']} title={t('The tenants')}>
      {(d, s) => (
        <label className="flex items-center justify-between gap-4">
          <span>
            <b className="block text-sm">{t('Tenants may choose their theme')}</b>
            <span className="text-xs text-muted-foreground">{t('Otherwise every tenant has the theme of the platform')}</span>
          </span>
          <Switch checked={d.customizable(s('theme')!.key)} onCheckedChange={(on) => d.setCustomizable('theme', on)} aria-label={t('Tenants may choose their theme')} />
        </label>
      )}
    </Panel>
  )
}

export function LanguagesPanel({ level }: { level: Level }) {
  return (
    <Panel level={level} keys={['lang.enabled', 'lang.default', 'format.locale']} title={t('Languages and formats')}>
      {(d, s) => {
        const en = s('lang.enabled')!
        const allowed = level.kind === 'tenant' && Array.isArray(en.platform) ? (en.platform as string[]) : LANGS.map((l) => l.id)
        const chosen = (Array.isArray(d.value('lang.enabled')) ? d.value('lang.enabled') : []) as string[]
        const name = (id: string) => LANGS.find((l) => l.id === id)?.name ?? id
        return (
          <>
            <Row level={level} d={d} s={en} display={(v) => (Array.isArray(v) ? v.map((x) => name(String(x))).join(', ') : show(v))}>
              <div className="flex flex-wrap gap-4" role="group" aria-label={t('Languages offered')}>
                {allowed.map((id) => (
                  <label key={id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={chosen.includes(id)}
                      onCheckedChange={(on) => d.set('lang.enabled', on ? [...chosen, id] : chosen.filter((x) => x !== id))}
                      aria-label={name(id)}
                    />
                    {name(id)}
                  </label>
                ))}
              </div>
            </Row>
            <ChoiceRow
              level={level}
              d={d}
              s={s('lang.default')!}
              options={[['auto', t('The language of the browser')], ...chosen.map((id): [string, string] => [id, name(id)])]}
            />
            <ChoiceRow
              level={level}
              d={d}
              s={s('format.locale')!}
              options={[
                ['auto', t('As the language')],
                ['en-GB', 'English (UK) · 31/12/2026'],
                ['en-US', 'English (US) · 12/31/2026'],
                ['it-IT', 'Italiano · 31/12/2026'],
              ]}
            />
          </>
        )
      }}
    </Panel>
  )
}

export function SecurityPanel({ level }: { level: Level }) {
  const keys = ['security.password_min', 'security.lock_attempts', 'security.lock_minutes', 'security.session_hours', 'security.remember_days']
  return (
    <Panel
      level={level}
      keys={keys}
      title={t('Passwords and sessions')}
      description={level.kind === 'platform' ? t('The minimum rules of the platform: tenants may only make them stricter.') : t('Rules of the tenant: only stricter than the ones of the platform.')}
    >
      {(d, s) => keys.map((k) => s(k) && <NumberRow key={k} level={level} d={d} s={s(k)!} />)}
    </Panel>
  )
}

/** How the notifications arrive by email: the default of the people (customizable by the tenants) and, for
 *  the platform, the hour of the daily summary (how long they are kept is in Retention). */
export function NotificationsPanel({ level }: { level: Level }) {
  const keys = level.kind === 'platform' ? ['notify.email_mode', 'notify.digest_hour'] : ['notify.email_mode']
  const modes: [string, string][] = [
    ['digest', t('One summary a day')],
    ['immediate', t('At once')],
    ['off', t('Never')],
  ]
  return (
    <Panel level={level} keys={keys} title={t('Notifications')} description={t('In the app every notification arrives in the bell; these are the defaults for the emails.')}>
      {(d, s) =>
        keys.map((k) =>
          !s(k) ? null : k === 'notify.email_mode' ? <ChoiceRow key={k} level={level} d={d} s={s(k)!} options={modes} /> : <NumberRow key={k} level={level} d={d} s={s(k)!} />,
        )
      }
    </Panel>
  )
}

/** How long the platform keeps what was deleted, the events of the log and the notifications. */
export function RetentionPanel({ level }: { level: Level }) {
  const keys = ['trash.retention_days', 'log.retention_days', 'notify.retention_days']
  return (
    <Panel level={level} keys={keys} title={t('Retention')} description={t('How long the trash, the log and the notifications keep their content, for every tenant.')}>
      {(d, s) => keys.map((k) => s(k) && <NumberRow key={k} level={level} d={d} s={s(k)!} />)}
    </Panel>
  )
}

export function EmbeddingPanel({ level }: { level: Level }) {
  const [site, setSite] = useState('')
  return (
    <Panel
      level={level}
      keys={['embed.sites']}
      title={t('Embedding')}
      description={t('Sites that may show the public pages (public links) inside their own pages. Without sites, nobody may.')}
    >
      {(d, s) => {
        const st = s('embed.sites')!
        const list = (Array.isArray(d.value('embed.sites')) ? d.value('embed.sites') : []) as string[]
        if (level.kind === 'tenant') {
          const allowed = Array.isArray(st.platform) ? (st.platform as string[]) : []
          return (
            <Row level={level} d={d} s={st}>
              {allowed.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('The platform allows no site.')}</p>
              ) : (
                <div className="grid gap-2" role="group" aria-label={t('Sites that may embed public pages')}>
                  {allowed.map((x) => (
                    <label key={x} className="flex items-center gap-2 font-mono text-sm">
                      <Checkbox checked={list.includes(x)} onCheckedChange={(on) => d.set('embed.sites', on ? [...list, x] : list.filter((y) => y !== x))} aria-label={x} />
                      {x}
                    </label>
                  ))}
                </div>
              )}
            </Row>
          )
        }
        const add = () => {
          const v = site.trim().toLowerCase().replace(/\/+$/, '')
          if (v && !list.includes(v)) d.set('embed.sites', [...list, v])
          setSite('')
        }
        return (
          <Row level={level} d={d} s={st}>
            <ul className="mb-2 grid gap-1.5">
              {list.map((x) => (
                <li key={x} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 font-mono text-sm">
                  {x}
                  <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('Remove {name}', { name: x })} onClick={() => d.set('embed.sites', list.filter((y) => y !== x))}>
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                id="set-embed-sites"
                value={site}
                placeholder="https://www.example.com"
                onChange={(e) => setSite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    add()
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={add}>
                <Plus />
                {t('Add')}
              </Button>
            </div>
          </Row>
        )
      }}
    </Panel>
  )
}

/** What the platform decides for the tenant: shown with the padlock. */
export function ManagedPanel({ slug }: { slug: string }) {
  const q = useLevelSettings({ kind: 'tenant', slug })
  // the sign-in method as the sign-in page shows it (public)
  const method = useTenantSignIn(slug)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const L = labels()
  const band = q.data!.find((s) => s.key === 'band')?.value as Record<string, boolean> | undefined
  const bandOn = band ? Object.entries(band).filter(([, on]) => on).length : 5
  const locked = q.data!.filter((s) => s.locked && s.kind === 'custom')
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t('Managed by the platform')}</CardTitle>
        <CardDescription>{t('The Administrator decides these for the tenant.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Locked
          label={t('Sign-in method')}
          value={method === 'oidc' ? t('Identity provider of the tenant (OIDC)') : t('Local accounts of the tenant')}
          hint={method === 'oidc' ? t('People and passwords come from the provider: the Tenant Manager does not create local accounts.') : t('Or an identity provider (OIDC), never both.')}
        />
        <Locked label={t('Top bar')} value={t('{n} of 5 items shown', { n: bandOn })} hint={t('The same for every tenant.')} />
        <QuotasLocked slug={slug} />
        {locked.map((s) => (
          <Locked key={s.key} label={L[s.key]?.[0] ?? s.key} value={show(s.value)} hint={t('Tenants may not customize it.')} />
        ))}
      </CardContent>
    </Card>
  )
}

/* ── Keys of outside services ────────────────────────────────────────── */

export type KeyLevel = { kind: 'platform' } | { kind: 'tenant'; slug: string } | { kind: 'me'; slug: string }

function keysPath(l: KeyLevel): string {
  if (l.kind === 'platform') return '/api/admin/keys'
  return l.kind === 'tenant' ? `/api/t/${enc(l.slug)}/manage/keys` : `/api/t/${enc(l.slug)}/me/keys`
}

function inUse(k: ServiceKey, l: KeyLevel): [string, 'ok' | 'off'] {
  if (!k.declared) return [t('Not used by any installed plugin: you can remove it'), 'off']
  if (k.in_use === 'own') return [l.kind === 'me' ? t('In use: your key') : l.kind === 'tenant' ? (k.shared ? t('Used by every person of the tenant') : t('Used only by Tenant Managers')) : k.shared ? t('Used by every tenant without a key of its own') : t('Only for the platform: tenants need a key of their own'), 'ok']
  if (k.in_use === 'tenant') return [t('In use: the key of the tenant'), 'ok']
  if (k.in_use === 'platform') return [t('In use: the key of the platform'), 'ok']
  return [l.kind === 'platform' ? t('The service is off for whoever has no key of their own') : t('No key: the service is off'), 'off']
}

export function KeysPanel({ level }: { level: KeyLevel }) {
  const qc = useQueryClient()
  const q = useApi<ServiceKey[]>(['keys', level.kind, level.kind === 'platform' ? '' : level.slug], keysPath(level))
  const [edit, setEdit] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const run = async (fn: () => Promise<ServiceKey[]>, ok: string) => {
    setBusy(true)
    try {
      const next = await fn()
      qc.setQueryData(['keys', level.kind, level.kind === 'platform' ? '' : level.slug], next)
      toast.success(ok)
      setEdit(null)
      setValue('')
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const intro =
    level.kind === 'platform'
      ? t('The keys of the services the platform pays for. A shared key is used by every tenant without one of its own; a key not shared stays with the platform.')
      : level.kind === 'tenant'
        ? t('The keys the tenant pays for. A shared key is used by every person of the tenant; one not shared only by Tenant Managers. Where the tenant has no key, the one of the platform applies, if the Administrator shares it.')
        : t('Your keys apply only to you and nobody else sees them. Where you have none, you use the one of the tenant or of the platform, if shared.')
  const shareLabel = level.kind === 'platform' ? t('Shared with every tenant') : t('Shared with the people of the tenant')
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t('Keys of outside services')}</CardTitle>
        <CardDescription>{intro}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {q.data!.length === 0 && <p className="text-sm text-muted-foreground">{t('No installed plugin uses keys of outside services.')}</p>}
        {q.data!.length > 0 && (
          <section className="grid gap-2">
            <ul className="grid gap-2">
              {q.data!
                .map((k) => {
                  const name = k.label
                  const desc = [k.description, k.plugins.length ? t('Used by {plugins}', { plugins: k.plugins.join(', ') }) : ''].filter(Boolean).join(' · ')
                  const [use, tone] = inUse(k, level)
                  const editing = edit === k.service
                  const base = `${keysPath(level)}/${enc(k.service)}`
                  return (
                    <li key={k.service} className="grid gap-2 rounded-lg border p-3" data-key={k.service}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <span className="min-w-0">
                          <b className="block text-sm">{name}</b>
                          <span className="block text-xs text-muted-foreground">{desc}</span>
                          <span className={cn('mt-1 block text-xs', tone === 'ok' ? 'text-ok' : 'text-muted-foreground')}>{use}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          {k.set && <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{k.address ? k.hint : `••••${k.hint ?? ''}`}</code>}
                          {!editing && k.declared && (
                            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => (setEdit(k.service), setValue(''))}>
                              {k.set ? <Pencil /> : <Plus />}
                              {k.set ? t('Change') : k.address ? t('Set') : t('Add')}
                              {/* the name of the service for screen readers, after the visible text */}
                              <span className="sr-only">{name}</span>
                            </Button>
                          )}
                          {k.set && !editing && (
                            <Button type="button" variant="outline" size="icon" className="size-8" disabled={busy} aria-label={t('Remove the key of {name}', { name })} onClick={() => void run(() => api<ServiceKey[]>('DELETE', base), t('Key removed'))}>
                              <Trash2 />
                            </Button>
                          )}
                        </span>
                      </div>
                      {editing && (
                        <form
                          className="flex flex-wrap gap-2"
                          onSubmit={(e) => {
                            e.preventDefault()
                            void run(() => api<ServiceKey[]>('PUT', base, { value }), t('Key saved'))
                          }}
                        >
                          <Input
                            autoFocus
                            type={k.address ? 'text' : 'password'}
                            autoComplete="off"
                            className="min-w-56 flex-1 font-mono"
                            aria-label={k.address ? t('Address for {name}', { name }) : t('Key for {name}', { name })}
                            placeholder={k.address ? 'http://server:11434' : t('Paste the key')}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                          />
                          <Button type="button" variant="outline" onClick={() => setEdit(null)}>
                            {t('Cancel')}
                          </Button>
                          <Button type="submit" disabled={busy || !value.trim()}>
                            {t('Save')}
                          </Button>
                        </form>
                      )}
                      {k.set && k.declared && level.kind !== 'me' && (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Switch checked={k.shared} disabled={busy} aria-label={`${shareLabel}: ${name}`} onCheckedChange={(on) => void run(() => api<ServiceKey[]>('PUT', base, { shared: on }), on ? t('Key shared') : t('Key no longer shared'))} />
                          {shareLabel}
                        </label>
                      )}
                    </li>
                  )
                })}
            </ul>
          </section>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" />
          {t('Keys are kept encrypted and never go back to the browser: after saving, only the last four characters show.')}
        </p>
      </CardContent>
    </Card>
  )
}
