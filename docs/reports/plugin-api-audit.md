# Plugin API audit (phase 0)

Audit of the public surface a plugin touches, for [plugin-devkit-plan.md](../plugin-devkit-plan.md) phase 0.
Sources: `crates/mskp/src/manifest.rs`, `crates/plugin-sdk`, `crates/runtime`, `crates/kernel/src/host.rs`,
`ui/plugin-api`, `ui/host/src/bridge.ts`, [architecture.md](../architecture.md) section 8, and the usage found by
grep in `mosaikit-plugins` (12 plugins: notes, tasks, contacts, maps, files, static-site, note-review,
4 layouts, lang-es).

Marks: `stable` = freeze in API 1; `to change` = fix in phase 1 while nothing outside depends on it;
`internal` = not part of API 1 (hide or unexport). "Unused" = no official plugin uses it; it is stable only if
it is a documented contract that a distribution may need, otherwise it is a candidate for `internal`.

## 1. Manifest (`plugin.toml`)

The parser uses `deny_unknown_fields` on every table, so a field added later breaks older kernels. This
shapes the `[requires]` plan of phase 1 (see 1.1).

### 1.1 Identity and compatibility

| Item | Mark | Reason |
|---|---|---|
| `id`, `name`, `version` | stable | Used by all 12 plugins; identity of the package |
| `abi` (default 1) | to change | Name clashes with the planned `api`; the kernel refuses any value but 1 with a generic message. Replace by `[requires] api = 1`, keep `abi` as a deprecated alias for one major version |
| `min_kernel` (default `1.0.0`) | to change | Replace by `[requires] mosaikit = ">=1.2, <2"`; a lower bound only cannot refuse a plugin built for an older major. Keep as deprecated alias |
| `description`, `author`, `license`, `homepage`, `details`, `screenshots` | stable | All 12 plugins set them; shown in the catalog and in Plugins |
| `kind` | to change | Enum is `app, service, extension, layout, language`; architecture.md 8.2 lists only the first three. All 12 plugins set it. Doc gap, and the "absent: derived" rule should be dropped (require it) |
| `icon` | stable | 8 of 12 use it; unknown names fall back |
| `[contribution]` (`icon`, `label`) | to change | Required by the parser (no default) yet 12/12 plugins carry it only for "older hosts" (emoji). Make optional, deprecate the emoji icon |

### 1.2 Resources, UI, navigation

| Item | Mark | Reason |
|---|---|---|
| `[[resources]]` `name`, `title_field`, `fields` | stable | 6 plugins; the generic CRUD contract |
| field `key`, `label`, `kind` (`text/number/bool/date/choice`), `required`, `multiline`, `options`, `option_labels`, `hidden`, `search` | stable | Used by plugins and extensions; `search` default derives from kind (documented) |
| `[ui]` `entry` | stable | 7 plugins |
| `[ui]` `public_view` | stable | 1 plugin (static-site); public links contract |
| `[[nav]]` (`id`, `label`, `icon`, `place`, `parent`, `permission`) | to change | Used by 7 plugins but absent from architecture.md 8.2: document it. Fix `place` vocabulary and the `target()` rule before freezing |
| `[search]` `command` | stable | Unused by official plugins, but a documented hook into shell search that a distribution needs; keep |
| `[language]` (`code`, `name`) | internal | Only for `kind = "language"`; belongs to the shell packaging, not to plugin authors. Absent from 8.2 |
| `layout/layout.toml` (kind `layout`) | internal | Shell slots and style; 4 layouts exist but this is not a plugin API |

### 1.3 `[permissions]`

| Item | Mark | Reason |
|---|---|---|
| `hooks` | stable | 4 plugins |
| `files`, `content` | stable | 1 plugin each (files, static-site) |
| `network` | stable | Unused by plugins in the repo (the translate plugin goes through a service key); documented contract for `http.fetch` and CSP `connect-src` |
| `frame_src` | stable | 1 plugin (maps) |
| `web` | to change | Used by 1 plugin (static-site) but missing from 8.2. Document it; the name is vague (it means "frame any site and probe pages"); consider `web_frame` |
| `calls` | stable | Unused by official plugins; the only cross-plugin contract, keep |
| `notify` | stable | Unused by official plugins; documented with tests, keep |
| `files_read` | stable | New: the logic reads the Files area as the caller (`files.list`, `files.describe`, `files.read`); default false, shown at install. Not `files` (the file API of a plugin that owns files) |
| `script_eval` | stable | Unused by official plugins; opt-in, default false, shown at install. Keep as is: CSP `unsafe-eval` and `wasm-unsafe-eval` on `script-src` and `worker-src` is the contract. Add a note that it is sensitive |

