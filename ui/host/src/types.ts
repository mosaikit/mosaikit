/** role in the tenant; Administrator belongs to the system (`User.is_system_admin`) */
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
  /** signs in through the identity provider of the home tenant: no local password (recent servers) */
  external?: boolean
  memberships: Membership[]
  invitations: number
  plugin_origin: string
  /** URL of plugin UIs and contents, with the base path */
  plugin_url?: string
  public_origin: string
  dev: boolean
  /** top bar of the shell, decided by the Administrator (recent servers) */
  band?: ShellBand
  /** theme of the platform, chosen by the Administrator (recent servers) */
  theme?: string
  /** settings in use for the home tenant of the person (the platform's for the Administrator) */
  config?: Config
}

/** Values in use of the settings on three levels, by key (`security.password_min`, `lang.enabled`...). */
export type Config = Record<string, unknown>

/** A setting on three levels (docs/refactoring-ui.md §5), as the server describes it. */
export interface Setting {
  key: string
  kind: 'managed' | 'limit' | 'custom'
  /** settings with a limit: how the tenant may only be stricter */
  rule?: 'min' | 'max' | 'subset'
  scope: 'both' | 'platform' | 'tenant'
  /** value of the platform (its own or the default) */
  platform: unknown
  /** value the tenant set (tenant view) */
  tenant?: unknown
  /** value in use */
  value: unknown
  source: 'default' | 'platform' | 'tenant'
  /** tenants may customize it */
  customizable: boolean
  /** the tenant cannot change it */
  locked: boolean
  /** without a value of its own the tenant uses the platform's (false: a default of the tenant) */
  inherits: boolean
}

/** A key of an outside service: never the value, only its last four characters (or the address). */
export interface ServiceKey {
  service: string
  group: 'ai' | 'msg' | 'doc'
  address: boolean
  set: boolean
  hint?: string
  shared: boolean
  updated_at?: string
  in_use: 'own' | 'tenant' | 'platform' | 'none'
}

/** The theme of a tenant: the one of the platform and, if any, the one chosen by the Tenant Manager. */
export interface ThemeChoice {
  platform: string
  tenant: string | null
  /** the one in use */
  preset: string
  /** the Administrator turned off "tenants may customize it" (recent servers) */
  locked?: boolean
}

/** Items of the top bar: when off, they show for nobody. */
export interface ShellBand {
  logo: boolean
  search: boolean
  lang: boolean
  help: boolean
  mode: boolean
}

export interface TenantSettings {
  public_links_enabled: boolean
  public_link_max_days: number
  managers_see_titles: boolean
}

export type PluginKind = 'app' | 'service' | 'extension'

export interface PluginView {
  id: string
  name: string
  version: string
  /** emoji of the manifest, for older hosts */
  icon: string
  /** name of the icon of the shell (Lucide) declared by the manifest (recent servers) */
  icon_name?: string | null
  /** recent servers */
  kind?: PluginKind
  /** for an extension: the plugin it extends (recent servers) */
  extends?: string | null
  label: string
  description: string
  has_ui: boolean
  dev: boolean
  permissions: { hooks: string[]; files: boolean; content: boolean; network: string[]; frame_src: string[]; calls?: string[] }
}

/** A plugin available to a tenant, as its Tenant Manager sees it (or every plugin, for the Administrator). */
export interface TenantPlugin {
  id: string
  label: string
  description: string
  version: string
  kind: PluginKind
  icon: string | null
  has_ui: boolean
  available: boolean
  enabled: boolean
  on: boolean
  off: 'platform' | 'unavailable' | 'turned_off' | 'base' | null
  extends: string | null
  /** recent servers: the name of the plugin it extends */
  extends_label?: string | null
  extensions: string[]
}

/** A tenant in the Tenants tab of a plugin. */
export interface PluginTenant {
  tenant_id: string
  slug: string
  name: string
  status: string
  available: boolean
  own_choice: boolean | null
  enabled: boolean
  on: boolean
}

export interface ConfigDecl {
  key: string
  label: string
  description: string
  kind: 'text' | 'number' | 'bool' | 'choice' | 'secret'
  default?: unknown
  options?: string[]
}

export interface PluginConfig {
  decls: ConfigDecl[]
  values: Record<string, unknown>
  secrets: string[]
}

export interface UninstallImpact {
  items: number
  tenants: number
  extensions: string[]
}

