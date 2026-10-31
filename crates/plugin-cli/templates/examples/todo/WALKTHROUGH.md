# Walkthrough: a to-do list

This is a complete plugin: data, rules, a list with a detail panel, pages in the navigation, a KPI and three
languages. It is made of about 250 lines you can read in order. Make it again with
`mosaikit-plugin new {{name}} --example todo`.

## 1. The data (`plugin.toml`, `[[resources]]`)

Declare the resource `{{table}}` with its fields. You do not write a table: the server creates it with the columns of the
fields plus what every plugin table has (`resource_id`, `tenant_id`, row-level security). Every row is a kernel
resource, so an item has an owner and can be shared, trashed, found by the search of the platform, and (with
`due_field` and `done_field`) listed in the Home of the person while it is due.

## 2. The pages (`[[nav]]`)

Three entries in the navigation of the shell: Open, Done, All. The shell opens the same `index.html` for each and
tells it which one in `msk.at`.

## 3. The permissions (`[permissions]`)

`hooks = ["{{table}}"]` lets the logic run before a task is saved. Everything else is off: no files, no network.
A plugin gets only what its manifest asks for, and the Administrator sees the list when installing it.

## 4. The KPI (`[[kpi]]` and `migrations/001_kpi.sql`)

A KPI is a database view with a `tenant_id` column; the other columns are the numbers. The migration creates it,
the manifest names it and gives it a label. Managers and the Administrator see it in the KPI pages. Migrations run
only in the schema of the plugin, on PostgreSQL and on SQLite: write SQL both accept (`mosaikit-plugin validate`
checks it against the allow-list of the server).

## 5. The logic (`src/lib.rs`)

- `before_save` is a hook: it receives the values of the task, trims the title, gives a default priority, or
  refuses with a coded error (`title_required`). It is registered for `before_create` and `before_update`.
- `counts` is a command: the UI (or another plugin) calls it with `msk.call("{{table}}.counts")`.
- The tests at the bottom run natively with `MockHost`, which stands in for the server: `hook` and `command`
  call your functions, `on("db.query", ...)` answers a database call. Run them with `mosaikit-plugin test`.

## 6. The UI (`ui/src`)

- `main.ts` calls `mountCrud`, which draws the page from the manifest. The options say what is specific to tasks:
  `columns`, `where` (the page of the navigation), `views` (a list and cards, which adds a switch), and `empty`
  (the empty state: a picture, a title, a text and the main action).
- `item` draws a task in the list: a check box that saves `done` with `ctx.update`, the title, a chip with the
  due date (red when overdue).
- `tasks.ts` holds the rules that need no screen (`isOverdue`, `pageFilter`), so `tasks.test.ts` tests them with
  `vitest` and no browser.
- `i18n.ts` has the texts in English, Italian and Spanish; the language comes from the host
  (`msk.context.lang`) and the page is drawn again when it changes. The names of the fields, pages and KPIs are
  translated in `plugin.toml` (`[i18n.it]`, `[i18n.es]`).

## 7. Build, test, pack

```
mosaikit-plugin test             # validate, cargo test, tsc + vitest of the UI
mosaikit-plugin pack             # a signed dist/{{id}}-0.1.0.mskp
```

## Things to try

- Add a field `project` of kind `text` and show it in `columns`.
- Add a third view of kind `board` with the columns Open and Done (`CrudView.columns`).
- Make `before_save` refuse a due date in the past.
