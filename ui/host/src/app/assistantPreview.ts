// What the assistant wants to do, said in words: the dialog of the platform shows this, not the JSON of the call. The labels come from
// the schema of the tool (the labels of the fields of the resource), so they are in the words of the plugin.

import { t } from './i18n.ts'

export interface PreviewRow {
  label: string
  value: string
  /** a long text: shown in a box of its own */
  long?: boolean
}

export interface Preview {
  /** the app the change is in (`Notes`) */
  app: string
  /** `Create in Notes` */
  title: string
  /** what the tool does, in the words of the plugin */
  lead: string
  rows: PreviewRow[]
}

export interface ToolInfo {
  name: string
  description: string
  input_schema?: { properties?: Record<string, { description?: string; type?: string }> }
}

/** `quick_note` → `Quick note` */
export function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim()
  return s ? s[0]!.toUpperCase() + s.slice(1) : key
}

/** A value for a person: a yes or a no for a flag, a date in their language, a list with commas, a text as it is. */
export function formatValue(v: unknown, lang: string): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? t('Yes') : t('No')
  if (typeof v === 'number') return new Intl.NumberFormat(lang).format(v)
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' })
    }
    return v.trim()
  }
  if (Array.isArray(v)) return v.map((x) => formatValue(x, lang)).filter(Boolean).join(', ')
  return JSON.stringify(v)
}

/** `Title (YYYY-MM-DD)` → `Title`: the format hint of a date is for the model */
const cleanLabel = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim()

export function previewOf(tool: ToolInfo | undefined, name: string, args: unknown, lang: string, appName: string): Preview {
  const obj = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  const props = tool?.input_schema?.properties ?? {}
  // the fields in the order of the schema, then what else the model sent
  const keys = [...Object.keys(props).filter((k) => k in obj), ...Object.keys(obj).filter((k) => !(k in props))]
  const rows: PreviewRow[] = []
  for (const k of keys) {
    const value = formatValue(obj[k], lang)
    if (!value) continue
    // the id of an item to change is for the platform, not for the person
    if (k === 'id') continue
    const label = props[k]?.description ? cleanLabel(props[k]!.description!) : humanize(k)
    rows.push({ label, value, long: value.length > 80 || value.includes('\n') })
  }
  const verb = /create|add|new/.test(name) ? 'create' : /update|edit|change/.test(name) ? 'update' : 'run'
  const title = verb === 'create' ? t('Create in {app}', { app: appName }) : verb === 'update' ? t('Change in {app}', { app: appName }) : t('Run in {app}', { app: appName })
  return { app: appName, title, lead: tool?.description ?? '', rows }
}
