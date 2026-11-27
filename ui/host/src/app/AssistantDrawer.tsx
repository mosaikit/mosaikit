// The AI assistant in the shell: an icon in the top bar and a side panel with the page of the plugin
// `com.mosaikit.ai-assistant`. The icon is there only when the plugin is on in the tenant and the Administrator
// has set a provider. The state (open or not) is kept outside React, like the comments, so the icon and the panel share it.

import { useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api, enc } from '../api.ts'
import { ASSISTANT_PLUGIN } from '../bridge.ts'
import PluginFrame from '../components/PluginFrame.tsx'
import type { Route } from './router.ts'
import type { Session } from '../types.ts'
import { cn } from '@/lib/utils'
import { closeAssistant, toggleAssistant, useAssistantOpen } from './assistant-state.ts'
import { useTenantCtx } from './core.ts'
import { t, useLang } from './i18n.ts'
import { effectiveMode, useTheme } from './theme.ts'

export const ASSISTANT_PANEL_ID = 'msk-assistant-panel'

/** The assistant is offered in a tenant when its plugin is on there and a provider is set. */
function useAssistantAvailable(route: Route) {
  const slug = route.area === 'tenant' ? route.tenant : ''
  const ctx = useTenantCtx(slug)
  const plugin = ctx.data?.plugins.find((p) => p.id === ASSISTANT_PLUGIN)
  const status = useQuery({
    queryKey: ['assistant-status', slug],
    queryFn: () => api<{ available: boolean }>('GET', `/api/t/${enc(slug)}/assistant/status`),
    enabled: !!plugin,
    staleTime: 60_000,
  })
  return { plugin, ctx: ctx.data, available: !!plugin && status.data?.available === true, slug }
}

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current'

/** The button of the top bar. */
export function AssistantButton({ route }: { route: Route }) {
  const { available } = useAssistantAvailable(route)
  const isOpen = useAssistantOpen()
  if (!available) return null
  return (
    <button
      type="button"
      data-testid="assistant-button"
      className={cn('msk-band-assistant flex size-8 shrink-0 items-center justify-center rounded-md text-band-foreground hover:bg-band-hover', isOpen && 'bg-band-hover ring-1 ring-white/40', focus)}
      aria-expanded={isOpen}
      aria-controls={ASSISTANT_PANEL_ID}
      title={isOpen ? t('Close the assistant') : t('Open the assistant')}
      onClick={toggleAssistant}
    >
      <Sparkles className="size-[18px]" aria-hidden="true" />
      <span className="sr-only">{t('Assistant')}</span>
    </button>
  )
}

/** The side panel: the page of the plugin in a frame, over the right side of the content. */
export function AssistantDrawer({ session, route }: { session: Session; route: Route }) {
  const { plugin, ctx, available } = useAssistantAvailable(route)
  const isOpen = useAssistantOpen()
  const lang = useLang()
  const th = useTheme()
  // another tenant (or a page that is not a tenant's): the panel closes
  const slug = route.area === 'tenant' ? route.tenant : ''
  useEffect(() => closeAssistant(), [slug])
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeAssistant()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen])
  if (!available || !plugin || !ctx) return null
  const ui = { lang, preset: th.preset, mode: effectiveMode(th), preference: th.mode, contrast: th.contrast }
  return (
    <aside
      id={ASSISTANT_PANEL_ID}
      data-testid="assistant-panel"
      aria-label={t('Assistant')}
      hidden={!isOpen}
      className="fixed top-[50px] right-0 bottom-0 z-30 flex w-[min(440px,100vw)] flex-col border-l bg-background shadow-xl"
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4" aria-hidden="true" />
          {t('Assistant')}
        </span>
        <button type="button" className={cn('flex size-7 items-center justify-center rounded-md hover:bg-muted', focus)} onClick={closeAssistant} title={t('Close the assistant')}>
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">{t('Close the assistant')}</span>
        </button>
      </div>
      {/* the frame stays loaded while the panel is closed: the chat in progress is not lost */}
      <div className="relative flex-1 [&_.frame-msg]:absolute [&_.frame-msg]:inset-0 [&_.frame-msg]:flex [&_.frame-msg]:items-center [&_.frame-msg]:justify-center [&_.frame-msg]:text-sm [&_.frame-msg]:text-muted-foreground [&_.frame-wrap]:absolute [&_.frame-wrap]:inset-0 [&_iframe]:size-full [&_iframe]:border-0">
        <PluginFrame key={`${plugin.id}|${slug}|panel`} plugin={plugin} session={session} ctx={ctx} reloadKey={0} ui={ui} at="panel" />
      </div>
    </aside>
  )
}
