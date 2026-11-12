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
  /** stable code of the error, see `ErrorCode`; hosts before 1.1 omit it */
  code?: ErrorCode
  /** HTTP status of the request that failed, if it reached the server */
  status?: number
  /** the message of the server, untranslated */
  message?: string
}

/**
 * Codes of the errors a plugin UI meets, in `BridgeReply.code` and `BridgeError.code`. Switch on them, never on
 * the text. The first group comes from the host and the kernel; `plugin_error` marks an error raised by the
 * logic of the plugin, and when the logic gave it a code of its own (`Error::coded` in the Rust SDK) that code
 * arrives instead, hence the open end of the type.
 */
export type ErrorCode =
  // the category of the error, when it has no code of its own
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'too_many'
  | 'internal'
  // the plugin and the person
  | 'missing_permission'
  | 'plugin_off'
  | 'base_off'
  | 'plugin_unavailable'
  | 'plugin_error'
  // limits
  | 'quota_exceeded'
  | 'content_too_large'
  | 'too_many_rows'
  | 'too_many_notifications'
  // public links
  | 'command_not_public'
  | 'public_commands_off'
  | 'public_rate_limited'
  | 'args_too_large'
  // the list and the items
  | 'sort_unknown'
  | 'item_exists'
  // the web (permission `web`)
  | 'web_blocked'
  | 'web_unreachable'
  | 'web_url'
  // the platform and the connection
  | 'maintenance'
  | 'server_unavailable'
  | 'unexpected'
  // the handshake
  | 'incompatible_api'
  // a code chosen by the logic of the plugin
  | (string & {})

export interface BridgeEvent {
  msk: 1
  event: string
  data?: unknown
}

/**
 * The events the host sends to a plugin UI, with what each carries. A plugin listens with `msk.onContext`
 * or `msk.onEvent`.
 *
 * | event | data | |
 * |---|---|---|
 * | `context` | `UiContext` | language, theme and mode changed (also at the handshake, in `Hello.context`) |
 * | `theme` | CSS variables | **deprecated**, replaced by `context`; still sent in API 1, removed in API 2 |
 * | `ext.changed` | `{ extension, id }` | an extension changed its values on an item (the base plugin reloads them) |
 * | `ext.tab.height` | `{ handle, height }` | the tab of an extension asks for a height (handled by `msk.extensions().mountTab`) |
 * | `band.mode` | `{ value }` | the View \| Edit switch of the top band was flipped (handled by `msk.band`) |
 * | `band.comments` | `{}` | the comments button of the top band was pressed (handled by `msk.band`) |
 * | `band.back` | `{}` | the back button of the top band was pressed (handled by `msk.band`) |
 * | `nav.reselect` | `{}` | the person clicked again, in the sidebar, the entry of the page that is open and the page has no back button in the band (see `msk.onNavReselect`) |
 */
export interface HostEvents {
  context: UiContext
  /** @deprecated use `context` */
  theme: Record<string, string>
  'ext.changed': { extension: string; id: string }
  'ext.tab.height': { handle: string; height: number }
  /** the person flipped the View | Edit switch of the top band (see `msk.band`) */
  'band.mode': { value: 'view' | 'edit' }
  /** the entry of the open page was clicked again in the sidebar (see `msk.onNavReselect`) */
  'nav.reselect': Record<string, never>
  /** the person pressed the comments button of the top band (see `msk.band`) */
  'band.comments': Record<string, never>
  /** the person pressed the back button of the top band (see `msk.band`) */
  'band.back': Record<string, never>
  /** something happened on a real-time channel the plugin opened (see `msk.realtime`) */
  'rt.event': RealtimeEvent
}

/** A person on a real-time channel. `state` is what they last set with `setState` (typing, cursor, muted…). */
export interface RealtimePerson {
  id: string
  name: string
  state?: unknown
}

/** A message of a real-time channel: `from` is set by the kernel, never by the sender. */
export interface RealtimeMessage {
  seq: number
  from: RealtimePerson
  data: unknown
}

/** `connecting` before the first answer, `live`, `reconnecting` after the connection broke (the browser retries and the channel
 *  catches up), `gap` when messages were lost and the plugin must reload what it needs from its own data, `closed` when the person
 *  may no longer listen (logged out, access removed). */
export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'gap' | 'closed'

/** What the host sends for a channel: the page of the plugin hears it through `msk.realtime`. */
export interface RealtimeEvent {
  handle: string
  type: 'presence' | 'message' | 'join' | 'leave' | 'state' | 'status'
  data: unknown
}

export type HostEventName = keyof HostEvents

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

/** What the host found out about a web page (`msk.web.probe`, permission `web`). */
export interface WebProbe {
  /** the address after the redirects */
  url: string
  /** the site accepts being shown in a frame */
  embeddable: boolean
  /** why not: `x_frame_options`, `frame_ancestors` or `unavailable` */
  reason: string | null
  title: string
  /** the picture of the page as a `data:` address (only with `image: true`, if there is one) */
  image: string | null
}

