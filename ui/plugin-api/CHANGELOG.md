# Changelog of @mosaikit/plugin-api

Versions follow the plugin API: see `docs/architecture.md` §8.11 of Mosaikit. A deprecated item stays for one major
version and is removed in the next.

## Unreleased

- `kanban`: the «nothing here» of an empty column is a `listitem` of its list (a list with no item failed the accessibility check `aria-required-children`). Visual no change.
- `msk.publicCall(name, args)` also runs a public command declared with `write = true` (it may insert an answer, a vote); the call is the same. Additive.
- `emptyState` art names `announcements`, `snippets`, `surveys`, `approvals` and `whiteboard`. Additive.
- `msk.realtime.open({ resource, name, state? })` (host ops `rt.open`, `rt.close`, `rt.send`, `rt.state`; host event `rt.event`; types `RealtimeChannel`, `RealtimeMessage`, `RealtimePerson`, `RealtimeStatus`): live messages and presence between the people who may see a resource of the plugin. Needs `[permissions] realtime = true` and `[requires] mosaikit = ">=1.0"`; nothing is stored by the kernel. Plugin API unchanged (additive). See `docs/architecture.md` §8.18.
- `CrudView.sort(a, b)`: the order of the items of a view (pinned notes first); stable, applied after `where`. Plugin API unchanged (additive).
- The colour of `.msk-avatar` is darker (30% lightness) so the white initials have a contrast of 4.5 to 1 or more on every hue. Visual only.
- `CrudView` kind `custom` with `render(api: CustomViewApi)`: the plugin draws the whole view (a board with drag and drop, grouped lists, a week) from the rows that pass `where`; `mountCrud` now returns a `CrudHandle`, the same close function with `reload()`. Plugin API unchanged (additive).
- The UI kit (docs/refactoring-ui.md §13), all additive: `toast`, `skeleton`, `progress` (bar, ring), `segmented`, `popover`, `menu`, `dialog`, `confirmDialog`, `tagInput`, `personPicker` (over `msk.directory`), `dateField`, `addDays`, `timeline`, `avatarStack`, `kanban` (pointer and keyboard drag and drop), `richText` (Markdown editor with preview), `renderMarkdown`, `renderInline`, `toggleCheck`, `checkProgress`; `avatar(name, big, src?)` takes a picture; `ArtName` has 12 more pictures (chat, calls, calendar, polls, forms, wiki, projects, tickets, bookmarks, inventory, dashboard, time); CSS tokens `--sp-1..6`, `--r-s/m/l/pill`, `--sh-1..3`, `--ease`, `--dur-1/2`. Plugin API unchanged.
- `msk.files.blob(id, source?)`: `source` reads the content of a file of another plugin's Files area (host op `files.blob`, route `GET …/files/{id}/content?source=`), with `files_read` enough, like `info` and `ticket`. Additive.
- `mountCrud` option `form: 'modal'`: the form of an item is a dialog over the page, opened by the «new» button and by selecting a row, closed by saving, cancelling, Escape or a click outside; the list is never pushed down by a form. `inline` (the default) is as before. Additive.
- `mountCrud` option `cell(field, row, text)`: draws a cell of the table your own way (a chip for a status). Additive.
- `msk.files.remove(id, source?)` (the `source` of the Files area of another plugin, `files_write`), `msk.files.info(id, source?)` (size, `can_share`, active `public_link`), `msk.files.ticket(id, download?, source?)` (`{ url, expires_in }`) and `msk.files.open(folder, { share? })` (Files page on a folder, sharing dialog open). Plugin API unchanged (additive).
- `mountCrud`: pressing again in the sidebar the entry of the page that is open closes the detail panel of a list with views (as Escape does), so the plugins that use it need no `msk.onNavReselect` code of their own.
- `msk.onNavReselect(fn)` (host event `nav.reselect`): the person clicked again, in the sidebar, the entry of the page that is open. A page with a back button in the band needs no code: the shell presses it. Plugin API unchanged (additive).
- `msk.embeds.url({ plugin, name, resource })` (host op `embed.url`) and `embedSession()`: a page of a plugin inside a frame of the page of another, with a ticket for one
  resource. Needs `[permissions] embeds`. Plugin API unchanged (additive).
