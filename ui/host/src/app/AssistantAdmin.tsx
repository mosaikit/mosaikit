import { useState } from 'react'
import { api } from '../api.ts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAction, useApi } from './core.ts'
import { t } from './i18n.ts'
import { ErrorBox, Loading, SaveBar } from './kit.tsx'

interface AssistantSettings {
  configured: boolean
  provider: string
  base_url: string | null
  model: string
  has_key: boolean
  enabled: boolean
  allow_byok: boolean
  hourly_limit: number
}

interface Draft {
  provider: string
  base_url: string
  model: string
  api_key: string
  clear_key: boolean
  enabled: boolean
  allow_byok: boolean
  hourly_limit: string
}

const PROVIDERS: { id: string; label: string; hint: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', hint: '' },
  { id: 'openai', label: 'OpenAI', hint: '' },
  { id: 'openai_compatible', label: 'OpenAI-compatible (Ollama, vLLM, LM Studio, Azure, Mistral, Groq…)', hint: 'http://localhost:11434/v1' },
]

function draftOf(s: AssistantSettings): Draft {
  return {
    provider: s.provider || 'anthropic',
    base_url: s.base_url ?? '',
    model: s.model,
    api_key: '',
    clear_key: false,
    enabled: s.configured ? s.enabled : true,
    allow_byok: s.allow_byok,
    hourly_limit: String(s.hourly_limit),
  }
}

/** System › AI assistant: the provider, the key and the limits of the platform (the Administrator). */
export function PlatformAssistantPanel() {
  const q = useApi<AssistantSettings>(['admin-assistant'], '/api/admin/assistant')
  const [d, setD] = useState<Draft | null>(null)
  const save = useAction(
    (x: Draft) =>
      api('PUT', '/api/admin/assistant', {
        provider: x.provider,
        base_url: x.base_url.trim() || null,
        model: x.model.trim(),
        // absent: keep the key; empty: remove it
        ...(x.clear_key ? { api_key: '' } : x.api_key ? { api_key: x.api_key } : {}),
        enabled: x.enabled,
        allow_byok: x.allow_byok,
        hourly_limit: Number(x.hourly_limit) || 60,
      }),
    { ok: t('Assistant settings saved'), invalidate: [['admin-assistant']] },
  )
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const saved = draftOf(q.data!)
  const cur = d ?? saved
  const dirty = !!d && JSON.stringify(d) !== JSON.stringify(saved)
  const set = (p: Partial<Draft>) => setD({ ...cur, ...p })
  const needsAddress = cur.provider === 'openai_compatible'
  return (
    <div className="grid gap-6" data-testid="assistant-admin">
      <Card>
        <CardHeader>
          <CardTitle>{t('AI assistant')}</CardTitle>
          <CardDescription>
            {t('The language model behind the assistant and the MCP server. The key is stored encrypted and is never shown again. Every tenant uses it unless a Tenant Manager brings a key of their own (when you allow it below).')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:max-w-xl">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="as-enabled" className="text-sm font-semibold">{t('Assistant on')}</Label>
            <Switch id="as-enabled" checked={cur.enabled} onCheckedChange={(v) => set({ enabled: v })} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-sm font-semibold">{t('Provider')}</Label>
            <Select value={cur.provider} onValueChange={(v) => set({ provider: v })}>
              <SelectTrigger aria-label={t('Provider')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
                {q.data!.provider === 'fake' && <SelectItem value="fake">{t('Test provider (no model)')}</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          {(needsAddress || cur.base_url) && (
            <div className="grid gap-1.5">
              <Label htmlFor="as-url" className="text-sm font-semibold">{t('Address of the server')}</Label>
              <Input id="as-url" value={cur.base_url} placeholder={needsAddress ? 'http://localhost:11434/v1' : ''} onChange={(e) => set({ base_url: e.target.value })} />
              <span className="text-xs text-muted-foreground">{t('Only the Administrator sets an address. Leave it empty for Anthropic and OpenAI.')}</span>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="as-model" className="text-sm font-semibold">{t('Model')}</Label>
            <Input id="as-model" value={cur.model} placeholder="claude-sonnet-5-5" onChange={(e) => set({ model: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="as-key" className="text-sm font-semibold">{t('Key')}</Label>
            <Input
              id="as-key"
              type="password"
              autoComplete="off"
              value={cur.api_key}
              placeholder={q.data!.has_key && !cur.clear_key ? t('A key is saved: write another to replace it') : t('No key (a local server may not need one)')}
              onChange={(e) => set({ api_key: e.target.value, clear_key: false })}
            />
            {q.data!.has_key && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={cur.clear_key} onCheckedChange={(v) => set({ clear_key: v, api_key: '' })} aria-label={t('Remove the saved key')} />
                {t('Remove the saved key')}
              </label>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="as-limit" className="text-sm font-semibold">{t('Requests per person per hour')}</Label>
            <Input id="as-limit" inputMode="numeric" value={cur.hourly_limit} onChange={(e) => set({ hourly_limit: e.target.value.replace(/\D/g, '') })} className="w-32" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="as-byok" className="text-sm font-semibold">{t('Tenants may bring their own key')}</Label>
              <p className="text-xs text-muted-foreground">{t('A Tenant Manager can then choose Anthropic or OpenAI with their own key; the cost and the data go to that account.')}</p>
            </div>
            <Switch id="as-byok" checked={cur.allow_byok} onCheckedChange={(v) => set({ allow_byok: v })} />
          </div>
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => save.mutate(cur, { onSuccess: () => setD(null) })} onCancel={() => setD(null)} />
    </div>
  )
}
