// Everyone's theme, as in the mockup (docs/refactoring-ui.md §5): the Administrator chooses the one of the
// platform (System › Theme), the Tenant Manager the one of the tenant (Tenant settings › Theme), which
// inherits from the platform until it is customized. Whoever works chooses only the mode, in Account.
// The choice applies at once, without a Save.

import { Check, RotateCcw } from 'lucide-react'
import { api } from '../api.ts'
import type { Session } from '../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useAction, useTenantCtx } from './core.ts'
import { Loading } from './kit.tsx'
import { PRESETS } from './theme.ts'
import { t } from './i18n.ts'

const enc = encodeURIComponent

const SWATCH: Record<string, { band: string; side: string; acc: string; page: string }> = {
  mosaikit: { band: '#444791', side: '#ebebeb', acc: '#5b5fc7', page: '#ffffff' },
  italia: { band: '#0066cc', side: '#ffffff', acc: '#0066cc', page: '#f5f7fa' },
  tessera: { band: '#6e1522', side: '#efebe6', acc: '#a8293a', page: '#fffdfa' },
}

function nameOf(id: string): string {
  return PRESETS.find((p) => p.id === id)?.name ?? id
}

/** The available themes, each with a small preview of the frame. */
function ThemeCards({ value, busy, onPick }: { value: string; busy?: boolean; onPick: (id: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {PRESETS.map((p) => {
        const s = SWATCH[p.id]
        const on = value === p.id
        return (
          <button
            key={p.id}
            type="button"
            disabled={busy}
            onClick={() => !on && onPick(p.id)}
            aria-pressed={on}
            className={cn('overflow-hidden rounded-xl border text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60', on && 'border-primary ring-1 ring-primary')}
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
                <span className="text-xs text-muted-foreground">{t(p.note)}</span>
              </span>
              {on && <Check className="size-4 text-primary" />}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/** System › Theme: the theme of the platform, of the tenants that do not choose one and of the sign-in. */
export function PlatformTheme({ session }: { session: Session }) {
  const save = useAction((preset: string) => api('PUT', '/api/admin/theme', { preset }), {
    ok: (p) => t('Theme of the platform: {name}', { name: nameOf(p) }),
    invalidate: [['session']],
  })
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t('Default theme')}</CardTitle>
        <CardDescription>{t('For the platform, the sign-in page and the tenants that do not choose one. The mode (light, dark) stays with each person.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ThemeCards value={session.theme ?? 'mosaikit'} busy={save.isPending} onPick={(p) => save.mutate(p)} />
      </CardContent>
    </Card>
  )
}

/** Tenant settings › Theme: inherited from the platform, or customized by the Tenant Manager. */
export function TenantTheme({ slug }: { slug: string }) {
  const ctx = useTenantCtx(slug)
  const save = useAction((preset: string | null) => api('PUT', `/api/t/${enc(slug)}/manage/theme`, { preset }), {
    ok: (p) => (p ? t('Theme of the tenant: {name}', { name: nameOf(p) }) : t('Back to the theme of the platform')),
    invalidate: [['ctx', slug]],
  })
  if (ctx.isLoading) return <Loading />
  const th = ctx.data?.theme ?? { platform: 'mosaikit', tenant: null, preset: 'mosaikit' }
  const own = th.tenant !== null
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t('Theme of the tenant')}
          <Badge variant={own ? 'default' : 'secondary'}>{own ? t('Customized') : t('Inherited')}</Badge>
        </CardTitle>
        <CardDescription>
          {own
            ? t('Instead of the one of the platform ({platform}), for everybody in the tenant.', { platform: nameOf(th.platform) })
            : t('The one of the platform, chosen by the Administrator. Pick another one to customize it.')}{' '}
          {t('The mode (light, dark) stays with each person.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ThemeCards value={th.preset} busy={save.isPending} onPick={(p) => save.mutate(p)} />
        {own && (
          <div>
            <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => save.mutate(null)}>
              <RotateCcw />
              {t('Restore the theme of the platform')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
