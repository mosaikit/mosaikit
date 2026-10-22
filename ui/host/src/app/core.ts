// Hook comuni della shell: sessione e dati (TanStack Query), modifiche con il loro messaggio.

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError, errText, setCsrf } from '../api.ts'
import type { Session, TenantContext } from '../types.ts'
export { useConfirm } from './confirm.ts'

/** La sessione: `null` se non si e' entrati. */
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const s = await api<Session>('GET', '/api/session')
        setCsrf(s.csrf)
        return s
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    retry: false,
    staleTime: 60_000,
  })
}

export function useSessionValue(): Session {
  const { data } = useSession()
  if (!data) throw new Error('sessione assente')
  return data
}

/** Contesto del tenant attivo: ruolo, plugin attivi, preferenze. */
export function useTenantCtx(slug: string) {
  return useQuery({
    queryKey: ['ctx', slug],
    queryFn: () => api<TenantContext>('GET', `/api/t/${encodeURIComponent(slug)}/context`),
    enabled: !!slug,
  })
}

export function useApi<T>(key: QueryKey, path: string | null) {
  return useQuery({ queryKey: key, queryFn: () => api<T>('GET', path!), enabled: !!path })
}

/** Una modifica: in caso di successo un messaggio e l'aggiornamento delle query indicate. */
export function useAction<A>(fn: (a: A) => Promise<unknown>, o: { ok?: string | ((a: A) => string); invalidate?: QueryKey[] } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (_r, a) => {
      if (o.ok) toast.success(typeof o.ok === 'function' ? o.ok(a) : o.ok)
      o.invalidate?.forEach((k) => void qc.invalidateQueries({ queryKey: k }))
    },
    onError: (e) => toast.error(errText(e)),
  })
}

export function initials(name: string): string {
  return (
    name
      .split(/[\s.@_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0]!.toUpperCase())
      .join('') || '?'
  )
}
