// How the people of a tenant sign in (local accounts or the identity provider of the tenant), from the
// public data of the sign-in page.

import type { LoginTenant } from '../types.ts'
import { useApi } from './core.ts'

export function useTenantSignIn(slug: string): 'local' | 'oidc' {
  const q = useApi<LoginTenant[]>(['login-tenants'], '/api/auth/tenants')
  return q.data?.find((x) => x.slug === slug)?.auth ?? 'local'
}
