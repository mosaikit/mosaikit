import type { Role } from './types.ts'

/**
 * I tre ruoli di Mosaikit: Administrator (di sistema, `is_system_admin`),
 * Tenant Manager e User (per tenant).
 */
export const ROLE_LABEL: Record<Role, string> = {
  tenant_manager: 'Tenant Manager',
  user: 'User',
}

export const ADMINISTRATOR = 'Administrator'

export function roleLabel(role: Role | undefined): string {
  return role ? ROLE_LABEL[role] : ''
}