### 1.4 Other tables

| Item | Mark | Reason |
|---|---|---|
| `[requires]` `database`, `extensions` | stable | Unused by official plugins; needed for PostgreSQL-only plugins. Phase 1 adds `mosaikit` and `api` here |
| `[[kpi]]` (`view`, `label`, `columns`) | stable | 5 plugins |
| `[[user_permissions]]` (`key`, `label`, `description`, `default`) | stable | Unused by official plugins; reaches `ctx.can` and `msk.can` |
| `[[service_keys]]` (`id`, `label`, `description`, `address`, `scopes`) | stable | 1 plugin (notes, 2 keys) |
| `[[config]]` (`key`, `label`, `description`, `kind`, `default`, `options`) | stable | Unused by official plugins; documented settings contract, reaches `ctx.setting` |
| `[i18n.<lang>]` incl. `resources`, `kpi`, `permissions`, `config`, `service_keys`, `nav`, `extension` | stable | All 12 plugins use `i18n.it` (and `es`) at the top level plus resources, kpi, nav. The install check that refuses unknown keys is part of the contract |
| `[extends]` (`plugin`, `min_version`) | stable | 1 plugin (note-review) |
| `[[extension.fields]]` (`resource`, `key`, `label`, `kind`, `multiline`, `options`, `option_labels`, `hidden`) | stable | 1 plugin, 3 fields |
| `[[extension.actions]]` `set` | stable | 1 plugin |
| `[[extension.actions]]` `command` | stable | Unused by official plugins; documented alternative to `set`. Keep, but a test sample is missing |
| `[[extension.tabs]]` (`resource`, `key`, `label`, `icon`, `page`) | stable | 1 plugin |
| Distribution-facing seeding of settings and service keys, `allow_private_fetch_hosts` | internal | These are server configuration (`config.rs`), not manifest fields |

## 2. Logic: SDK and host operations

### 2.1 Host operations (wire level, `crates/kernel/src/host.rs`)

| Op | Mark | Used by | Reason |
|---|---|---|---|
| `db.query`, `db.exec` | stable | notes, tasks, contacts, maps (query, query_one); `exec` unused | Core contract, guarded by `sql-guard` and RLS |
| `resource.create`, `resource.delete` | to change | Unused | Signature is `(kind, title, parent)`, no field values; the plugin cannot set the resource's fields. Decide: extend with `values`, or drop from API 1 |
| `http.fetch` | stable | notes (through `fetch_with_key`) | Only to `network` origins or an address service |
| `plugin.call` | stable | Unused | See `calls` |
| `key.get` | stable | notes (4 uses) | Never send the key to the UI (documented) |
| `notify` | stable | Unused | See `notify` |
| `files.list`, `files.describe`, `files.read` | stable | Unused | See `files_read`; errors carry the codes `permission_denied`, `not_found`, `invalid_argument`; read is capped at 4 MiB |
| Error shape `{"err": "<string>"}` | to change (host operations now also give an optional `code`) | all | No stable error code from the logic; UI gets `plugin_error` only. Add optional `code` (and keep `err` as text) |

### 2.2 Wire format and runtime (`crates/runtime`)

| Item | Mark | Reason |
|---|---|---|
| Exports `memory`, `msk_alloc`, `msk_call` (`ABI_EXPORTS`) | stable | Frozen as ABI v1 |
| Imports `msk.host_call`, `msk.host_read`, `msk.log` | stable | Frozen as ABI v1 |
| Message `{"abi":1,"kind":"command"/"hook",...}`, answer `{"ok"}`/`{"err"}` | stable | Frozen; the `abi` field in the message stays 1 as long as the wire format does |
| `Limits` (`fuel`, `memory_bytes`, `max_message`) | internal | Server tuning, not a plugin contract. Document the defaults (2e9 fuel, 64 MiB, 16 MiB) as "may change" |
| `Host` trait, `Engine`, `Module` | internal | Kernel side; plugins never see them |

### 2.3 SDK crate (`crates/plugin-sdk`)

