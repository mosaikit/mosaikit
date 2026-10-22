// The theme editor, as in the mockup (themeedit): whoever is not technical picks three things — the
// main colour, the style of the top band, the greys — and the generator (themegen.ts) computes the rest,
// light and dark. The previews follow at once; the contrast check (WCAG 2.1 AA) says whether it reads,
// "Fix it for me" corrects the colours, and Save stays off while a check fails.

import { useMemo, useState } from 'react'
import { Check, TriangleAlert, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { t } from './i18n.ts'
import { checks, DEFAULT_CHOICES as DEFAULT, fix, generate, isHex, type Bar, type Grays, type ThemeChoices, type Vars } from './themegen.ts'

export interface EditedTheme {
  id?: string
  name: string
  input: ThemeChoices
  light: Vars
  dark: Vars
}

/** A small frame of the shell in the colours of a theme. */
export function Preview({ vars, label }: { vars: Vars; label: string }) {
  return (
    <figure className="overflow-hidden rounded-lg border">
      {/* an illustration of the colours (also unreadable ones, while the checks below fail): not read aloud */}
      <div aria-hidden="true">
        <div className="flex h-6 items-center gap-1.5 px-2 text-[10px] font-semibold" style={{ background: vars['--band'], color: vars['--band-foreground'] }}>
          <span>Mosaikit</span>
          <span className="ml-auto h-3.5 w-20 rounded" style={{ background: vars['--search'] }} />
        </div>
        <div className="flex h-24" style={{ background: vars['--background'], color: vars['--foreground'] }}>
          <div className="flex w-14 flex-col gap-1 p-1.5" style={{ background: vars['--sidebar'] }}>
            <span className="rounded px-1 text-[9px]" style={{ background: vars['--sidebar-accent'], color: vars['--sidebar-accent-foreground'] }}>
              Home
            </span>
            <span className="px-1 text-[9px]" style={{ color: vars['--sidebar-foreground'] }}>
              Notes
            </span>
          </div>
          <div className="flex-1 p-2 text-[10px]">
            <b className="block">{t('Title of a page')}</b>
            <span style={{ color: vars['--muted-foreground'] }}>{t('A secondary text')}</span>
            <span className="mt-1 block underline" style={{ color: vars['--primary'] }}>
              {t('A link')}
            </span>
            <span className="mt-1.5 inline-block rounded px-2 py-0.5" style={{ background: vars['--primary'], color: vars['--primary-foreground'] }}>
              {t('Main button')}
            </span>
          </div>
        </div>
      </div>
      <figcaption className="border-t px-2 py-1 text-[11px] text-muted-foreground">{t('Preview')} · {label}</figcaption>
    </figure>
  )
}

export function ThemeEditor({
  initial,
  busy,
  onSave,
  onClose,
}: {
  initial: EditedTheme | null
  busy?: boolean
  onSave: (t: EditedTheme) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [c, setC] = useState<ThemeChoices>(initial ? initial.input : DEFAULT)
  const [hex, setHex] = useState(c.accent)
  const gen = useMemo(() => generate(c), [c])
  const list = useMemo(() => checks(gen), [gen])
  const bad = list.filter((x) => !x.ok)
  const setAccent = (v: string) => {
    setHex(v)
    // a new main colour starts again from the generated ones
    if (isHex(v)) setC({ ...c, accent: v.toLowerCase(), adv: undefined })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial?.id ? t('Edit the theme') : t('New theme')}</DialogTitle>
          <DialogDescription>{t('Three choices; the rest is computed, light and dark, and checked for contrast.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="te-name">{t('Name')}</Label>
              <Input id="te-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="te-accent">{t('Main colour')}</Label>
              <div className="flex items-center gap-2">
                <input type="color" aria-label={t('Pick the main colour')} value={isHex(hex) && hex.length === 7 ? hex : c.accent} onChange={(e) => setAccent(e.target.value)} className="h-9 w-12 cursor-pointer rounded border bg-transparent" />
                <Input id="te-accent" value={hex} onChange={(e) => setAccent(e.target.value.trim())} className="font-mono" aria-invalid={!isHex(hex)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="te-bar">{t('Top band')}</Label>
              <Select value={c.bar} onValueChange={(v) => setC({ ...c, bar: v as Bar, adv: undefined })}>
                <SelectTrigger id="te-bar" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="color">{t('In the main colour')}</SelectItem>
                  <SelectItem value="dark">{t('Dark')}</SelectItem>
                  <SelectItem value="light">{t('Light')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="te-grays">{t('Greys')}</Label>
              <Select value={c.grays} onValueChange={(v) => setC({ ...c, grays: v as Grays })}>
                <SelectTrigger id="te-grays" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="neutral">{t('Neutral')}</SelectItem>
                  <SelectItem value="warm">{t('Warm')}</SelectItem>
                  <SelectItem value="cool">{t('Cool')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid content-start gap-3">
            <Preview vars={gen.light} label={t('Light')} />
            <Preview vars={gen.dark} label={t('Dark')} />
          </div>
        </div>
        <section aria-labelledby="te-check" className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="te-check" className="flex-1 text-sm font-semibold">
              {t('Does it read?')}
            </h3>
            {bad.length ? (
              <Button size="sm" onClick={() => setC(fix(c))}>
                <Wand2 />
                {t('Fix it for me')}
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm text-ok">
                <Check className="size-4" />
                {t('Everything reads')}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('WCAG 2.1 AA: a contrast of at least 4.5 for texts.')}</p>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {list.map((x) => (
              <li key={`${x.mode}${x.fg}`} className={cn('flex items-center gap-2', !x.ok && 'font-medium text-destructive')}>
                {x.ok ? <Check className="size-3.5 shrink-0 text-ok" aria-hidden="true" /> : <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />}
                <span className="flex-1">
                  {t(x.label)} · {x.mode === 'light' ? t('Light') : t('Dark')}
                </span>
                <span className="font-mono tabular-nums">{x.ratio.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </section>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={busy || !!bad.length || !name.trim() || !isHex(hex)}
            title={bad.length ? t('Some colours do not read: fix them first') : undefined}
            onClick={() => onSave({ id: initial?.id, name: name.trim(), input: c, light: gen.light, dark: gen.dark })}
          >
            {t('Save the theme')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