export interface TenantContext {
  tenant: { id: string; slug: string; name: string; role: Role; settings: TenantSettings }
  plugins: PluginView[]
  prefs: { hidden?: string[] }
  /** what the person may do in each plugin: plugin id -> permission keys (recent servers) */
  perms?: Record<string, string[]>
  /** recent servers */
  theme?: ThemeChoice
  /** settings in use in the tenant (recent servers) */
  config?: Config
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
  /** status of the account (active, disabled) */
  status: string
  /** status of the membership (active, suspended) */
  membership: string
  /** permission profile (null: the default one of the tenant) */
  profile_id: string | null
  profile: string
  groups: string[]
  email: string | null
  last_sign_in_at: string | null
  joined_at: string
  owned_resources: number
}

/** A permission of a plugin: standard (enforced by the kernel) or declared by the manifest. */
export interface PermDecl {
  key: string
  label: string
  description: string
  default: boolean
  standard: boolean
}

export interface Profile {
  id: string
  name: string
  description: string
  is_default: boolean
  /** plugin id -> permission keys */
  perms: Record<string, string[]>
  members: number
  created_at: string
}

export interface PluginGrant {
  principal_type: 'user' | 'group'
  principal_id: string
  name: string
  detail: string
  perms: string[]
}

export interface PluginAccess {
  plugin_id: string
  label: string
  icon: string
  permissions: PermDecl[]
  profiles: Profile[]
  grants: PluginGrant[]
}

export interface PermSource {
  key: string
  label: string
  standard: boolean
  granted: boolean
  sources: { kind: 'manager' | 'profile' | 'group' | 'personal'; name: string }[]
}

export interface PluginPerms {
  plugin_id: string
  label: string
  icon: string
  perms: PermSource[]
}

export interface MemberDetail {
  member: Member
  permissions: PluginPerms[]
  home_here: boolean
}

export interface SessionInfo {
  id: string
  created_at: string
  last_seen: string
  expires_at: string
}

export interface EventInfo {
  ts: string
  action: string
  tenant: string | null
  plugin_id: string | null
  resource_id: string | null
  detail: Record<string, unknown>
}

export interface ResetLink {
  url: string
  expires_at: string
  emailed: boolean
}

export interface WhyNot {
  level: string
  title: string
  plugin_id: string
  steps: { code: string; ok: boolean; detail: string }[]
}

export interface GroupDetail {
  id: string
  name: string
  members: { user_id: string; username: string; display_name: string }[]
  shared: { resource_id: string; title: string; plugin_id: string; level: string }[]
  plugins: [string, string[]][]
}

export interface AccessRequest {
  id: string
  resource_id: string
  title: string
  plugin_id: string
  owner_id: string
  owner_name: string
  requester_id: string
  requester_name: string
  requester_username: string
  level: 'read' | 'write'
  message: string
  status: string
  created_at: string
  mine: boolean
}

export interface PersonTenant {
  tenant_id: string
  slug: string
  name: string
  role: Role
  status: string
  profile_id: string | null
  profile: string
  is_home: boolean
}

export interface PersonRow {
  user_id: string
  username: string
  display_name: string
  email: string | null
  home_tenant_id: string
  home_tenant: string
  is_admin: boolean
  status: string
  totp: boolean
  last_sign_in_at: string | null
  created_at: string
  tenants: PersonTenant[]
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
  /** the ones in the trash included (they count toward the quotas until purged) */
  count: number
  bytes: number
  /** of which in the trash (recent servers) */
  trash_count?: number
  trash_bytes?: number
}

export interface PluginKpi {
  plugin_id: string
  plugin: string
  view: string
  label: string
  /** labels of the columns, in the language of the request (missing: the name of the column) */
  columns?: Record<string, string>
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
  /** recent servers */
  requires?: { database: string | null; extensions: string[] }
  user_permissions?: { key: string; label: string; description: string; default: boolean }[]
  min_kernel?: string
  extends_min?: string | null
  extension?: { fields: { resource: string; key: string; label: string; kind: string }[]; actions: { resource: string; key: string; label: string }[] }
  has_config?: boolean
}

