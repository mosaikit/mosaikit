// Everyone's theme, as in the mockup (docs/refactoring-ui.md §5): the Administrator chooses the one of the
// platform (System › Theme), the Tenant Manager the one of the tenant (Tenant settings › Theme), which
// inherits from the platform until it is customized. Whoever works chooses only the mode, in Account.
// The choice applies at once, without a Save. Next to the built-in themes there are the ones made with
// the theme editor: the Administrator's for the platform (and which themes tenants may use), and the
// Tenant Manager's for the tenant, when the Administrator lets tenants customize the theme.

import { useState } from 'react'
import { Check, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../api.ts'
import type { CustomTheme, Session } from '../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useAction, useApi, useConfirm, useTenantCtx } from './core.ts'
import { Loading, Locked } from './kit.tsx'
import { PRESETS } from './theme.ts'
import { ThemeEditor, type EditedTheme } from './ThemeEditor.tsx'
import { choicesOf } from './themegen.ts'
import { t } from './i18n.ts'

const enc = encodeURIComponent

const SWATCH: Record<string, { band: string; side: string; acc: string; page: string }> = {
  mosaikit: { band: '#444791', side: '#ebebeb', acc: '#5b5fc7', page: '#ffffff' },
  italia: { band: '#0066cc', side: '#ffffff', acc: '#0066cc', page: '#f5f7fa' },
  tessera: { band: '#6e1522', side: '#efebe6', acc: '#a8293a', page: '#fffdfa' },
}

interface ThemeCard {
  id: string
  name: string
  note: string
  swatch: { band: string; side: string; acc: string; page: string }
  /** a theme of the editor this page may change */
  custom?: CustomTheme
}

function cardsOf(customs: CustomTheme[], allowed: string[] | null | undefined, editable: (c: CustomTheme) => boolean): ThemeCard[] {
  const builtIn = PRESETS.filter((p) => !allowed || allowed.includes(p.id)).map((p) => ({ id: p.id, name: p.name, note: t(p.note), swatch: SWATCH[p.id] }))
  const made = customs.map((c) => ({
    id: c.id,
    name: c.name,
    note: c.scope === 'tenant' ? t('made for this tenant') : t('made with the theme editor'),
    swatch: { band: c.light['--band'], side: c.light['--sidebar'] ?? c.light['--background'], acc: c.light['--primary'], page: c.light['--background'] },
    custom: editable(c) ? c : undefined,
  }))
  return [...builtIn, ...made]
}

function nameOf(id: string, customs: CustomTheme[] = []): string {
  return PRESETS.find((p) => p.id === id)?.name ?? customs.find((c) => c.id === id)?.name ?? id
}

/** The available themes, each with a small preview of the frame. */
function ThemeCards({
  cards,
  value,
  busy,
  onPick,
  onEdit,
  onDelete,
}: {
  cards: ThemeCard[]
  value: string
  busy?: boolean
  onPick: (id: string) => void
  onEdit?: (c: CustomTheme) => void
  onDelete?: (c: CustomTheme) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((p) => {
        const s = p.swatch
        const on = value === p.id
        return (
          <div key={p.id} className={cn('overflow-hidden rounded-xl border', on && 'border-primary ring-1 ring-primary')}>
            <button
              type="button"
              disabled={busy}
              onClick={() => !on && onPick(p.id)}
              aria-pressed={on}
              className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <div className="h-20" style={{ background: s.page }}>
                <div className="h-4" style={{ background: s.band }} />
                <div className="flex h-16">
                  <div className="w-10 border-r" style={{ background: s.side }} />
                  <div className="flex-1 p-2">
                    <div className="mb-1.5 h-1.5 w-16 rounded" style={{ background: s.acc }} />
                    <div className="h-1.5 w-24 rounded bg-black/10" />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 border-t p-3">
                <span className="flex-1">
                  <b className="block text-sm">{p.name}</b>
                  <span className="text-xs text-muted-foreground">{p.note}</span>
                </span>
                {on && <Check className="size-4 text-primary" />}
              </div>
            </button>
            {p.custom && (onEdit || onDelete) && (
              <div className="flex justify-end gap-1 border-t px-2 py-1">
                {onEdit && (
                  <Button variant="ghost" size="sm" onClick={() => onEdit(p.custom!)} aria-label={t('Edit the theme {name}', { name: p.name })}>
                    <Pencil />
                    {t('Edit')}
                  </Button>
                )}
                {onDelete && (
                  <Button variant="ghost" size="sm" onClick={() => onDelete(p.custom!)} aria-label={t('Delete the theme {name}', { name: p.name })}>
                    <Trash2 />
                    {t('Delete')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function toEdited(c: CustomTheme): EditedTheme {
  return { id: c.id, name: c.name, input: choicesOf(c.input), light: c.light, dark: c.dark }
}

interface PlatformThemes {
  themes: CustomTheme[]
  allowed: string[] | null
  built_in: string[]
}

/** System › Theme: the theme of the platform, of the tenants that do not choose one and of the sign-in;
 *  the themes of the editor and which themes tenants may use. */
export function PlatformTheme({ session }: { session: Session }) {
  const confirm = useConfirm()
  const q = useApi<PlatformThemes>(['admin-themes'], '/api/admin/themes')
  const [editing, setEditing] = useState<EditedTheme | null | 'new'>(null)
  const inv = [['session'], ['admin-themes']]
  const pick = useAction((preset: string) => api('PUT', '/api/admin/theme', { preset }), {
    ok: (p) => t('Theme of the platform: {name}', { name: nameOf(p, q.data?.themes) }),
    invalidate: inv,
  })
  const store = useAction(
    (e: EditedTheme) => api(e.id ? 'PUT' : 'POST', e.id ? `/api/admin/themes/${enc(e.id)}` : '/api/admin/themes', e).then(() => setEditing(null)),
    { ok: (e) => t('Theme saved: {name}', { name: e.name }), invalidate: inv },
  )
  const remove = useAction((c: CustomTheme) => api('DELETE', `/api/admin/themes/${enc(c.id)}`), { ok: t('Theme deleted'), invalidate: inv })
  const allow = useAction((allowed: string[] | null) => api('PUT', '/api/admin/themes-allowed', { allowed }), { ok: t('Themes of the tenants saved'), invalidate: inv })
  if (q.isLoading) return <Loading />
  const themes = q.data?.themes ?? []
  const allowed = q.data?.allowed ?? null
  const current = session.theme ?? 'mosaikit'
  const all = [...PRESETS.map((p) => ({ id: p.id, name: p.name })), ...themes.map((c) => ({ id: c.id, name: c.name }))]
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Default theme')}</CardTitle>
          <CardDescription>{t('For the platform, the sign-in page and the tenants that do not choose one. The mode (light, dark) stays with each person.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ThemeCards
            cards={cardsOf(themes, null, () => true)}
            value={current}
            busy={pick.isPending}
            onPick={(p) => pick.mutate(p)}
            onEdit={(c) => setEditing(toEdited(c))}
            onDelete={async (c) => {
              if (await confirm(t('Delete the theme {name}? Tenants using it go back to the theme of the platform.', { name: c.name }), true)) remove.mutate(c)
            }}
          />
          <div>
            <Button variant="outline" onClick={() => setEditing('new')}>
              <Plus />
              {t('New theme')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Themes tenants may use')}</CardTitle>
          <CardDescription>{t('The theme of the platform is always among them. A tenant using a theme no longer offered goes back to the one of the platform.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label className="flex items-center justify-between gap-4">
            <b className="text-sm">{t('Every theme')}</b>
            <Switch checked={allowed === null} onCheckedChange={(v) => allow.mutate(v ? null : all.map((x) => x.id))} aria-label={t('Every theme')} />
          </label>
          {allowed !== null && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {all.map((x) => {
                const on = x.id === current || allowed.includes(x.id)
                return (
                  <li key={x.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={on}
                        disabled={x.id === current || allow.isPending}
                        onCheckedChange={(v) => allow.mutate(v ? [...allowed, x.id] : allowed.filter((a) => a !== x.id))}
                      />
                      {x.name}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      {editing && <ThemeEditor initial={editing === 'new' ? null : editing} busy={store.isPending} onClose={() => setEditing(null)} onSave={(e) => store.mutate(e)} />}
    </div>
  )
}

/** Tenant settings › Theme: inherited from the platform, or customized by the Tenant Manager. */
export function TenantTheme({ slug }: { slug: string }) {
  const ctx = useTenantCtx(slug)
  const confirm = useConfirm()
  const [editing, setEditing] = useState<EditedTheme | null | 'new'>(null)
  const allowedQ = useApi<{ themes: CustomTheme[]; allowed: string[] | null }>(['tenant-themes', slug], `/api/t/${enc(slug)}/themes`)
  const inv = [['ctx', slug], ['tenant-themes', slug]]
  const customs = ctx.data?.themes ?? []
  const save = useAction((preset: string | null) => api('PUT', `/api/t/${enc(slug)}/manage/theme`, { preset }), {
    ok: (p) => (p ? t('Theme of the tenant: {name}', { name: nameOf(p, customs) }) : t('Back to the theme of the platform')),
    invalidate: inv,
  })
  const store = useAction(
    (e: EditedTheme) =>
      api(e.id ? 'PUT' : 'POST', e.id ? `/api/t/${enc(slug)}/manage/themes/${enc(e.id)}` : `/api/t/${enc(slug)}/manage/themes`, e).then(() => setEditing(null)),
    { ok: (e) => t('Theme saved: {name}', { name: e.name }), invalidate: inv },
  )
  const remove = useAction((c: CustomTheme) => api('DELETE', `/api/t/${enc(slug)}/manage/themes/${enc(c.id)}`), { ok: t('Theme deleted'), invalidate: inv })
  if (ctx.isLoading) return <Loading />
  const th = ctx.data?.theme ?? { platform: 'mosaikit', tenant: null, preset: 'mosaikit', locked: false }
  // the Administrator turned off "tenants may customize it": the theme of the platform, with the padlock
  if (th.locked) return <Locked label={t('Theme of the tenant')} value={nameOf(th.preset, customs)} hint={t('Tenants may not customize it.')} />
  const own = th.tenant !== null && th.tenant === th.preset
  const allowed = allowedQ.data?.allowed ?? null
  const builtInAllowed = allowed ? [...allowed, th.platform] : null
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t('Theme of the tenant')}
          <Badge variant={own ? 'default' : 'secondary'}>{own ? t('Customized') : t('Inherited')}</Badge>
        </CardTitle>
        <CardDescription>
          {own
            ? t('Instead of the one of the platform ({platform}), for everybody in the tenant.', { platform: nameOf(th.platform, customs) })
            : t('The one of the platform, chosen by the Administrator. Pick another one to customize it.')}{' '}
          {t('The mode (light, dark) stays with each person.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ThemeCards
          cards={cardsOf(customs, builtInAllowed, (c) => c.scope === 'tenant')}
          value={th.preset}
          busy={save.isPending}
          onPick={(p) => save.mutate(p)}
          onEdit={(c) => setEditing(toEdited(c))}
          onDelete={async (c) => {
            if (await confirm(t('Delete the theme {name}? If it is in use the tenant goes back to the theme of the platform.', { name: c.name }), true)) remove.mutate(c)
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing('new')}>
            <Plus />
            {t('New theme')}
          </Button>
          {own && (
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(null)}>
              <RotateCcw />
              {t('Restore the theme of the platform')}
            </Button>
          )}
        </div>
      </CardContent>
      {editing && <ThemeEditor initial={editing === 'new' ? null : editing} busy={store.isPending} onClose={() => setEditing(null)} onSave={(e) => store.mutate(e)} />}
    </Card>
  )
}
