// Navigation with the hash: it works under a base path too.
//   sign-in:        #/  ·  #/login/<tenant>  ·  #/admin  ·  #/reset/<token> (a new password, from a link)
//   administrator:  #/admin  ·  #/admin/tenants[/<id>[/<tab>]]  ·  #/admin/people  ·  #/admin/person/<id>[/<tab>]  ·
//                   #/admin/plugins[/<filter>]  ·  #/admin/plugin/<id>[/<tab>]  ·  #/admin/system[/<section>]  ·  #/admin/account[/<section>]  ·
//                   #/admin/monitoring[/<section>]  ·  #/admin/notifications  ·  #/admin/log
//   tenant:         #/t/<tenant>  ·  #/t/<tenant>/p/<plugin>[/<place>]  ·  #/t/<tenant>/manage[/<section>]  ·
//                   #/t/<tenant>/person/<id>[/<tab>]  ·  #/t/<tenant>/group/<id>[/<tab>]  ·
//                   #/t/<tenant>/plugins[/<plugin>]  ·  #/t/<tenant>/shares  ·  #/t/<tenant>/usage  ·
//                   #/t/<tenant>/settings[/<section>]  ·  #/t/<tenant>/account[/<section>]  ·  #/t/<tenant>/notifications  ·
//                   #/t/<tenant>/requests  ·  #/t/<tenant>/item/<id> (an item, or the request to see it)  ·
//                   #/t/<tenant>/trash  ·  #/t/<tenant>/log
// The old routes (#/admin/settings/…, #/t/<tenant>/settings/appearance|account) lead to the new home.

import { useSyncExternalStore } from 'react'

export type AdminPage = 'overview' | 'tenants' | 'people' | 'plugins' | 'monitoring' | 'system' | 'account' | 'notifications' | 'log'
export type TenantPage = 'home' | 'manage' | 'plugins' | 'shares' | 'usage' | 'settings' | 'account' | 'notifications' | 'requests' | 'trash' | 'log'

export type Route =
  | { area: 'admin'; page: AdminPage | 'tenant' | 'person' | 'plugin'; id?: string; section?: string }
  | { area: 'tenant'; tenant: string; page: TenantPage | 'plugin' | 'person' | 'group' | 'item'; id?: string; section?: string }
  | { area: 'login'; door: 'tenant' | 'admin'; tenant?: string }
  | { area: 'reset'; token: string }

const ADMIN_PAGES: AdminPage[] = ['tenants', 'people', 'plugins', 'monitoring', 'system', 'account', 'notifications', 'log']
const TENANT_PAGES: TenantPage[] = ['manage', 'plugins', 'shares', 'usage', 'settings', 'account', 'notifications', 'requests', 'trash', 'log']

export function parse(hash: string): Route {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (p[0] === 'admin') {
    if (p[1] === 'tenants' && p[2]) return { area: 'admin', page: 'tenant', id: p[2], section: p[3] }
    if (p[1] === 'person' && p[2]) return { area: 'admin', page: 'person', id: p[2], section: p[3] }
    if (p[1] === 'plugin' && p[2]) return { area: 'admin', page: 'plugin', id: p[2], section: p[3] }
    // before: Settings with administrators, appearance and account
    if (p[1] === 'settings') return p[2] === 'appearance' || p[2] === 'account' ? { area: 'admin', page: 'account', section: p[2] === 'account' ? 'security' : 'appearance' } : { area: 'admin', page: 'system', section: 'admins' }
    const page = ADMIN_PAGES.find((x) => x === p[1])
    return page ? { area: 'admin', page, section: p[2] } : { area: 'admin', page: 'overview' }
  }
  if (p[0] === 't' && p[1]) {
    const tenant = p[1]
    // the place inside the plugin (from a notification) is given to its page
    if (p[2] === 'p' && p[3]) return { area: 'tenant', tenant, page: 'plugin', id: p[3], section: p[4] }
    if ((p[2] === 'person' || p[2] === 'group' || p[2] === 'item') && p[3]) return { area: 'tenant', tenant, page: p[2], id: p[3], section: p[4] }
    if (p[2] === 'settings' && (p[3] === 'appearance' || p[3] === 'account')) return { area: 'tenant', tenant, page: 'account', section: p[3] === 'account' ? 'security' : 'appearance' }
    if (p[2] === 'manage' && p[3] === 'invitations') return { area: 'tenant', tenant, page: 'manage', section: 'pending' }
    const page = TENANT_PAGES.find((x) => x === p[2])
    return page ? { area: 'tenant', tenant, page, section: p[3] } : { area: 'tenant', tenant, page: 'home' }
  }
  if (p[0] === 'login') return { area: 'login', door: 'tenant', tenant: p[1] }
  if (p[0] === 'reset' && p[1]) return { area: 'reset', token: p[1] }
  return { area: 'login', door: 'tenant' }
}

