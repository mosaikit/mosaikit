/** ruolo nel tenant; Administrator e' di sistema (`User.is_system_admin`) */
export type Role = 'tenant_manager' | 'user'
export type Level = 'read' | 'write' | 'manage'

export interface User {
  user_id: string
  username: string
  display_name: string
  home_tenant_id: string
  home_tenant_slug: string
  is_system_admin: boolean
}

export interface Membership {
  tenant_id: string
  slug: string
  name: string
  role: Role
  is_home: boolean
  is_system: boolean
}

export interface Session {
  user: User
  csrf: string
  memberships: Membership[]
  invitations: number
  plugin_origin: string
  /** URL di UI dei plugin e contenuti, con il percorso base */
  plugin_url?: string
  public_origin: string
  dev: boolean
}

export interface TenantSettings {
  public_links_enabled: boolean
  public_link_max_days: number
  managers_see_titles: boolean
}

export interface PluginView {
  id: string
  name: string
  version: string
  icon: string
  label: string
  description: string
  has_ui: boolean
  dev: boolean
  permissions: { hooks: string[]; files: boolean; content: boolean; network: string[]; frame_src: string[] }
}

export interface TenantContext {
  tenant: { id: string; slug: string; name: string; role: Role; settings: TenantSettings }
  plugins: PluginView[]
  prefs: { hidden?: string[] }
}

export interface Principal {
  kind: 'user' | 'group'
  id: string
  name: string
  detail: string
}

export interface Grant {
  principal_type: 'user' | 'group'
  principal_id: string
  name: string
  detail: string
  level: Level
  granted_at: string
}

export interface ResourceMeta {
  id: string
  plugin_id: string
  kind: string
  title: string
  owner_id: string
  owner_name: string
  size_bytes: number
  my_level: Level | 'none'
  is_owner: boolean
  created_at: string
  updated_at: string
}

export interface LinkInfo {
  id: string
  created_at: string
  expires_at: string | null
  has_password: boolean
  view_count: number
  created_by: string | null
  active: boolean
  url?: string
}

export interface Member {
  user_id: string
  username: string
  display_name: string
  home_tenant: string
  is_guest: boolean
  role: Role
  status: string
  joined_at: string
  owned_resources: number
}

export interface Invitation {
  id: string
  tenant_slug: string
  tenant_name: string
  user_id: string
  user: string
  role: Role
  status: string
  invited_by: string | null
  created_at: string
  expires_at: string
}

export interface Group {
  id: string
  name: string
  members: { user_id: string; username: string; display_name: string }[]
}

export interface ResourceRow {
  id: string
  plugin_id: string
  kind: string
  title: string
  owner_id: string
  owner_name: string
  owner_active: boolean
  size_bytes: number
  created_at: string
  updated_at: string
  shares: number
  public_links: number
}

export interface TenantInfo {
  id: string
  slug: string
  name: string
  status: 'active' | 'suspended'
  is_system: boolean
  members: number
  guests: number
  resources: number
  bytes: number
  created_at: string
  active_users_30d?: number
  shares?: number
  public_links?: number
}

export interface ResourceStat {
  plugin_id: string
  plugin: string
  kind: string
  count: number
  bytes: number
}

export interface PluginKpi {
  plugin_id: string
  plugin: string
  view: string
  label: string
  rows: Record<string, unknown>[]
}

export interface TenantKpi {
  tenant: string
  core: {
    members: number
    guests: number
    groups: number
    resources: ResourceStat[]
    shares: number
    public_links: number
    link_views: number
    active_users_30d: number
    activity: { day: string; events: number; users: number }[]
  }
  plugins: PluginKpi[]
}

export interface GlobalKpi {
  tenants: TenantInfo[]
  resources: ResourceStat[]
  plugins: PluginKpi[]
}

export interface AdminPlugin extends PluginView {
  status: 'installed' | 'active' | 'blocked'
  sha256: string
  signed_by: string | null
  installed_at: string
  has_logic: boolean
  kpi: { view: string; label: string }[]
}

export interface CatalogItem {
  id: string
  name: string
  description: string
  icon: string
  latest: string
  installed: string | null
  update_available: boolean
}

export interface Overview {
  role: Role
  me: {
    resources: ResourceStat[]
    shared_by_me: number
    shared_with_me: number
    public_links: number
    link_views: number
    recent_shares: { resource_id: string; plugin_id: string; plugin: string; title: string; owner: string; level: Level; granted_at: string }[]
    activity: { ts: string; action: string; plugin_id: string | null; plugin: string | null; title: string | null }[]
  }
  tenant?: TenantKpi['core']
}

/** panoramica dell'Administrator (`/api/admin/overview`) */
export interface SystemOverview {
  tenants: number
  active_tenants: number
  users: number
  administrators: number
  resources: number
  bytes: number
  plugins_installed: number
  plugins_active: number
  active_users_30d: number
}

export interface AdminUser {
  user_id: string
  username: string
  display_name: string
  status: string
  /** secondo fattore registrato */
  totp: boolean
  created_at: string
}

/** tenant della pagina di accesso */
export interface LoginTenant {
  slug: string
  name: string
  auth: 'local'
}

/** risposta dell'accesso amministratori in attesa del secondo fattore */
export interface PendingLogin {
  pending: 'totp' | 'totp_setup'
  csrf: string
}

export interface TotpSetup {
  secret: string
  uri: string
  qr_svg: string
}
