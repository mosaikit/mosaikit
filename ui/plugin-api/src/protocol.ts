// Protocol of the bridge host <-> plugin UIs (postMessage).
//
// plugin -> host: { msk: 1, id, op, args }
// host -> plugin: { msk: 1, id, ok } | { msk: 1, id, err, code?, status?, message? }
// host -> plugin (events): { msk: 1, event, data }

export interface BridgeRequest {
  msk: 1
  id: string
  op: string
  args?: unknown
}

export interface BridgeReply {
  msk: 1
  id: string
  ok?: unknown
  /** the error, in the language of the host */
  err?: string
  /** stable code of the error (`missing_permission`, `quota_exceeded`, `plugin_error`…); hosts before 1.1 omit it */
  code?: string
  /** HTTP status of the request that failed, if it reached the server */
  status?: number
  /** the message of the server, untranslated */
  message?: string
}

export interface BridgeEvent {
  msk: 1
  event: string
  data?: unknown
}

export type FieldKind = 'text' | 'number' | 'bool' | 'date' | 'choice'

export interface FieldDecl {
  key: string
  label: string
  kind: FieldKind
  required?: boolean
  multiline?: boolean
  options?: string[]
  /** labels of the values of a choice field (value -> label), in the language of the host */
  option_labels?: Record<string, string>
  hidden?: boolean
}

export type Level = 'read' | 'write' | 'manage'

export type Values = Record<string, string | number | boolean | null>

export interface Row {
  id: string
  values: Values
  owner_id: string
  owner_name: string
  my_level: Level
  shared: boolean
  parent_id: string | null
  created_at: string
  updated_at: string
}

export interface ListResult {
  resource: string
  fields: FieldDecl[]
  rows: Row[]
  /** with `limit`: the cursor of the next page (none on the last one) */
  next?: string | null
  /** with `limit`: how many rows the filter matches in all */
  total?: number
}

/** An extension of the plugin: the fields, actions and tabs it adds to the items of a resource. */
export interface ExtensionView {
  /** id of the extension (another plugin) */
  id: string
  label: string
  fields: FieldDecl[]
  actions: { key: string; label: string }[]
  /** tabs in the detail of an item (older hosts: absent) */
  tabs?: ExtensionTab[]
}

/** A tab an extension adds to the detail of an item: a page of its UI, shown by the host. */
export interface ExtensionTab {
  key: string
  label: string
  /** name of a Lucide icon */
  icon?: string
  /** page of the UI of the extension */
  page: string
}

/** Where a page of an extension is shown when it is a tab (`msk.tab`). */
export interface TabInfo {
  /** the plugin the extension extends */
  base: string
  resource: string
  /** id of the item */
  item: string
  /** key of the tab */
  key: string
  /** level of the person on the item */
  level: Level
}

/** A rectangle in CSS pixels, relative to the viewport of the page that sends it. */
export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface FileEntry {
  id: string
  name: string
  is_dir: boolean
  size: number
  mime: string
  created: string
  modified: string
  owner_id: string
  owner_name: string
  my_level: Level
  shared: boolean
  parent_id: string | null
}

export interface Listing {
  parent: string | null
  path: { id: string; name: string }[]
  entries: FileEntry[]
  my_level: Level
}

export interface SiteInfo {
  files: number
  size: number
  entry: string
}

/** Language, theme and mode of the host: they arrive with the handshake and, at every change, with the `context` event. */
export interface UiContext {
  /** language of the interface (`it`, `en`…) */
  lang: string
  /** preset of the theme of the host (`mosaikit`, `italia`…) */
  preset: string
  /** actual mode */
  mode: 'light' | 'dark'
  /** the choice of the person: with `auto` the mode follows the system */
  preference: 'light' | 'dark' | 'auto'
  /** high contrast chosen by the person (older hosts: absent); the theme variables already have it */
  contrast?: boolean
  /** CSS variables of the theme */
  theme: Record<string, string>
}

export interface Hello {
  public: boolean
  user?: { id: string; username: string; name: string }
  tenant?: { slug: string; name: string; role: 'manager' | 'member' }
  plugin?: { id: string; version: string }
  theme?: Record<string, string>
  /** recent hosts: language, theme and mode (older hosts send only `theme`) */
  context?: UiContext
  /** the place inside the plugin the page was opened at (from a notification: `Notify.at`) */
  at?: string
  /** recent hosts: the permissions of the person in the plugin (`use`, `create`, `delete`, `share` and the
   *  `[[user_permissions]]` of the manifest); the kernel enforces the standard ones, the plugin its own */
  perms?: string[]
  /** only in public links: the shared resource */
  resource?: PublicResource
  /** only in the tab of an extension: the item it is shown for */
  tab?: TabInfo
}

/** A notification of the plugin (`msk.notify`). */
export interface Notify {
  /** plain text, at most 160 characters */
  title: string
  /** plain text, at most 600 characters */
  body?: string
  /** a place inside the plugin, given back as `msk.at` when the notification is opened (letters, digits
   *  and `/ _ - . = & ? % :`, at most 200 characters) */
  at?: string
  /** an item of the plugin, on which the person can write: the notification goes to the people who can
   *  see it (not to the sender). Without it, only to the person using the plugin. */
  resource?: string
}

export interface PublicResource {
  plugin: string
  plugin_label: string
  id: string
  kind: string
  title: string
  values: Values | null
}

export function isReply(d: unknown): d is BridgeReply {
  return !!d && typeof d === 'object' && (d as BridgeReply).msk === 1 && typeof (d as BridgeReply).id === 'string'
}

export function isEvent(d: unknown): d is BridgeEvent {
  return !!d && typeof d === 'object' && (d as BridgeEvent).msk === 1 && typeof (d as BridgeEvent).event === 'string'
}
