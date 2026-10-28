// The settings on three levels as the pages change them: what is in use, the changes not saved yet
// (values, null = back to the platform or to the default, and the switches «tenants may customize it").

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, errText } from '../api.ts'
import { reloadBrand } from '../brand.ts'
import type { Setting } from '../types.ts'
import { useApi } from './core.ts'
import { t } from './i18n.ts'

const enc = encodeURIComponent

/** Where the settings are changed: the platform (Administrator) or a tenant (Tenant Manager). */
export type Level = { kind: 'platform' } | { kind: 'tenant'; slug: string }

const path = (l: Level) => (l.kind === 'platform' ? '/api/admin/settings' : `/api/t/${enc(l.slug)}/manage/config`)
export const queryKey = (l: Level) => ['levels', l.kind === 'platform' ? '' : l.slug]

export function useLevelSettings(l: Level) {
  return useApi<Setting[]>(queryKey(l), path(l))
}

/** Changes not saved yet: values (null = back to the platform, or to the default) and switches. */
export function useDraft(l: Level, list: Setting[] | undefined) {
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
        // the layout in use comes from these: the shell redraws at once, without a reload
        void qc.invalidateQueries({ queryKey: ['layouts'] })
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

export type Draft = ReturnType<typeof useDraft>
