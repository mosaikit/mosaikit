<!-- SPDX-FileCopyrightText: 2026 Massimo Antonini -->
<!-- SPDX-License-Identifier: MPL-2.0 -->

# Page patterns of the UI kit

Apps that list resources share one shape: facets in a side column, a header with the count, cards
or rows, a bar of bulk actions, panels that say why they are empty, and list panes the person
resizes (MK-105, [ADR-0039](../../adr/0039-console-layout.md)). `@mosaikit/ui` offers them as
custom elements, defined by the shell for the page together with the Fluent UI components
([Components and themes](frontend.md#components-and-themes)): an extension that runs as a module
uses them without bundling them, and they follow the theme with the `--mk-*` tokens. Their texts
are in English; pass yours with the property `labels` (list page) or the attributes below.

## List page

```html
<mk-list-page heading="Notes" count="42" layout="rows" active-filters="1" selected="0">
  <fieldset slot="facets">…</fieldset>
  <fluent-button slot="actions" appearance="primary">New note</fluent-button>
  <fluent-button slot="bulk-actions">Archive</fluent-button>
  <article>…</article>
  <article>…</article>
</mk-list-page>
```

| Attribute or slot | What it is |
|---|---|
| `heading`, `count`, `level` | the title, the number of items and the level of the heading (default 1), in a header that stays fixed while the items scroll |
| `layout` | `rows` (default) or `grid` of cards (width `--mk-list-card-width`, default 240px); the person switches it in the header, and the page dispatches `mk-layout-change` with `{ layout }` |
| slot `facets` | the filters, in a side column |
| `active-filters` | the number of active filters: below the medium breakpoint (900 pixels of the page, not of the window) the column gives way to a **Filters** button that shows it, and opens the facets over the page (Escape or the close button closes them) |
| slot `actions` | the actions of the header, such as creating an item |
| `selected`, slot `bulk-actions` | above zero, the header shows the number selected and the bulk actions of the app; **Clear the selection** dispatches `mk-selection-clear` |
| default slot | the items |

The app owns the data: it filters, selects and counts, and sets the attributes; the page lays out
and tells. Pass the texts in another language with `labels`, for example
`page.labels = { filters: 'Filtri', filtersActive: 'Filtri ({count} attivi)', selected: '{count} selezionati' }`.

## Empty and error states

A panel without content says what happened and what to do, so that a failed request never looks
like an empty list:

```html
<mk-empty-state kind="empty" heading="No notes yet">
  Notes you write show here.
  <fluent-button slot="action" appearance="primary">New note</fluent-button>
</mk-empty-state>
<mk-empty-state kind="failed"></mk-empty-state>
```

| `kind` | When | Default action |
|---|---|---|
| `empty` | nothing yet | none: give yours in the slot `action` |
| `filtered` | there are items, but the filters hide all of them | **Clear the filters**, event `mk-clear-filters` |
| `failed` | the request failed | **Try again**, event `mk-retry` |
| `offline` | there is no network | **Try again**, event `mk-retry` |
| `denied` | the person has no access | with `resource="<extension>/<type>/<id>"`, **Request access**, event `mk-request-access` with `{ resource }`, which the shell answers ([Requests for access](access-requests.md)); none otherwise |

Each kind has its own icon, tone (`data-tone="problem"` for `failed`, `offline` and `denied`) and
default title and explanation; `heading`, the content and the slot `action` replace them. The
function `emptyStateText(kind)` of `@mosaikit/ui` gives the defaults.

## Resizable panes

```html
<mk-split-pane name="notes.list" width="320" min="200" max="560">
  <nav slot="pane" aria-label="Notes">…</nav>
  <article>…</article>
</mk-split-pane>
```

The person drags the handle between the pane and the rest, or focuses it and uses the arrow keys
(Shift for larger steps), Home and End. The width stays within `min` and `max` (default 160 and
640 pixels) and, with a `name`, is kept in the storage of the browser: the app opens with it at the
next visit. Choose a name unique in the installation, prefixed with the app (`notes.list`). Each
change dispatches `mk-pane-resize` with `{ width }`.