| Item | Mark | Reason |
|---|---|---|
| `plugin!` macro (`hooks:`, `commands:`) | stable | 4 plugins |
| `prelude` (`Ctx`, `Hook`, `Values`, `Value`, `Error`, `Result`, `json`, `Group`, `Notice`) | stable | 4 plugins use the prelude |
| `Ctx` fields `user`, `username`, `tenant`, `plugin`, `perms`, `groups`, `config` | to change | Unused by official plugins as fields (they use methods); `Ctx` is `pub struct` with public fields, so adding a field is breaking for struct literals. Mark `#[non_exhaustive]` and keep fields readable |
| `Ctx::db`, `log`, `service_key` | stable | Used |
| `Ctx::can`, `setting`, `notify`, `call_plugin`, `resources`, `http` | stable | Unused by official plugins; contract of manifest features. Add at least one official sample that exercises each |
| `Db::query`, `query_one` | stable | Used |
| `Db::exec` | stable | Unused; needed for any write that is not a CRUD hook |
| `Http::get`, `fetch`, `json` | stable | Unused (notes uses `fetch_with_key` only) |
| `Http::fetch_with_key` | stable | Used |
| `Resources::create`, `delete` | to change | See 2.1 |
| `Hook` (`hook`, `resource`, `id`, `values`, `previous`) | stable | `values` and `previous` used |
| Hook names `before_create`, `before_update` | stable | Used by 4 plugins |
| Hook name `after_delete` | stable | Unused. Documented in 8.3; the `Hook` struct has no data to describe the deleted row beyond `id` and `values`. Decide before freezing whether `previous` is filled |
| Hook key format `"<resource>.<hook>"` | stable | Used; commands use `"<plugin-ish>.<name>"` by convention, not enforced |
| `Values` (`get`, `str`, `f64`, `bool`, `set`, `remove`, `From<Map>`) | stable | Used (`str`, `set`; others by tests). `bool` accepts Italian `si` and `sì`, which is odd for an English API: drop in API 2 |
| `abi::{alloc, call}` | internal | Used only by the macro on wasm32. Make `#[doc(hidden)]` |
| `Registry` struct and `dispatch`, `command_names` | internal | Generated by the macro; `dispatch` is used by `MockHost`. `#[doc(hidden)]` |
| `host::{call, log}` (module `host`) | internal | Raw wire access; plugins use `Ctx` |
| `testing::MockHost` (`new`, `on`, `with_groups`, `command`, `hook`, `calls`, `logs`, `notifications`) | stable | Used by 4 plugins (9 instances). `on` is the generic escape hatch |
| `testing::{mock_call, mock_log}` | internal | Plumbing of `host::imp` |

## 3. Commands and hooks of the logic

| Item | Mark | Reason |
|---|---|---|
| Command call `(ctx, args) -> Result<Value>` | stable | `CommandFn` |
| Hook call `(ctx, &Hook) -> Result<Option<Values>>`, `Some` replaces the values | stable | `HookFn` |
| Hooks and commands run in the caller's transaction; an error rolls back | stable | Documented |
| Command names (flat strings, `notes.translate`) | to change | No namespace rule: two plugins can use the same name; the kernel calls by plugin id so it is safe today, but `[search] command` and extension actions refer to bare names. Document: names are scoped by plugin |
| Error from a hook or command | to change | Plain string; see 2.1 |
| Instruction/fuel exhaustion and memory errors | internal | Shown as a generic error; not a contract |
| `ctx.perms` content (`use`, `create`, `delete`, `share` plus `[[user_permissions]]`) | stable | Kernel enforces the standard ones |

## 4. UI: `@mosaikit/plugin-api`

The package is `private: true`, version `1.0.0`, no version export, no handshake version.

### 4.1 Core