const enc = encodeURIComponent
const sub = (s?: string) => (s ? '/' + enc(s) : '')
export const to = {
  admin: (page: AdminPage = 'overview', section?: string) => (page === 'overview' ? '#/admin' : `#/admin/${page}${sub(section)}`),
  adminTenant: (id: string, section?: string) => `#/admin/tenants/${enc(id)}${sub(section)}`,
  tenant: (slug: string, page: TenantPage = 'home', section?: string) => `#/t/${enc(slug)}${page === 'home' ? '' : '/' + page}${sub(section)}`,
  plugin: (slug: string, id: string, at?: string) => `#/t/${enc(slug)}/p/${enc(id)}${sub(at)}`,
  person: (slug: string, id: string, tab?: string) => `#/t/${enc(slug)}/person/${enc(id)}${sub(tab)}`,
  group: (slug: string, id: string, tab?: string) => `#/t/${enc(slug)}/group/${enc(id)}${sub(tab)}`,
  item: (slug: string, id: string) => `#/t/${enc(slug)}/item/${enc(id)}`,
  adminPerson: (id: string, tab?: string) => `#/admin/person/${enc(id)}${sub(tab)}`,
  adminPlugin: (id: string, tab?: string) => `#/admin/plugin/${enc(id)}${sub(tab)}`,
}

/** The address of a route: to rewrite the old ones. */
export function href(r: Route): string {
  if (r.area === 'admin') {
    if (r.page === 'tenant') return to.adminTenant(r.id!, r.section)
    if (r.page === 'person') return to.adminPerson(r.id!, r.section)
    if (r.page === 'plugin') return to.adminPlugin(r.id!, r.section)
    return to.admin(r.page, r.section)
  }
  if (r.area === 'tenant') {
    if (r.page === 'plugin') return to.plugin(r.tenant, r.id!, r.section)
    if (r.page === 'person') return to.person(r.tenant, r.id!, r.section)
    if (r.page === 'group') return to.group(r.tenant, r.id!, r.section)
    if (r.page === 'item') return to.item(r.tenant, r.id!)
    return to.tenant(r.tenant, r.page, r.section)
  }
  if (r.area === 'reset') return `#/reset/${enc(r.token)}`
  return r.door === 'admin' ? '#/admin' : r.tenant ? `#/login/${enc(r.tenant)}` : '#/'
}

/** Pages of the personal area (Account, Notifications), with the same address in both scopes. */
export function personal(r: Route, page: 'account' | 'notifications', section?: string): string {
  return r.area === 'tenant' ? to.tenant(r.tenant, page, section) : to.admin(page, section)
}

export function go(hash: string) {
  if (window.location.hash !== hash) window.location.hash = hash
}

let hash = window.location.hash
const listeners = new Set<() => void>()
window.addEventListener('hashchange', () => {
  hash = window.location.hash
  listeners.forEach((l) => l())
})

export function useHash(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => hash,
  )
}