- `msk.embeds.url` also works in a public link view: the ticket is tied to the link, `resource` must be the shared item or one under it, and the embedded page may call only the commands of the embed that its plugin also lists in `[[public_commands]]`. New errors: `public_commands_off`, `command_not_public`. Plugin API unchanged (additive).
- `EmbedUrl.sandbox`: the exact `sandbox` of the iframe of an embed (`"allow-scripts"` or `"allow-scripts allow-same-origin"`). A plugin that offers a page may declare `same_origin = true` in `[[embeds]]` (default false, sensitive) so that the frame has the origin of that plugin, for a page that frames an app whose `frame-ancestors` lists it; the kernel serves the page with the same CSP `sandbox`, and a public link view always gets `"allow-scripts"`. Plugin API unchanged (additive).
- `msk.schedules` (`list({ resource? })`, `create`, `update(id, patch)`, `pause`, `resume`, `remove`, `run`, `runs`, `timezone()`; host ops
  `schedules.*`): the schedules of the plugin, run by the shell with the session of the person; the plugin is forced to the one of the page.
  Types `Schedule`, `ScheduleRun`, `ScheduleCreate`, `SchedulePatch`, `SchedulesApi`. No manifest permission beyond `[[schedules]]`. Plugin API unchanged (additive).
- `msk.band.set({ comments: { resource } })`: the shell keeps the comments of the resource itself (button, badge, panel, thread in the platform);
  `open`, `count` and `onToggle` are then not needed. Plugin API unchanged (additive).
- `msk.band.set({ search, mode, presence, comments, back })` and `msk.band.reset()` (host ops `band.set`, `band.reset`; events
  `band.mode`, `band.comments`): the contextual top band for a resource on the full page: no search bar, a View | Edit
  switch (or a "Read only" label), the people connected (3 avatars and "+N"), a comments button, a back button (`back: { label, onClick }`, event
  `band.back`; an arrow-left icon right after the tenant, `label` is its name and tooltip). The shell sanitises
  everything (names 80 characters, initials 3, 50 people, count 0 to 9999) and resets the band when the page closes or
  the route changes; it never touches tenant, language, theme, help, notifications or the person. No manifest
  permission. Plugin API unchanged (additive).
- `msk.directory.search({ kind, q, limit })` (host op `directory.search`): the people (`{ id, username, name }`) or groups
  (`{ id, name }`) of the current tenant, for a picker. Needs `[permissions] directory = true` in the manifest and
  `[requires] mosaikit = ">=1.0"`; only a Tenant Manager or a person with the `share` permission may use it
  (`permission_denied` otherwise). Refused in public links and in runs. Plugin API unchanged (additive).
- `msk.publicConfig()` (host op `public.config`): the `[[config]]` settings marked `public = true`, in a public link.
- `msk.publicCall(name, args)` (host op `public.call`): runs a command of `[[public_commands]]` in a public link, read
  only, on the shared item. New error codes: `command_not_public`, `public_commands_off`, `public_rate_limited`,
  `args_too_large`. Needs `[requires] mosaikit = ">=1.0"` in the plugin; plugin API unchanged (additive).

## 1.0.0

First version of the plugin API (API 1).

- `API_VERSION`, `Hello.api`, `msk.api`, `checkHostApi`, `isIncompatible` and the error code `incompatible_api`:
  the version handshake between the plugin and the shell.
- `ErrorCode`: the codes of the errors, typed; `BridgeError.code` and `BridgeReply.code` use it. An error raised
  by the logic with a code of its own (`Error::coded` in the SDK) arrives with that code.
- `HostEvents` and `HostEventName` type the events of the host; the `theme` event is deprecated (use `context`).
- `ResourceMeta` types `msk.resource`.
- `ItemCtx.lang` and `EditorCtx.lang` are `string` (a language plugin may add any language); the column labels of
  a board receive it too.
- `ArtName` is limited to the pictures of the plugins (`documents`, `maps`, `notes`, `tasks`, `contacts`, `apps`,
  `generic`).
- The exports are listed one by one. No longer exported: `Bridge` (the type stays for tests), `applyTheme`,
  `applyContext`, `emptyArt`, `initials`, `errorText` (use `errText`) and the wire types (`BridgeRequest`,
  `BridgeReply`, `BridgeEvent`, `isReply`, `isEvent`).
- `el` lives in its own module.
- The package is no longer `private`: own version, `files`, `README.md` and `CHANGELOG.md`.
