# UI guidelines

The rules of [../refactoring-ui.md](../refactoring-ui.md) that apply to plugin pages. A plugin page must look and behave
like a page of the shell: the same header, the same table, the same empty state. The **layout contract** of the shell
(`tests/e2e/specs/15-layout-contract.spec.ts`) runs on the pages of every installed app; the rule ids below are its.
`mountCrud` follows all of them by itself: write your own pages with the same pieces.

| Piece | Use | Package |
|---|---|---|
| Header | `pageHead({ title, section?, sub?, filters?, actions? })` and `pageBody(...)` | `@mosaikit/plugin-api` |
| Table | `gridTable({ columns, label })` | same |
| Empty state | `emptyState({ art, title, text, actions })`, `filteredEmpty(...)` | same |
| Whole CRUD page | `mountCrud(root, msk, resource, { title, ... })` | same |
| Colours, type | the CSS variables of the theme | `@mosaikit/plugin-api/style.css` |

## Header (R-1, R-2, R-5, R-6, R-7)

- One header per page, built with `pageHead`: the page title (the entry of the navigation) and, for an open subsection,
  «Page › Subsection» (`section`).
- The header and the filter row under it are pinned and fully visible: they never move when the content scrolls. The
  content below (`pageBody`, `.msk-body`) is what scrolls.
- The filter and the single primary action («New …») sit on the first row, **right-aligned, the filter immediately left
  of the button**; on a phone they wrap under the title. Other actions go before the primary one, never after.
- Same type, height and spacing as the host header: do not add your own `h1` styles.

## Table (R-3, R-11, R-12)

- A list or table page does not scroll as a whole: the table fills the remaining height and scrolls **inside itself**,
  with a fixed header row; only the rows scroll.
- Draw lists with `gridTable`: sortable column titles (`aria-sort`), numbers sorted as numbers, and more rows loaded
  only when the end of the rows comes into view (the «Load more» button stays for the keyboard). A hand-written
  `<table>` is a warning in `validate --strict`.
- A filter box that searches every visible field sits in the header; for a server-paged list the filter and sort stay on
  the server (`server` and `serverSort`).
- Matrices and input grids (permissions, quotas) are not lists of records: use class `msk-matrix` with a sticky header row
  and first column.

## Empty state (R-10)

A page or list with nothing in it is **never** a bare «No items» line. It is the illustrated empty state: a picture, a bold
title, one short grey line and the buttons of what to do, among them the **primary action of the page repeated**. Centred
in the content area, and it never makes the area scroll.

- `emptyState({ art, title, text, actions })`; pick `art` from `documents`, `maps`, `notes`, `tasks`, `contacts`,
  `apps`, `generic`.
- A list that is empty **only because of a filter** is not an empty state: `filteredEmpty(message, 'Clear filters', onClear)`
  gives the small plain message with «Clear filters».
- Errors keep a plain box.
- `mountCrud` shows it by default; change it with the `empty` option. Every text must be translatable.

## Detail panel

A page made with `mountCrud` and `views` shows the detail panel only while an item is open or a new one is being written
(`panel: 'selected'`, the default): otherwise the list has the whole width. Clicking another item switches the panel;
Cancel, Escape and delete close it. The panel is a named region; the focus goes into it when it opens and back to the
item when it closes; on a phone it is a sheet over the list. A read-only preview of an item (`reader`) is not an editor.

## Colours and density

- Use the theme variables (`--bg`, `--panel`, `--fg`, `--dim`, `--line`, `--acc`, `--ok`, `--err`, `--on-acc`,
  `--on-err`), never fixed colours: the host changes them with the theme, dark mode and high contrast.
- Keep contrast at least AA; do not convey state by colour alone (`chip` has text).
- Density follows the style of the platform (`data-style-*`): do not set your own corner radius, font or tab style.
- No horizontal overflow at 390 px wide (R-9); no empty band between the top bar and the header (R-2).

## Language

Texts are English with translations (`i18n.ts` in the plugin, `[i18n.<lang>]` in the manifest). Use the glossary of the
shell: **Tenant**, **Tenant Manager**, **Plugin** (kinds App, Service, Extension), **Log**, **Sign-in**. A plugin is a plugin
for every role.

## Check

```
cargo xtask e2e -- specs/15-layout-contract.spec.ts      # in the Mosaikit repository
mosaikit-plugin validate --strict                        # the layout contract of mountCrud pages, on the source
```

`expectAccessible(page)` of `@mosaikit/plugin-testing` runs axe on the page ([Testing](testing.md)).
