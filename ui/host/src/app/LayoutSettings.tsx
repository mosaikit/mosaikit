// Identity and appearance › Layout and Style (phase 10), for the platform (System) and for a tenant
// (Tenant settings), on the settings on three levels: the Administrator picks the layout and the style of
// the platform, which layouts tenants may choose and whether they may customize layout and style; a
// Tenant Manager customizes them when allowed (Inherited / Customized, Restore). The style shows on the
// whole page while it is being changed.

import { useEffect } from 'react'
import { Check, Plus } from 'lucide-react'
import type { Setting } from '../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { t } from './i18n.ts'
import { endPreview, previewStyle, STYLE_KEYS, STYLE_OPTIONS, useLayouts, type LayoutInfo, type Pattern, type StyleVars } from './layouts.ts'
import { to } from './router.ts'
import { ImageSlot, Panel, Row } from './SettingsPanels.tsx'
import { useLevelSettings, type Draft, type Level } from './settingsdraft.ts'

/** A small picture of a layout, in the colours of the theme in use. */
export function LayoutThumb({ pattern, card }: { pattern: Pattern; card?: boolean }) {
  const band = <i className="block h-3 shrink-0 bg-band" />
  const line = (w: string, accent?: boolean) => <i className={cn('block h-1 rounded-full', accent ? 'bg-primary' : 'bg-border')} style={{ width: w }} />
  const lines = (n: number) => (
    <span className="flex flex-col gap-1 p-1.5">
      {Array.from({ length: n }, (_, i) => (
        <span key={i}>{line(`${80 - i * 12}%`, i === 0)}</span>
      ))}
    </span>
  )
  const content = <span className="flex-1 bg-background">{lines(3)}</span>
  let body
  switch (pattern) {
    case 'rail':
      body = (
        <span className="flex flex-1">
          <span className="w-[14%] bg-sidebar">{lines(4)}</span>
          {content}
        </span>
      )
      break
    case 'sidebar':
      body = (
        <span className={cn('flex flex-1', card && 'bg-pane p-1')}>
          <span className={cn('w-[28%] bg-sidebar', card && 'rounded shadow-sm')}>{lines(5)}</span>
          {content}
        </span>
      )
      break
    case 'drawer':
      body = (
        <span className="flex flex-1">
          <span className="w-[30%] border-r bg-sidebar">{lines(5)}</span>
          {content}
        </span>
      )
      break
    case 'areas':
      body = (
        <span className="flex flex-1">
          <span className="w-[9%] bg-band" />
          <span className="w-[24%] bg-sidebar">{lines(4)}</span>
          {content}
        </span>
      )
      break
    case 'tabs':
    case 'launcher':
      body = (
        <span className="flex flex-1 flex-col">
          <span className="flex h-3 items-center gap-1 border-b bg-background px-1.5">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className={cn('block h-1 w-5 rounded-full', i === 0 ? 'bg-primary' : 'bg-border')} />
            ))}
          </span>
          {content}
        </span>
      )
      break
  }
  return (
    <span aria-hidden="true" className="flex h-24 flex-col overflow-hidden rounded-md border">
      {band}
      {body}
    </span>
  )
}

