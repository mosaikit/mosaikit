# UI reference

The UI of a plugin is a web page (Vite and TypeScript in the template) in `ui/`, built to `ui/dist`, that the shell
shows in an iframe on the **untrusted origin**. It talks to the host only through the postMessage bridge of the npm
package `@mosaikit/plugin-api` (plugin API 1). Source: `ui/plugin-api/src`; only what `src/index.ts` exports is public.
Architecture §8.4 and §8.11.

```ts
import '@mosaikit/plugin-api/style.css'
import { connect, mountCrud, errText } from '@mosaikit/plugin-api'

const msk = await connect()        // handshake: API, language, theme, mode, user, tenant
mountCrud(document.getElementById('app')!, msk, 'notes', { title: 'Notes' })
```

## `connect()` and `Msk`

`connect()` reads the `host` parameter of the URL of the iframe (the page must be opened inside Mosaikit), sends `hello`
with `{ api: API_VERSION }`, applies language, mode and theme to `<html>` and returns an `Msk`. Every message goes only to
the origin of the host and is accepted only from it. A call that gets no answer in 120 s fails with
`the host did not answer <op>`.

| Member | What |
|---|---|
| `msk.api` | the plugin API the host speaks |
| `msk.user` | `{ id, username, name }` (absent in public links) |
| `msk.tenant` | `{ slug, name, role: 'manager' \| 'member' }` |
| `msk.plugin` | `{ id, version }` |
| `msk.perms`, `msk.can(key)` | permissions of the person in the plugin; use them to hide what they may not do (the kernel and the logic enforce them anyway). An older host: everything allowed |
| `msk.context` | `{ lang, preset, mode, preference, contrast?, theme }`, updated at every change |
| `msk.onContext(fn)` | called when language, theme or mode change; returns the stop function |
| `msk.at` | the place the page was opened at (from a notification, or the `place` of a `[[nav]]` entry) |
| `msk.tab` | in an extension page opened as a tab: `{ base, resource, item, key, level }` |
| `msk.isPublic`, `msk.publicResource`, `msk.publicGet()` | public-link viewer (`public_view`) |

### Operations

| Call | What |
|---|---|
| `msk.crud(resource).list({ filter, parent, limit, cursor, sort, dir })` | rows, latest changed first; all of them (up to 5,000) or a page with `limit` (the next with `cursor` = the previous `next`); `sort` a declared field that is not hidden, or `created_at`, `updated_at`, `owner_name`, sorts the whole list; an unknown field is `sort_unknown` |
| `.get(id)`, `.create(values, parent?)`, `.update(id, values)`, `.remove(id)` | one row; each is limited to this plugin and runs with the session |
| `msk.call(name, args)` | a command of the logic |
| `msk.files.*` (`list`, `mkdir`, `upload`, `rename`, `move`, `copy`, `remove`, `blob`, `zip`, `url`) | the file API, only with `[permissions] files` |
| `msk.content.upload(id, zip)`, `.url(id)` | folder content, only with `content` |
| `msk.web.probe(url, image?)` | may the page be framed, its title and picture; only with `web`. Experimental |
| `msk.resource(id)` | metadata of an item (owner, level, size…) |
| `msk.share(id)` | the share dialog of the host |
| `msk.notify({ title, body?, at?, resource? })` | a notification; returns how many people got it. Experimental |
| `msk.toast(text, error?)`, `msk.confirm(text)` | a toast; the confirmation dialog of the host |
| `msk.extensions(resource)` | `list`, `values(ids)`, `set(id, ext, values)`, `action(id, ext, key)`, `mountTab(el, id, ext, tab)` |
| `msk.tabClient()` | in a tab page: `item()`, `values()`, `set(values)`, `action(key)`, `resize(h)`, `autoResize(el?)` |
| `msk.onEvent(fn)` | every event of the host; see below |

`crud.list` rows have `id, values, owner_id, owner_name, my_level ('read'|'write'|'manage'), shared, parent_id,
created_at, updated_at`; the result also has `fields` (with the labels and choice labels in the language of the host) and,
with `limit`, `next` and `total`.

### Errors

Every failure is a `BridgeError` with `message` (in the language of the host), `code`, `status` (HTTP, if the request
reached the server) and `serverMessage`. **Switch on `code`, never on the text.** The type `ErrorCode` lists the codes of
the platform and stays open for codes your logic chose.

