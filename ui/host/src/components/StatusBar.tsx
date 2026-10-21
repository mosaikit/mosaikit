import { useBrand } from '../brand.ts'
import { ADMINISTRATOR, roleLabel } from '../roles.ts'
import type { Membership, User } from '../types.ts'

interface Props {
  user: User
  memberships: Membership[]
  tenant: string
  onTenant: (slug: string) => void
  onLogout: () => void
  dev: boolean
}

export default function StatusBar({ user, memberships, tenant, onTenant, onLogout, dev }: Props) {
  const current = memberships.find((m) => m.slug === tenant)
  const brand = useBrand()
  return (
    <footer className="statusbar">
      <span className="st-user">
        ● {user.display_name || user.username}{' '}
        <span className="muted">{user.is_system_admin ? user.username : `${user.username}@${user.home_tenant_slug}`}</span>
      </span>
      {memberships.length > 0 && (
        <label className="st-tenant">
          <span className="muted">tenant </span>
          <select value={tenant} onChange={(e) => onTenant(e.target.value)} aria-label="Tenant attivo">
            {memberships.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name} ({m.slug}){m.is_home ? '' : ' · ospite'}
              </option>
            ))}
          </select>
        </label>
      )}
      {current && <span className="st-role">{roleLabel(current.role)}</span>}
      {user.is_system_admin && <span className="badge acc">{ADMINISTRATOR}</span>}
      {dev && <span className="badge acc">sviluppo</span>}
      <span className="st-msg" />
      <span className="muted st-product">
        {brand.name} {brand.version}
      </span>
      <button type="button" className="btn ghost small" onClick={onLogout}>
        Esci
      </button>
    </footer>
  )
}