/** The layouts as cards to choose from; the chosen one with the check. */
function LayoutCards({ layouts, value, disabled, onPick }: { layouts: LayoutInfo[]; value: string; disabled?: boolean; onPick: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label={t('Layout')} className="grid gap-3 sm:grid-cols-2">
      {layouts.map((l) => {
        const on = l.id === value
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            data-layout-card={l.id}
            onClick={() => onPick(l.id)}
            className={cn('grid gap-2 rounded-lg border p-3 text-left outline-none hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70', on && 'border-primary ring-1 ring-primary')}
          >
            <LayoutThumb pattern={l.decl.pattern} card={l.decl.nav.card} />
            <span className="flex items-center gap-2">
              <b className="text-sm">{l.name}</b>
              <Badge variant="secondary">{l.built_in ? t('Built-in') : t('Plugin')}</Badge>
              {on && <Check className="ml-auto size-4 text-primary" />}
            </span>
            <span className="text-xs text-muted-foreground">{l.description}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Layout of the platform or of the tenant, and (platform) the layouts tenants may choose. */
export function LayoutPanel({ level }: { level: Level }) {
  const list = useLayouts()
  const q = useLevelSettings(level)
  if (!list.data) return null
  const all = list.data.layouts
  const allowed = list.data.allowed
  // a tenant sees the layout of the platform and the ones it may choose
  const choosable = level.kind === 'tenant' ? all.filter((l) => l.id === list.data.platform || !allowed || allowed.includes(l.id)) : all
  const allowedSetting = q.data?.find((s) => s.key === 'layout.allowed')
  return (
    <div className="grid gap-6">
      <Panel
        level={level}
        keys={['layout']}
        title={t('Layout')}
        description={t('Every layout works with every theme and style. Landmarks, the «Skip to the content» link and the order of the keyboard stay the shell’s in every layout.')}
      >
        {(d, s) => (
          <Row level={level} d={d} s={s('layout')!} display={(v) => all.find((l) => l.id === v)?.name ?? String(v)}>
            <LayoutCards layouts={choosable} value={String(d.value('layout') ?? '')} onPick={(id) => d.set('layout', id)} />
          </Row>
        )}
      </Panel>
      {level.kind === 'platform' && allowedSetting && (
        <Panel level={level} keys={['layout.allowed']} title={t('Layouts the tenants may choose')} description={t('The layout of the platform is always allowed. None ticked: every layout.')}>
          {(d) => <AllowedLayouts d={d} layouts={all} />}
        </Panel>
      )}
      {level.kind === 'platform' && (
        <p className="text-sm">
          <Button asChild variant="outline" size="sm">
            <a href={to.admin('plugins', 'catalog')}>
              <Plus />
              {t('More layouts from the plugins')}
            </a>
          </Button>
        </p>
      )}
    </div>
  )
}

function AllowedLayouts({ d, layouts }: { d: Draft; layouts: LayoutInfo[] }) {
  const v = d.value('layout.allowed')
  const list = Array.isArray(v) ? (v as string[]) : []
  return (
    <fieldset className="grid gap-2">
      <legend className="sr-only">{t('Layouts the tenants may choose')}</legend>
      {layouts.map((l) => {
        const on = list.includes(l.id)
        return (
          <label key={l.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={on} onCheckedChange={(c) => d.set('layout.allowed', c ? [...list, l.id] : list.filter((x) => x !== l.id))} />
            {l.name}
          </label>
        )
      })}
    </fieldset>
  )
}

const optionLabels = (): Record<string, string> => ({
  square: t('Square'),
  medium: t('Medium'),
  round: t('Round'),
  compact: t('Compact'),
  comfortable: t('Comfortable'),
  system: t('System'),
  humanist: t('Humanist'),
  serif: t('Serif'),
  underline: t('Underline'),
  pill: t('Pill'),
  boxed: t('Boxed'),
  filled: t('Filled'),
  outline: t('Outline'),
  soft: t('Soft'),
})

/** While the Style editor is open, the page shows the style being changed. */
function Preview({ d }: { d: Draft }) {
  const changes: Partial<StyleVars> = {}
  for (const k of STYLE_KEYS) {
    const v = d.value(`style.${k}`)
    if (typeof v === 'string') (changes as Record<string, string>)[k] = v
  }
  const key = JSON.stringify(changes)
  useEffect(() => {
    previewStyle(JSON.parse(key) as Partial<StyleVars>)
  }, [key])
  useEffect(() => () => endPreview(), [])
  return null
}

/** The style: corners, density, font, tabs, main buttons and the image under the band. */
export function StylePanel({ level }: { level: Level }) {
  const q = useLevelSettings(level)
  const names = optionLabels()
  return (
    <div className="grid gap-6">
      <Panel
        level={level}
        keys={STYLE_KEYS.map((k) => `style.${k}`)}
        title={t('Style')}
        description={t('Shapes, density, font, tabs and main buttons, with every layout and theme. No value: the default of the layout in use. The page shows the changes before they are saved.')}
      >
        {(d, s) => (
          <>
            <Preview d={d} />
            {STYLE_KEYS.map((k) => {
              const set = s(`style.${k}`)
              if (!set) return null
              return <StyleRow key={k} level={level} d={d} s={set} options={(STYLE_OPTIONS[k] as string[]).map((o): [string, string] => [o, names[o] ?? o])} />
            })}
            <StyleSample />
          </>
        )}
      </Panel>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{t('Band image')}</CardTitle>
          <CardDescription>
            {t('A PNG under the band, at most 512 KB. The band colour darkens it as much as needed for the texts of the band to read at 4.5:1 over its brightest part; an image too bright even then is refused. Without one, the image of the layout, if it has one.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImageSlot level={level} slot="band" label={t('Band image')} hint={t('Covers the band, centred')} setting={q.data?.find((x: Setting) => x.key === 'style.band_image')} accept="image/png" wide />
        </CardContent>
      </Card>
    </div>
  )
}

function StyleRow({ level, d, s, options }: { level: Level; d: Draft; s: Setting; options: [string, string][] }) {
  // no value of its own: the default of the layout in use («default», which saves null)
  const id = `set-${s.key.replace(/\W/g, '-')}`
  const v = d.value(s.key)
  const value = typeof v === 'string' && v ? v : 'default'
  const all: [string, string][] = [['default', t('Default of the layout')], ...options]
  return (
    <Row level={level} d={d} s={s} display={(x) => all.find((o) => o[0] === x)?.[1] ?? t('Default of the layout')}>
      <Select value={value} onValueChange={(x) => d.set(s.key, x === 'default' ? null : x)}>
        <SelectTrigger id={id} className="w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {all.map(([o, label]) => (
            <SelectItem key={o} value={o}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  )
}

/** A sample of what the style changes: a tab bar and the main button. */
function StyleSample() {
  return (
    <div className="grid gap-3 rounded-lg border p-3" aria-label={t('Sample')} role="group">
      <span className="text-xs text-muted-foreground">{t('Sample')}</span>
      <nav aria-label={t('Sample tabs')} className="flex gap-1 border-b">
        {[t('Details'), t('People'), t('Log')].map((x, i) => (
          <span key={x} aria-current={i === 0 ? 'page' : undefined} className={cn('msk-tab relative flex h-9 items-center px-3 text-sm text-muted-foreground', i === 0 && "font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary after:content-['']")}>
            {x}
          </span>
        ))}
      </nav>
      <div className="flex gap-2">
        <Button type="button">{t('Save')}</Button>
        <Button type="button" variant="outline">
          {t('Cancel')}
        </Button>
      </div>
    </div>
  )
}
