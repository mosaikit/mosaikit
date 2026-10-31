# Walkthrough: expenses with an overview page

A plugin with a page of its own (an overview with a chart), a search that adds results, and a KPI. Make it again with
`mosaikit-plugin new {{name}} --example insights`.

## 1. The data (`plugin.toml`, `[[resources]]`)

The expenses: a title, an amount, a category, a date. `search = false` on the amount keeps numbers out of the text
the search looks into.

## 2. Two pages (`[[nav]]`)

`list` is a plain `mountCrud`. `overview` is a page the plugin draws itself. The shell opens `index.html` for both
and tells it which one in `msk.at`; `ui/src/main.ts` chooses.

## 3. The search (`[search]`, `find` in `src/lib.rs`)

The search box of the shell finds the expenses by title and text by itself. `[search] command` adds results of the
plugin's own: the kernel calls the command with `{ "q": "..." }` as the person searching, and the command answers
`{ "results": [{ "id", "snippet" }] }` where `id` is a resource id the shell opens. The text goes to the database as the parameter `$1`,
never glued into the SQL. The test checks that a short text asks nothing and that the parameter is sent apart.

## 4. The KPI (`migrations/001_kpi.sql`, `[[kpi]]`)

A view with `tenant_id`, the total and the count by category. `[i18n.<lang>.kpi.<view>.columns]` gives the columns
names in each language.

## 5. The logic (`src/lib.rs`)

- `before_save` refuses an amount that is not positive, with the code `amount_invalid`.
- `by_category` adds up in the database. Queries run with the security context of the person who calls, so the
  totals are those of the rows the person may see: nothing to filter by hand.
- Tests with `MockHost`: `hook`, `command`, `on("db.query", ...)` and `calls()` to check what was sent.

## 6. The page of our own (`ui/src/main.ts`, `chart.ts`)

- `pageHead` and `pageBody` give the same header and scrolling body as every page of Mosaikit.
- `msk.call("<table>.by_category")` fetches the totals; `barChart` draws them. A plugin UI loads nothing from outside,
  so the chart is plain SVG; `bars` (geometry) is a pure function, tested in `chart.test.ts` without a browser.
- With no data the page shows `emptyState`, with a main action (it adds a sample expense with `msk.crud(...).create`).
- Colours use the variables of the shell (`var(--acc)`, `currentColor`), so the chart follows the theme and the dark mode.

## 7. Build, test, pack

```
mosaikit-plugin test
mosaikit-plugin pack
```

## Things to try

- Add a filter by month to the overview (`msk.call` with arguments, a `where` in the SQL with `$1`).
- Add a second KPI with the total of the month.
- Notify the managers when an expense passes a limit: add `notify = true` to `[permissions]` and `ctx.notify(...)`.
