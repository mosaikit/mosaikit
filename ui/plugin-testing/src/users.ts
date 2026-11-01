/** The tenant of the developer profile (`docs/architecture.md` §8.12). */
export const DEV_TENANT = 'dev'

/** The password of every test user of the developer profile. */
export const DEV_PASSWORD = 'mosaikit-dev'

export type DevUserName = 'admin' | 'manager' | 'alice' | 'bob'

export interface DevUser {
  username: DevUserName
  /** the role in the tenant (Administrator of the platform, Tenant Manager or User) */
  role: 'Administrator' | 'Tenant Manager' | 'User'
}

/** The four accounts the developer profile makes with the tenant. */
export const DEV_USERS: Record<DevUserName, DevUser> = {
  admin: { username: 'admin', role: 'Administrator' },
  manager: { username: 'manager', role: 'Tenant Manager' },
  alice: { username: 'alice', role: 'User' },
  bob: { username: 'bob', role: 'User' },
}