/** How far an upload in pieces has got (`files.uploadLarge`). */
export interface UploadProgress {
  id: string
  received: number
  size: number
}

/** What `msk.files.ticket` answers: the address and how long it works. */
export interface FileTicket {
  url: string
  /** seconds; the address stops working after that (8 hours today: do not rely on the number, read it) */
  expires_in: number
}

/** What `msk.files.info` answers about a file or folder. */
export interface FileInfo {
  id: string
  is_dir: boolean
  /** bytes: the file, or every file under the folder that the person can see */
  size: number
  /** the person manages the entry: she can see its public link and make one in Files */
  can_share: boolean
  /**
   * The active public link, when there is one and `can_share`. The address is not given: the server keeps only a hash of
   * the token, so the address is shown once, when the link is made.
   */
  public_link: { id: string; created_at: string; expires_at: string | null; has_password: boolean; view_count: number; created_by: string | null; active: boolean } | null
}

/** A plugin that could take a folder further (`[[folder_profiles]]` in its manifest). */
export interface FolderSuggestion {
  /** the plugin and its name */
  plugin: string
  plugin_label: string
  /** the kind of folder (id and English label) */
  profile: string
  label: string
  /** the label in other languages, by language (`it`...); absent ones fall back to `label` */
  labels?: Record<string, string>
  /** the folder that holds the marker file (the one asked about, or the only folder inside it) */
  folder: string
  marker: string
  /** the place inside the plugin the page opens at (`msk.at`) */
  at: string
}

/** What unpacking a zip made (`files.unzip`). */
export interface Unzipped {
  /** plugins that could take the folder further; the person was also told in the bell */
  suggestions: FolderSuggestion[]
  /** the folder made for the content, when one was asked for */
  folder: FileEntry | null
  files: number
  folders: number
  skipped: number
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
  /** the texts of the page of this plugin in `lang`, when a language plugin brings them (`lang/ui/<plugin id>.json`:
   *  English phrase to translation); read them with `msk.t`. Absent for `en`, `it` and older hosts */
  texts?: Record<string, string>
  /** CSS variables of the theme */
  theme: Record<string, string>
}

