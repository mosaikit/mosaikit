// Il tema di tutti, come nel mockup (docs/refactoring-ui.md §5): l'Administrator sceglie quello della
// piattaforma (Sistema › Tema), il Tenant Manager quello del tenant (Impostazioni del tenant › Tema), che
// eredita dalla piattaforma finche' non lo personalizza. Chi lavora sceglie solo il modo, in Account.
// La scelta vale subito, senza un Salva.

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

const enc = encodeURIComponent

const SWATCH: Record<string, { band: string; side: string; acc: string; page: string }> = {
  mosaikit: { band: '#444791', side: '#ebebeb', acc: '#5b5fc7', page: '#ffffff' },
  italia: { band: '#0066cc', side: '#ffffff', acc: '#0066cc', page: '#f5f7fa' },
}

function nameOf(id: string): string {
  return PRESETS.find((p) => p.id === id)?.name ?? id
}

/** I temi disponibili, ciascuno con una piccola anteprima della cornice. */
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
                <span className="text-xs text-muted-foreground">{p.note}</span>
              </span>
              {on && <Check className="size-4 text-primary" />}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/** Sistema › Tema: il tema della piattaforma, dei tenant che non ne scelgono uno e dell'accesso. */
export function PlatformTheme({ session }: { session: Session }) {
  const save = useAction((preset: string) => api('PUT', '/api/admin/theme', { preset }), {
    ok: (p) => `Tema della piattaforma: ${nameOf(p)}`,
    invalidate: [['session']],
  })
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Tema predefinito</CardTitle>
        <CardDescription>Per la piattaforma, la pagina di accesso e i tenant che non ne scelgono uno. Il modo (chiaro, scuro) resta di ciascuno.</CardDescription>
      </CardHeader>
      <CardContent>
        <ThemeCards value={session.theme ?? 'mosaikit'} busy={save.isPending} onPick={(p) => save.mutate(p)} />
      </CardContent>
    </Card>
  )
}

/** Impostazioni del tenant › Tema: ereditato dalla piattaforma, o personalizzato dal Tenant Manager. */
export function TenantTheme({ slug }: { slug: string }) {
  const ctx = useTenantCtx(slug)
  const save = useAction((preset: string | null) => api('PUT', `/api/t/${enc(slug)}/manage/theme`, { preset }), {
    ok: (p) => (p ? `Tema del tenant: ${nameOf(p)}` : 'Di nuovo il tema della piattaforma'),
    invalidate: [['ctx', slug]],
  })
  if (ctx.isLoading) return <Loading />
  const th = ctx.data?.theme ?? { platform: 'mosaikit', tenant: null, preset: 'mosaikit' }
  const own = th.tenant !== null
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Tema del tenant
          <Badge variant={own ? 'default' : 'secondary'}>{own ? 'Personalizzato' : 'Ereditato'}</Badge>
        </CardTitle>
        <CardDescription>
          {own
            ? `Al posto di quello della piattaforma (${nameOf(th.platform)}), per tutte le persone del tenant.`
            : `Quello della piattaforma, scelto dall'Administrator. Scegline un altro per personalizzarlo.`}{' '}
          Il modo (chiaro, scuro) resta di ciascuno.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ThemeCards value={th.preset} busy={save.isPending} onPick={(p) => save.mutate(p)} />
        {own && (
          <div>
            <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => save.mutate(null)}>
              <RotateCcw />
              Ripristina il tema della piattaforma
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