| Item | Mark | Used by | Reason |
|---|---|---|---|
| `connect()`, `Msk` | stable | 7 plugins | Entry point |
| `Msk.user`, `tenant`, `plugin`, `context`, `onContext`, `at`, `perms`, `can`, `isPublic`, `publicResource`, `publicGet` | stable | user, context, onContext, at, publicResource, publicGet used | `isPublic`, `perms`, `can`, `tenant`, `plugin` unused by official plugins but part of the handshake |
| `Msk.crud(name).list/get/create/update/delete` | stable | 4 plugins | Core |
| `Msk.call(name, args)` | stable | 1 plugin | Logic commands |
| `Msk.toast`, `confirm`, `share` | stable | toast 18, confirm 5, share 3 | Shell services |
| `Msk.files.*` (`list`, `mkdir`, `upload`, `rename`, `move`, `copy`, `remove`, `blob`, `zip`, `url`) | stable | files plugin uses all | Needs `files` |
| `Msk.content.upload`, `url` | stable | static-site | Needs `content` |
| `Msk.web.probe` | stable | static-site (3) | Needs `web` |
| `Msk.resource(id)` (`resource.meta`) | stable | Unused | Returns `Record<string, unknown>`; type it before freezing: mark **to change** |
| `Msk.notify` | stable | Unused | Not gated by the manifest `notify` flag (that flag is for the logic); document that the UI has its own limits |
| `Msk.extensions(res).list/values/set/action/mountTab` | stable | Only through `mountCrud` | |
| `Msk.tab`, `tabClient()` (`item`, `values`, `set`, `action`, `autoResize`) | stable | note-review | |
| `Msk.onEvent(fn)` | to change | Unused | Free-form `(event: string, data: unknown)`: events not typed or listed. Type the event names (`context`, `theme`, `ext.changed`) |
| `Msk.bridge` (public field), `Bridge`, `BridgeError` | to change | `files` plugin takes `type Bridge` once | Exposes the transport; make `Bridge` internal and keep `BridgeError` as the error type |
| `applyTheme`, `applyContext` | internal | Unused | `connect()` calls them; no plugin needs them |
| `isReply`, `isEvent`, `BridgeRequest`, `BridgeReply`, `BridgeEvent` (types) | internal | Unused | Wire details of the postMessage protocol |
| Protocol types (`Row`, `Values`, `FieldDecl`, `FieldKind`, `Level`, `ListResult`, `FileEntry`, `Listing`, `SiteInfo`, `WebProbe`, `UiContext`, `Hello`, `Notify`, `PublicResource`, `ExtensionView`, `ExtensionTab`, `TabInfo`, `Rect`) | stable | Used (Row, Values, FileEntry, Listing, Level, SiteInfo, PublicResource, TabClient) | `Rect` is only for tabs: internal |
| `export type *` from `protocol.ts` | to change | | Exports every future type by default; list the exports one by one |
| Error codes of `BridgeReply.code` (`missing_permission`, `quota_exceeded`, `plugin_error`, `plugin_off`, `base_off`...) | to change | `errText` used by 7 plugins | Codes exist but are not listed in one table nor typed; publish the list and a union type |
| `errText`, `errorText` | to change | `errText` 7 plugins, `errorText` unused | Two names for nearly the same thing (`errText(e, lang)` in `crud-view.ts`, `errorText` in `errors.ts`). Keep one |

### 4.2 Widgets and helpers

| Item | Mark | Used by | Reason |
|---|---|---|---|
| `mountCrud(root, msk, resource, opts)` | stable | contacts, notes, tasks | Returns a dispose function |
| `CrudOptions`: `title`, `newLabel`, `columns`, `empty`, `views` | stable | contacts, notes, tasks | |
| `CrudOptions`: `section`, `where`, `detail`, `reader`, `bar`, `editor`, `onLoad` | stable | notes only | Several used by a single plugin: stable but flagged as thin evidence; re-check after the second user |
| `CrudOptions.panel` | to change | Unused | Candidate internal: drop or prove with a sample |
| `CrudView` (`key`, `label`, `kind`, `box`, `item`, `columns`) and `ItemCtx`, `EditorCtx` | stable | notes, tasks, contacts | `lang: 'en'|'it'|'es'` is a closed union that breaks with a new language: change to `string` (**to change**) |
| `gridTable`, `GridCol`, `GridOptions`, `Grid` | stable | maps, static-site | |
| `emptyState`, `filteredEmpty`, `EmptyStateOptions` | stable | files, maps, static-site | Rule in CLAUDE.md |
| `ArtName` | to change | via `empty.art` | Closed union of 13 art names, including shell-only names (`plugins`, `trash`, `shares`, `usage`, `inbox`, `people`); keep only the ones for plugins, or accept a string |
| `emptyArt` | internal | Unused directly | Used by `emptyState` |
| `pageHead`, `pageBody`, `PageHead` | stable | files, maps, static-site | |
| `avatar`, `chip`, `initials` | stable | contacts, tasks | Small helpers; `initials` is unused directly: internal |
| `el` (alias of `h` in `crud-view.ts`) | to change | 7 plugins | Heavily used but lives in `crud-view.ts` under the name `h`; move to its own module with its own tests |
| `watchTableScroll` | stable | files | Unlike `gridTable` it needs the `.msk-grid` CSS contract |
| `style.css` (`./style.css`) and CSS variables (`--on-acc`, `--on-err`, theme vars) | stable | all UIs | Name and meaning of every variable need a list: **to change** (document) |
| Handshake (`Hello`): no `api` or version field | to change | | Add `api: 1` to `Hello` and a `MSK_API_VERSION` export (phase 1) |

## 5. Events and extensions

