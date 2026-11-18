// Search of the people and groups of a tenant, shared by the share dialog and the picker of people.

import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import type { Principal } from '../types.ts'
import { t } from './i18n.ts'

const enc = encodeURIComponent

/** People and groups of the tenant matching the search. */
/** The name and detail of a person or group in the dialog: «All members» has its own, translated. */
export function shown(p: { name: string; detail: string; builtin?: 'all' }): { name: string; detail: string } {
  return p.builtin ? { name: t('All members'), detail: t('Every member of the organization') } : { name: p.name, detail: p.detail }
}

export function useDirectory(slug: string, q: string) {
  const [found, setFound] = useState<Principal[]>([])
  useEffect(() => {
    const s = q.trim()
    if (!s) {
      setFound([])
      return
    }
    const h = setTimeout(() => {
      api<Principal[]>('GET', `/api/t/${enc(slug)}/directory?q=${enc(s)}`)
        .then(setFound)
        .catch(() => setFound([]))
    }, 200)
    return () => clearTimeout(h)
  }, [q, slug])
  return found
}
