# Changelog of @mosaikit/plugin-api

Versions follow the plugin API: see `docs/architecture.md` §8.11 of Mosaikit. A deprecated item stays for one major
version and is removed in the next.

## Unreleased
n- Plugin manifest `icon_image` (an image of `media/`): an illustrated icon that a layout may draw in place of the line icon. The shell marks the app item with `data-image` and sets `--msk-icon-image: url(...)`. Additive; a host older than 1.5 rejects the field, so a plugin that uses it requires `mosaikit = ">=1.5, <2"`.

- `msk.band.set({ identity: { name, logo? } })` (type `BandIdentity`): the name of the open resource and a small logo (`data:` picture, png/jpeg/webp/gif) in the middle of the top band, in the place of the search bar, with the back button next to them; without a logo the shell draws a default one. Additive.

- `msk.publicLink.get(id)`, `create(id, { expires_in_days?, password? })`, `revoke(id)` (type `PublicLinkState`): the public link of an item, for a page that replaces the share dialog. The rules of the dialog (manage the item, `share` permission, policy of the tenant, rate limit); the address is given once by `create`. Not in public links or runs. Additive; needs a Mosaikit with `[requires] mosaikit = ">=1.3"`.
- `popover` and `menu` open above their anchor when there is no room below (a button at the bottom of the page, like the composer of a chat). Visual only.

- `Notify.to` (`msk.notify({ resource, to })`): limits the notification of an item to some of the people who see it (user ids, at most 200; the intersection, never more people). Needs `resource`. A host that does not know it notifies all of them. Additive.
- Kit, wave 1 of `docs/plugins-review.md` (X3, X4, X7, X8, X12, X16; additive, no kernel change; new dependencies `@floating-ui/dom` MIT, `@tanstack/virtual-core` MIT, `echarts` Apache-2.0 with `zrender` BSD-3-Clause):
  - `shortcuts(list, opts?)`: one place for the keys of a page (`n`, `/`, `g i`, `ctrl+k`), ignored while the person types, help sheet on `?` (a kit dialog; texts in `opts.labels`). Also `keyName`.
  - `shareChip({ names, onOpen, readonly?, copyLink?, labels? })`: avatars of who can see the item and a button to the host share dialog (`msk.share(id)`), optional copy-link.
  - `undoToast({ text, commit, undo, ms?, undoLabel? })`: «Deleted - Undo»; the destructive call runs after the delay unless Undo is pressed; a page that is hidden commits.
  - `toCsv`, `csvCell`, `downloadCsv`, `downloadFile`: CSV with UTF-8 mark, quoting, formula neutralising; download through the browser.
  - `filteredEmpty(message, clearLabel, onClear)` (already there) has a dashed frame and accent link; use it for «no results for this filter», `emptyState` for a really empty page.
  - `popover` and `menu` are placed by Floating UI (flip above the anchor when there is no room, shift inside the page, follow scroll and resize); `data-placement` on the element. Same behaviour as before for the common case.
  - `virtualList({ count, estimateSize, render, getKey?, overscan?, gap?, label? })`: rows in view only, on TanStack Virtual; `setCount`, `scrollToIndex`, `refresh`, `visible`, `destroy`.
  - `chart(spec, labels?)` (`line`, `bar`, `pie`, Apache ECharts, tree-shaken and loaded on the first call, about 186 KB gzip that a plugin without charts never downloads): follows the host colours and theme (optional tokens `--chart-1..8`), resizes with its box, `role="img"` with a name and a «Show data» table, no animation when `prefers-reduced-motion`.
  - Styles: `.msk-sharechip`, `.msk-keysheet`, `.msk-vlist`, `.msk-chart`.

- `msk.share(id, { principals: [{ type: 'all' }] })`: `type: 'all'` (no `id` needed) stands for every member of the tenant, the built-in group «All members»; the dialog suggests it and shares in one step. Additive.

- `msk.busy(on)` and `msk.loading(work)` (kit `busy.ts`, style `.msk-busy`): the standard loading spinner of a plugin page, the same in every plugin. It appears only if the work lasts a little (150 ms), never blocks the page, is counted (two `busy(true)` need two `busy(false)`) and goes off by itself at an unhandled error of the page, so a plugin that forgets `busy(false)` is never stuck. `mountCrud` uses it for its first load. The host shows its own spinner only until the plugin says `hello`. Additive.

- `msk.share(id, { principals, level? })` (types `SharePreselect`, `SharePrincipal`): the share dialog of the host starts with those people and groups ready to be shared with, at `level` (default `read`); the person confirms with one button or ignores it. The names are labels: the host checks the ids (at most 200) and the usual rules apply (the person must manage the resource). A host that does not know the options opens the plain dialog. Additive.

- `msk.t(phrase, vars?)` and `msk.ownTexts(tables)`; `UiContext.texts` (host: `lang/ui/<plugin id>.json` of the active language plugin, English phrase to translation): the texts inside the page of a plugin in the language of the person, `{name}` placeholders, the English phrase when there is no translation or the host is older. Also `fillText`; `connect()` sets `dir="rtl"` on `<html>` for Arabic, Hebrew, Persian and Urdu. Plugin API unchanged (additive, opt-in).
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