| Item | Mark | Reason |
|---|---|---|
| Bridge event `context` | stable | Used by `onContext`; 8 uses |
| Bridge event `theme` | to change | Only for plugins written before `context`; deprecate in API 1, remove in API 2 |
| Bridge event `ext.changed` | stable | Sent to the extended plugin after a change; used inside `mountCrud` only. List it |
| Event log actions (`events::record`) | internal | Kernel audit log, not a plugin contract |
| `core.extension_values`, REST `/ext/...` | internal | Reached only through the bridge |
| Extension contract (fields, actions `set` with `$user`, `$today`, tabs) | stable | See 1.4 |
| Extension tab frame (sandbox without `allow-same-origin`, bridge limited to one item) | stable | Security contract |
| Notifications from the plugin (`msk.notify`, `ctx.notify`) | stable | Same limits on both sides (30 per minute, 160 and 600 characters) |
| Public links and `public_view` page | stable | Only static-site; `Hello.public`, `publicGet` |

## 6. Candidate-internal (unused by any official plugin)

Not used by `mosaikit-plugins`, and not tied to a documented distribution need:
`CrudOptions.panel`, `emptyArt`, `errorText`, `applyTheme`, `applyContext`, `initials`, `Msk.onEvent`,
`Msk.resource`, `BridgeError`, `Resources::create/delete`, `Values::f64/bool/remove`.

Unused but kept as stable because a manifest feature depends on them: `[[config]]`/`ctx.setting`,
`[[user_permissions]]`/`ctx.can`, `calls`/`call_plugin`, `notify`/`ctx.notify`, `network`/`http.fetch`,
`script_eval`, `[search]`, `[requires]`, extension `command` actions. These have kernel tests but no official
sample. Phase 1 should either add a sample plugin that uses them (best: it also serves the devkit templates of
phase 3) or move them to "experimental" in the API document.

## 7. Documentation gaps found

- architecture.md 8.2 omits `[[nav]]`, `[language]`, `[permissions] web`, the `kind` values `layout` and
  `language`, and the fields `author`, `license`, `homepage`, `details`, `screenshots`.
- ABI table says `msk.host_call` and `host_read`; nothing says what the SDK offers beyond `ctx.*` in a table.
- No list of error codes, no list of bridge events, no list of theme CSS variables.

## 8. Changes proposed for phase 1

1. Manifest: add `[requires] mosaikit` (semver range) and `api` (integer); keep `abi` and `min_kernel` as
   deprecated aliases for one major version and log a warning in development. Because the parser denies
   unknown fields, release the kernel that understands `[requires]` before the first plugin that uses it, and
   say it in the notes.
2. Kernel refusal: one translatable error with the plugin's range and the kernel's version; show it in
   Plugins > Updates (as the plan says).
3. Manifest: make `[contribution]` optional (deprecate the emoji icon); require `kind`; document `nav`,
   `web`, `language`, `layout` and the descriptive fields in architecture.md 8.2; settle the `web` name.
4. Errors: add an optional `code` to the error of the logic (`{"err": "...", "code": "..."}`), carry it through
   `Error` in the SDK and into `BridgeReply.code`; publish one list of codes with a TypeScript union type.
5. `resource.create`: decide between adding `values` and removing it from API 1; adjust SDK and mock.
6. SDK: mark `Ctx` as `#[non_exhaustive]`; `#[doc(hidden)]` for `abi`, `host`, `Registry`, `mock_call`,
   `mock_log`; drop the Italian words from `Values::bool`.
7. UI package: export `API_VERSION`, add `api` to `Hello`, make the shell send it, handle a plugin that
   declares itself incompatible; replace `export type *` with an explicit list; unexport `Bridge`,
   `applyTheme`, `applyContext`, the wire types and `emptyArt`; type `Msk.onEvent` with the event names;
   keep one of `errText` and `errorText`; type `Msk.resource`.
8. UI: `lang` of `ItemCtx`/`EditorCtx` becomes `string`; `ArtName` limited to plugin illustrations (or a
   string with a fallback); decide on `CrudOptions.panel` (drop unless a sample needs it); move `el` to its own
   module.
9. Events: deprecate `theme` (replaced by `context`); list `context`, `ext.changed` and the future version
   handshake in one table.
10. Unused-but-kept surface: add a sample plugin or a test fixture per feature (config, user permissions,
    calls, notify, network, search, extension command) or mark it experimental in the API document.
11. Packaging (as in the plan): own version and changelog for `mosaikit-plugin-sdk` and `@mosaikit/plugin-api`
    (the npm package is now `private: true` and exports TypeScript source); the deprecation rule.