| Code | Meaning |
|---|---|
| `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `too_many`, `internal` | the category, when there is no more specific code |
| `missing_permission` | the permission profile does not allow it |
| `plugin_off`, `base_off`, `plugin_unavailable` | the plugin (or the one an extension extends) is not on or not available |
| `plugin_error` | raised by the logic without a code (your own code arrives instead when the logic gave one) |
| `quota_exceeded`, `content_too_large`, `too_many_rows`, `too_many_notifications` | limits |
| `sort_unknown`, `item_exists` | list and items |
| `web_blocked`, `web_unreachable`, `web_url` | `msk.web.probe` |
| `maintenance`, `server_unavailable`, `unexpected` | the platform and the connection |
| `incompatible_api` | the handshake: `isIncompatible(e)` tells it apart |

`errText(e, lang?)` gives the text for the person: the message the host translated, or the translation of the code
when the host could not, in English or Italian.

### Events

`context` (language, theme, mode: use `msk.onContext`), `theme` (**deprecated**, the same variables as `context`, still sent
in API 1, removed in API 2), `ext.changed` `{ extension, id }`, `ext.tab.height` `{ handle, height }` (handled by
`mountTab`).

## `mountCrud(root, msk, resource, options)`

Draws a whole page from the manifest: the header (`pageHead`), a filter box, a `gridTable` (or your views) paged 100 rows
at a time, a detail panel with the form, sharing, delete, extension fields and tabs, and the empty state. It speaks
English, Italian and Spanish by itself and follows language changes. Returns a function that closes it.

| Option | Type | What |
|---|---|---|
| `title` | string | the title of the page; **always give it** (`validate --strict` warns without) |
| `section` | string | the open subsection, the header reads «title › section» |
| `columns` | string[] | fields in the table; default the visible fields, at most 5 |
| `newLabel` | string | label of the new button; default «New» |
| `where` | `(row) => boolean` | show only the rows that pass: a page of the navigation («Mine», a tag) |
| `views` | `CrudView[]` | your own rendering next to the detail panel instead of the table; more than one adds a switch |
| `empty` | `{ art?, title?, text?, actions? }` | the empty state; defaults are a generic picture, «Nothing here yet», «Create the first one to get started.» and the new button |
| `panel` | `'selected' \| 'always'` | the detail panel only while an item is open (default), or always. Experimental |
| `detail` | `(row, box) => void` | your own tools in the detail of an existing item |
| `reader` | `(ctx: ItemCtx) => HTMLElement` | a read-only view of the open item, with «Edit» for the fields |
| `bar` | `HTMLElement[]` | a bar of yours above the list, under the header |
| `editor` | `(ctx: EditorCtx, box) => void` | your own part of the form; set hidden fields with `ctx.set` |
| `onLoad` | `(rows) => void` | called with the rows every time the list loads |

`CrudView`: `{ key, label, kind: 'list' | 'cards' | 'flow' | 'board', item(ctx), box?(ctx, el), columns? }`; a `board`
needs `columns: [{ key, label(lang), match(row) }]`. `ItemCtx`: `row`, `fields`, `text(key)`, `value(key)`, `selected`,
`canWrite`, `lang`, `update(values)`. `EditorCtx`: `row` (null for a new item), `value`, `set`, `canWrite`, `lang`.

Hidden fields are not columns or form fields; fields that extensions add appear as columns and in the detail, and their
actions as buttons. The sort of the whole list is done by the server for the declared fields and the owner.

## `gridTable(options)`

The table of your own lists: a fixed header row, only the rows scroll, sortable titles, the foot as the last row
(`.msk-grid`).

```ts
const grid = gridTable<Row>({
  label: 'Expenses',                       // accessible name
  columns: [
    { key: 'title', title: 'Title', sort: (r) => String(r.values.title) , cell: (r) => String(r.values.title) },
    { key: 'amount', title: 'Amount', align: 'right', width: '8rem', sort: (r) => Number(r.values.amount), cell: (r) => String(r.values.amount) },
  ],
})
card.append(grid.el)
grid.set(rows, footButton, 'No expenses')   // draws the rows
```

| Option | What |
|---|---|
| `columns` | `{ key, title, width?, align?: 'right', sort?, serverSort?, cell, className? }`; `width` is a CSS grid track, default `minmax(7rem,1fr)`; a title is a button only with `sort` (local) or `serverSort` (server) |
| `label` | accessible name of the table |
| `decorate(row, tr)` | called for every row: classes, listeners, `tabindex` |
| `local` | `{ step, more, of }`: a list whole in memory shown a page at a time, the next as the foot comes into view |
| `server` | `{ onSort({ field, dir } \| null) }`: rows paged by a server that sorts them; only columns with `serverSort` sort |

It returns `{ el, scroller, set(rows, foot?, empty?), columns(cols) }`. Numbers sort as numbers, text by language with
numbers inside as numbers, empty values last; `aria-sort` is kept.

## `emptyState`, `filteredEmpty`

```ts
emptyState({ art: 'tasks', title: 'No tasks yet', text: 'Add your first task.', actions: [newButton] })
filteredEmpty('No result', 'Clear filters', () => clear())   // a filter that matches nothing
```

`art` is `documents`, `maps`, `notes`, `tasks`, `contacts`, `apps` or `generic`. Never a bare «no items» line
([UI guidelines](ui-guidelines.md)).

## `pageHead`, `pageBody`

```ts
document.body.append(
  pageHead({ title: 'Insights', section: 'Overview', sub: '12 expenses', filters: [search], actions: [newButton] }),
  pageBody(content),            // the part that scrolls
)
```

`pageHead` draws the header of a page like the shell's: title with the subsection, the line under it, filters and
actions at the right (the primary action last). The header never scrolls; `pageBody` is `.msk-body`, the part that does.
Also exported: `avatar(name, big?)`, `chip(text, tone?)` (`ok`, `err`, `acc`), `el` (a small element builder),
`watchTableScroll()`.

## Theme and style tokens

`connect()` applies the host theme to `<html>`: `lang`, `data-mode` (`light` or `dark`), `data-preset`,
`data-contrast` (`more` for high contrast), `color-scheme` and the CSS variables. Import `@mosaikit/plugin-api/style.css`
for the base style and use the variables, never fixed colours, so a plugin follows every theme, dark mode and high
contrast:

| Variable | Use |
|---|---|
| `--bg`, `--panel`, `--panel2` | page, card, raised surface |
| `--fg`, `--dim` | text, secondary text |
| `--line` | borders and dividers |
| `--acc`, `--acc-soft`, `--acc-line`, `--on-acc` | accent, its soft fill and line, text on the accent |
| `--ok`, `--err`, `--on-err` | success, error, text on the error colour |
| `--font-ui`, `--font-mono` | fonts |

The classes of the base style (`.msk-btn`, `.msk-chip`, `.msk-grid`, `.msk-pagehead`, `.msk-body`, `.msk-emptystate`,
`.msk-field`, `.msk-toolbar`…) are what `mountCrud` uses; reuse them for pages of your own.

## i18n

- The texts of the **manifest** (names, field labels, KPI labels, nav) are translated in `[i18n.<lang>]`
  ([Manifest reference](manifest.md)); the host sends them in the language of the person.
- The texts **inside your UI** are yours: read `msk.context?.lang` at start and redraw on `msk.onContext`. The template
  has `ui/src/i18n.ts` with `en`, `it`, `es`. `mountCrud` has its own texts in the same three languages and falls back to
  English for another code (a language plugin may add any language).
- Dates and numbers: format with `Intl` and `msk.context.lang`.

## Accessibility

The shell is checked with axe and the layout contract; plugin pages must keep the same level.

- Use real controls (`button`, `a`, `input` with a `label`), a `h1` per page (`pageHead` does it) and visible focus.
- Give tables an accessible name (`label` of `gridTable`) and keep the titles as buttons with `aria-sort`.
- Colours only from the variables (contrast follows the theme); never convey state by colour alone (`chip` has text).
- Respect `data-contrast="more"` and `color-scheme`; do not set your own.
- Everything works at 390 px wide, with no horizontal overflow.
- Test it: `expectAccessible(page)` of `@mosaikit/plugin-testing` runs axe on the page and the plugin frame
  ([Testing](testing.md)).