export interface Hello {
  /** the plugin API the host speaks (see `API_VERSION`); hosts before the handshake omit it and speak API 1 */
  api?: number
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

/** Metadata of an item (`msk.resource`). */
export interface ResourceMeta {
  id: string
  plugin_id: string
  kind: string
  title: string
  parent_id: string | null
  owner_id: string
  owner_name: string
  size_bytes: number
  /** what the plugin keeps in the item besides its fields */
  meta: unknown
  created_at: string
  updated_at: string
  my_level: Level
  is_owner: boolean
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

/** What `msk.directory.search` asks: people or groups of the tenant whose name contains `q`. */
export interface DirectorySearch {
  kind: 'user' | 'group'
  /** 1 to 64 characters, matched case-insensitively inside the username and name */
  q: string
  /** 20 by default, at most 50 */
  limit?: number
}

/** A person found by `msk.directory.search`: nothing else of them is given (no email). */
export interface DirectoryUser {
  id: string
  username: string
  name: string
}

/** A group found by `msk.directory.search`. */
export interface DirectoryGroup {
  id: string
  name: string
}

export interface DirectoryApi {
  search(s: DirectorySearch & { kind: 'user' }): Promise<DirectoryUser[]>
  search(s: DirectorySearch & { kind: 'group' }): Promise<DirectoryGroup[]>
}

/** A schedule of the plugin (`msk.schedules`): the JSON of `GET /api/t/{t}/schedules`. `args` and `resources` are given to the author only. */
export interface Schedule {
  id: string
  plugin: string
  name: string
  label: string
  author: string
  author_name: string
  cron: string
  time_zone: string
  catch_up_once: boolean
  status: 'active' | 'paused'
  paused_reason: string | null
  /** UTC */
  next_run_at: string | null
  /** UTC */
  last_run_at: string | null
  last_status: string | null
  created_at: string
  mine: boolean
  args?: Record<string, unknown>
  resources?: string[]
}

export interface ScheduleRun {
  id: string
  status: string
  started_by: string
  started_at: string
  finished_at: string | null
  deadline_at: string
  error: string | null
  service_run_id: string | null
}

export interface ScheduleCreate {
  /** a `[[schedules]] name` of the plugin */
  name: string
  /** five fields, in the time zone of the schedule */
  cron: string
  /** IANA name; none: the time zone of the tenant */
  time_zone?: string
  catch_up_once?: boolean
  args?: Record<string, unknown>
  /** resources the job is limited to; none: the rights of the author */
  resources?: string[]
  label?: string
}

export interface SchedulePatch {
  label?: string
  cron?: string
  time_zone?: string
  catch_up_once?: boolean
  args?: Record<string, unknown>
  resources?: string[]
  /** `false` pauses, `true` resumes */
  enabled?: boolean
}

/**
 * The schedules of this plugin. The shell runs each call with the session of the person and forces the plugin to the
 * one of the page, so a page reaches its own schedules only (the id of another plugin is `not_found`). The
 * rules and the error codes are those of the REST API (`bad_cron`, `interval_too_short`, `bad_time_zone`, `author_only`...).
 * The plugin declares `[[schedules]]` in its manifest.
 */
export interface SchedulesApi {
  /** The own schedules of the person for this plugin; a Tenant Manager sees every one of the tenant. With `resource`, only those limited to it. */
  list(opts?: { resource?: string }): Promise<Schedule[]>
  create(s: ScheduleCreate): Promise<{ id: string; next_run_at: string }>
  update(id: string, patch: SchedulePatch): Promise<Schedule>
  pause(id: string): Promise<void>
  resume(id: string): Promise<void>
  remove(id: string): Promise<void>
  run(id: string): Promise<ScheduleRun>
  runs(id: string): Promise<ScheduleRun[]>
  /** The time zone of the tenant (IANA name, `UTC` when it sets none): propose it as the default of a new schedule. */
  timezone(): Promise<string>
}

/** What `msk.embeds.url` answers: where to open the frame of the embedded page. */
export interface EmbedUrl {
  /** the address of the page on the origin of its plugin, with a ticket for the resource */
  url: string
  /** UTC: when the ticket stops working; ask again a few minutes before */
  expires_at: string
  /** the contract of the messages declared by the embed (for example `geo-embed/1`) */
  contract: string
  resource: string
  /**
   * What to put, exactly, in the `sandbox` attribute of the iframe: `"allow-scripts"`, or `"allow-scripts allow-same-origin"` for
   * an embed whose plugin declared `same_origin = true` (the frame then has the origin of that plugin). The kernel serves the page
   * with the same value as a CSP `sandbox`, so adding more gets nothing. Absent on servers older than this field: use `"allow-scripts"`.
   */
  sandbox?: string
}

export interface EmbedsApi {
  /**
   * The address of a page of another plugin (`[[embeds]]` in its manifest) that shows `resource`, for a frame of your page.
   * Needs the plugin in `[permissions] embeds` and `[requires] mosaikit = ">=1.0"`. The person must use that plugin and see
   * the resource; the page gets a ticket for that resource only, with the rights of the person. Open it in an iframe with
   * the `sandbox` of the answer (`"allow-scripts"` by default) and talk to it over `postMessage` under the contract of the embed, checking `event.source`.
   * Errors: `permission_denied`, `not_found`.
   */
  url(a: { plugin: string; name: string; resource: string }): Promise<EmbedUrl>
}

/** The View | Edit switch of the contextual top band. */
export interface BandMode {
  value: 'view' | 'edit'
  /** false: the shell shows a "Read only" label instead of the switch */
  canEdit: boolean
  /** called when the person flips the switch; set `value` again with `msk.band.set` to follow it */
  onChange?: (value: 'view' | 'edit') => void
}

/** A person connected to the resource (data only: the kernel has no real-time service). */
export interface BandPerson {
  id: string
  /** at most 80 characters, shown as plain text in the tooltip */
  name: string
  /** at most 3 characters; derived from the name when missing */
  initials?: string
}

/** The comments button of the contextual top band. */
export interface BandComments {
  /**
   * The id of the resource the page shows: the shell then keeps the comments itself (the panel, the number in the
   * badge, the thread of the resource in the platform) and the page writes no code for them. `open`, `count` and
   * `onToggle` are not needed.
   */
  resource?: string
  /** the panel is open: the button shows it pressed (not needed with `resource`) */
  open?: boolean
  /** a badge with the number of comments, an integer 0 to 9999 */
  count?: number
  /** called when the person presses the button */
  onToggle?: () => void
}

/** The back button of the contextual top band: an arrow-left icon at the left, right after the tenant. */
export interface BandBack {
  /** plain text, at most 80 characters: the accessible name and the tooltip of the button */
  label: string
  /** called when the person presses the button */
  onClick?: () => void
}

/**
 * The state of the top band while a full-page resource (a map, a dashboard, a process) is open. What the
 * plugin leaves out stays as the shell draws it; the controls of the shell itself (tenant, language, theme,
 * help, notifications, the person) are never affected.
 */
export interface BandState {
  /** `false` hides the search bar of the band (default: unchanged) */
  search?: boolean
  mode?: BandMode
  /** the people connected to the resource: at most 50, the shell shows 3 and "+N" */
  presence?: BandPerson[]
  comments?: BandComments
  /** a back button next to the tenant (for example, back to the list of the plugin) */
  back?: BandBack
}

export interface BandApi {
  /** Declares the state of the band for the page now open; call it again to change it (the whole state is replaced). */
  set(state: BandState): void
  /** Gives the band back to the shell. The shell does it by itself when the page closes or the route changes. */
  reset(): void
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
