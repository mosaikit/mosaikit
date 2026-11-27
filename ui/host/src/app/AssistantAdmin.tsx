import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../api.ts'
import { Button } from '@/components/ui/button'
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
  user_models: string[]
}

interface ModelInfo {
  id: string
  label: string
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
  user_models: string[]
}

/** A model name to suggest, by provider. */
const EXAMPLE_MODEL: Record<string, string> = { anthropic: 'claude-sonnet-5-5', openai: 'gpt-4.1', openai_compatible: 'llama3.1' }

const PROVIDERS: { id: string; label: string; hint: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', hint: '' },
  { id: 'openai', label: 'OpenAI', hint: '' },
  { id: 'openai_compatible', label: 'OpenAI-compatible (Ollama, vLLM, LM Studio, Azure, Mistral, Groq…)', hint: 'http://localhost:11434/v1' },
]

function draftOf(s: AssistantSettings): Draft {
  return {
    provider: s.provider,
    base_url: s.base_url ?? '',
    model: s.model,
    api_key: '',
    clear_key: false,
    enabled: s.configured ? s.enabled : true,
    allow_byok: s.allow_byok,
    hourly_limit: String(s.hourly_limit),
    user_models: s.user_models ?? [],
  }
}

/** System › AI assistant: the provider, the key and the limits of the platform (the Administrator). */
export function PlatformAssistantPanel() {
  const q = useApi<AssistantSettings>(['admin-assistant'], '/api/admin/assistant')
  const [d, setD] = useState<Draft | null>(null)
  // the models the provider offers, asked on request (it needs the saved provider and key)
  const [offered, setOffered] = useState<ModelInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const loadModels = async () => {
    setLoading(true)
    try {
      setOffered(await api<ModelInfo[]>('GET', '/api/admin/assistant/models'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }
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
        user_models: x.user_models,
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
  // what is missing, said before the server has to refuse it
  const problem = !cur.provider
    ? t('Choose the provider.')
    : !cur.model.trim()
    ? t('Write the name of the model (for example {name}).', { name: EXAMPLE_MODEL[cur.provider] ?? 'llama3.1' })
    : needsAddress && !cur.base_url.trim()
      ? t('Write the address of the server (for example {name}).', { name: 'http://localhost:11434/v1' })
      : ''
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
            <Select
              value={cur.provider}
              // an OpenAI-compatible server starts with the address of a local Ollama, so the field is never an empty-looking one
              onValueChange={(v) => set({ provider: v, base_url: v === 'openai_compatible' && !cur.base_url.trim() ? 'http://localhost:11434/v1' : cur.base_url })}
            >
              <SelectTrigger aria-label={t('Provider')}>
                <SelectValue placeholder={t('Choose the provider')} />
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
              <Input id="as-url" value={cur.base_url} onChange={(e) => set({ base_url: e.target.value })} />
              <span className="text-xs text-muted-foreground">{t('Only the Administrator sets an address. Leave it empty for Anthropic and OpenAI.')}</span>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="as-model" className="text-sm font-semibold">{t('Model')}</Label>
            <Input
              id="as-model"
              value={cur.model}
              placeholder={t('e.g. {name}', { name: EXAMPLE_MODEL[cur.provider] ?? 'llama3.1' })}
              aria-invalid={!cur.model.trim() || undefined}
              aria-describedby={problem ? 'as-problem' : undefined}
              onChange={(e) => set({ model: e.target.value })}
            />
            {problem && (
              <span id="as-problem" role="alert" className="text-xs font-medium text-destructive">
                {problem}
              </span>
            )}
          </div>
          <div className="grid gap-2 rounded-lg border p-3" data-testid="assistant-models">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-sm font-semibold">{t('Models people may choose')}</Label>
                <p className="text-xs text-muted-foreground">{t('Tenant Managers may use every model of the provider. Everybody else chooses among the default and the ones you tick here.')}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadModels()} disabled={loading || !q.data!.configured || dirty}>
                {loading && <Loader2 className="animate-spin" />}
                {t('Load the models')}
              </Button>
            </div>
            {!q.data!.configured || dirty ? (
              <p className="text-xs text-muted-foreground">{t('Save the provider and the key first: the models are asked to the provider with them.')}</p>
            ) : null}
            {offered && (
              <>
                <div className="flex items-center gap-2">
                  <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('Filter the models')} aria-label={t('Filter the models')} className="h-8" />
                  <Button type="button" variant="ghost" size="sm" onClick={() => set({ user_models: offered.map((m) => m.id).filter((id) => id !== cur.model) })}>{t('All')}</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => set({ user_models: [] })}>{t('None')}</Button>
                </div>
                <div className="grid max-h-56 gap-1 overflow-auto">
                  {offered
                    .filter((m) => !filter.trim() || m.id.toLowerCase().includes(filter.toLowerCase()) || m.label.toLowerCase().includes(filter.toLowerCase()))
                    .map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={m.id === cur.model || cur.user_models.includes(m.id)}
                          disabled={m.id === cur.model}
                          onChange={(e) => set({ user_models: e.target.checked ? [...cur.user_models, m.id] : cur.user_models.filter((x) => x !== m.id) })}
                        />
                        <span>{m.label}</span>
                        {m.label !== m.id && <span className="text-xs text-muted-foreground">{m.id}</span>}
                        {m.id === cur.model && <span className="text-xs text-muted-foreground">{t('default')}</span>}
                      </label>
                    ))}
                </div>
              </>
            )}
            {!offered && cur.user_models.length > 0 && (
              <p className="text-xs text-muted-foreground">{t('{n} models allowed', { n: String(cur.user_models.length) })}</p>
            )}
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
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => (problem ? toast.error(problem) : save.mutate(cur, { onSuccess: () => setD(null) }))} onCancel={() => setD(null)} />
    </div>
  )
}