export interface CatalogItem {
  id: string
  name: string
  description: string
  icon: string
  latest: string
  installed: string | null
  update_available: boolean
  /** recent servers */
  kind?: PluginKind | null
  extends?: string | null
  notes?: { version: string; notes: string }[]
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

/** overview of the Administrator (`/api/admin/overview`) */
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
  /** second factor registered */
  totp: boolean
  created_at: string
}

/** tenant of the sign-in page */
export interface LoginTenant {
  slug: string
  name: string
  /** sign-in method: username and password, or the identity provider of the tenant (OIDC) */
  auth: 'local' | 'oidc'
  /** text of the button of the identity provider ("" = the default one) */
  button?: string
  /** theme in use for the tenant: its own or the one of the platform (recent servers) */
  theme?: string
  /** identity of the tenant on its sign-in page (recent servers) */
  logo_light?: boolean
  logo_dark?: boolean
  welcome?: string
  footer?: string
  privacy_url?: string
  legal_url?: string
  /** languages of the tenant and the default one ("auto": the one of the browser) */
  languages?: string[]
  language?: string
  /** "remember me" is allowed */
  remember?: boolean
}

/** answer of the administrator sign-in waiting for the second factor */
export interface PendingLogin {
  pending: 'totp' | 'totp_setup'
  csrf: string
}

export interface TotpSetup {
  secret: string
  uri: string
  qr_svg: string
}

/** An item of the trash (`/api/t/<t>/trash`). */
export interface TrashItem {
  id: string
  plugin_id: string
  kind: string
  /** empty when the policy of the tenant hides the titles from the manager */
  title: string
  owner_id: string
  owner_name: string
  deleted_at: string
  deleted_by: string | null
  deleted_by_name: string | null
  size_bytes: number
  purge_at: string
  /** inside another item of the trash: it comes back with that one */
  inside_deleted: boolean
}

export interface TrashList {
  items: TrashItem[]
  retention_days: number
}

/** An event of the Log. */
export interface LogEvent {
  id: number
  ts: string
  tenant_id: string | null
  tenant_slug: string | null
  tenant_name: string | null
  user_id: string | null
  username: string | null
  user_name: string | null
  plugin_id: string | null
  resource_id: string | null
  resource_title: string | null
  action: string
  detail: Record<string, unknown>
  ok: boolean
  ip: string | null
  agent: string | null
}

export interface LogPage {
  events: LogEvent[]
  next: number | null
}

/** An item I shared (Home › Shared by me). */
export interface SharedByMe {
  id: string
  plugin_id: string
  kind: string
  title: string
  with: string[]
  shares: number
  public_links: number
  updated_at: string
}

export interface Revoked {
  shares: number
  links: number
}

/* ── Quotas (docs/architecture.md, "Quotas and usage") ── */

export type QuotaMetric = 'storage' | 'people' | 'items'

/** a limit for each quota; null: no limit */
export interface QuotaLimits {
  storage: number | null
  people: number | null
  items: number | null
}

/** one quota of a tenant: of the platform or of the tenant, with its usage */
export interface QuotaRow {
  metric: QuotaMetric
  /** the quota of the platform for new tenants */
  platform: number | null
  /** the tenant has a quota of its own (set by the Administrator) */
  customized: boolean
  limit: number | null
  used: number
  percent: number | null
  /** days until the limit at the pace of the last 30 days */
  forecast_days: number | null
}

export interface TenantQuotas {
  tenant_id: string
  rows: QuotaRow[]
}

export interface PlatformQuotaRow {
  metric: QuotaMetric
  default: number | null
  capacity: number | null
  given: number
  unlimited: number
  used: number
  over: boolean
}

export interface PlatformQuotas {
  rows: PlatformQuotaRow[]
  tenants: {
    id: string
    slug: string
    name: string
    status: string
    limits: QuotaLimits
    own: QuotaMetric[]
    usage: Record<QuotaMetric, number>
  }[]
}

export interface QuotaDay {
  day: string
  storage: number
  people: number
  items: number
}

export interface QuotaConsumer {
  id: string
  name: string
  items: number
  bytes: number
}

export interface QuotaConsumers {
  people: QuotaConsumer[]
  groups: QuotaConsumer[]
  plugins: QuotaConsumer[]
}

export interface QuotaAlerts {
  at_80: boolean
  at_100: boolean
  forecast: boolean
  managers: boolean
  people: string[]
  groups: string[]
}

export interface MyUsage {
  storage: number
  items: number
  tenant: QuotaRow[]
}
