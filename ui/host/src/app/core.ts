// Common hooks of the shell: session and data (TanStack Query), changes with their message.

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError, errText, isUnavailable, setCsrf } from '../api.ts'
import { retryDelay } from '../brand.ts'
import type { Config, Session, TenantContext } from '../types.ts'
export { useConfirm } from './confirm.ts'

/** The session: `null` if nobody signed in. */
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const s = await api<Session>('GET', '/api/session')
        setCsrf(s.csrf)
        return s
      } catch (e) {
        // signed out, or only the Administrators work (maintenance): the sign-in page with the notice
        if (e instanceof ApiError && (e.status === 401 || e.code === 'maintenance')) return null
        throw e
      }
    },
    // while the server does not answer (restarting, unreachable) the session is asked again
    retry: (_n, e) => isUnavailable(e),
    retryDelay,
    staleTime: 60_000,
  })
}

export function useSessionValue(): Session {
  const { data } = useSession()
  if (!data) throw new Error('sessione assente')
  return data
}

/** Context of the active tenant: role, active plugins, preferences. */
export function useTenantCtx(slug: string) {
  return useQuery({
    queryKey: ['ctx', slug],
    queryFn: () => api<TenantContext>('GET', `/api/t/${encodeURIComponent(slug)}/context`),
    enabled: !!slug,
  })
}

/** The settings in use where one is: the tenant of the address, otherwise the home tenant of the person
 *  (the platform's for the Administrator). */
export function useConfig(slug?: string): Config {
  const s = useSession().data
  const ctx = useTenantCtx(slug ?? '')
  return (slug ? ctx.data?.config : undefined) ?? s?.config ?? {}
}

/** The minimum length of passwords in use (for the hints next to the fields). */
export function passwordMin(c: Config): number {
  const n = Number(c['security.password_min'])
  return Number.isFinite(n) && n >= 10 ? n : 10
}

export function useApi<T>(key: QueryKey, path: string | null) {
  return useQuery({ queryKey: key, queryFn: () => api<T>('GET', path!), enabled: !!path })
}

/** A change: on success a message and the refresh of the given queries. */
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
