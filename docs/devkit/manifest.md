# Manifest reference

`plugin.toml` at the root of the plugin. It is read with **unknown keys refused** in every table: a misspelt key is an
error, and a kernel that does not know a key rejects the manifest. Source of truth: `crates/mskp/src/manifest.rs`;
`mosaikit-plugin validate` applies the same rules before you install.

Identifiers (resource names, field keys, view names, permission keys): lower case letter first, then lower case
letters, digits and `_`, at most 48 characters. Icon names: lower case, digits and `-`, at most 48 characters
(a name of the Lucide set; an unknown name draws a default icon).

## A complete manifest

```toml
id = "com.acme.notes"
name = "Notes"
version = "0.3.0"
description = "Personal and shared notes"
author = "Acme"
license = "Apache-2.0"
kind = "app"
icon = "notebook-pen"

[requires]
mosaikit = ">=1.0, <2"
api = 1

[[resources]]
name = "notes"
title_field = "title"
fields = [
  { key = "title", label = "Title", kind = "text", required = true },
  { key = "tag",   label = "Tag",   kind = "choice", options = ["personal", "work"] },
]

[ui]
entry = "index.html"

[permissions]
hooks = ["notes"]

[[kpi]]
view = "kpi_notes_by_tag"
label = "Notes by tag"
```

## Top level

| Key | Type | Rule |
|---|---|---|
| `id` | string, required | at least two segments separated by `.`, each lower case letters, digits and `-` (no leading `-`), at most 64 characters: `com.acme.notes` |
| `name` | string, required | not empty |
| `version` | string, required | `MAJOR.MINOR.PATCH`. A newer version updates an installed one; a downgrade is refused |
| `description` | string | shown in the catalog; required by `validate --strict` |
| `author`, `license` | string | at most 120 and 80 characters; required by `validate --strict` |
| `homepage` | string | an `http://` or `https://` address, no spaces, at most 300 characters |
| `details` | string | the long text of the plugin page, at most 4000 characters; a blank line separates paragraphs |
| `screenshots` | array of strings | up to 8 file names of `media/` (letters, digits, `- _ .`; extension `png`, `jpg`, `jpeg`, `webp`, `svg`); each must be in the package |
| `kind` | `app`, `service`, `extension`, `layout`, `language` | see Kinds. Absent: `extension` with `[extends]`, else `app` with `[ui]`, else `service` (a rule kept for old manifests) |
| `icon` | string | icon of the shell |
| `abi`, `min_kernel` | | **deprecated**, see `[requires]` |

### Kinds

| Kind | Needs | Refused |
|---|---|---|
| `app` | normally `[ui]`; may have `[[nav]]` | |
| `service` | | `[[nav]]` |
| `extension` | `[extends]` | `[[nav]]`; `[extension]` is only for this kind |
| `layout` | files in `layout/` | `[[resources]]`, `[ui]`, `[[kpi]]`, `[search]` |
| `language` | `[language]` | `[[resources]]`, `[ui]`, `[[kpi]]`, `[search]`, `[[nav]]`, `[extension]` |

`[extends]` is only for `extension`, and `[language]` only for `language`.

## `[requires]`

Optional. Without it the plugin accepts any version and the current API, and `validate` warns.

| Key | Type | Rule |
|---|---|---|
| `mosaikit` | string | a range of Mosaikit versions: comma-separated comparators `>=`, `>`, `<=`, `<`, `=`, `^`, `~`; a bare version is `^`, so `"1.2"` means `>=1.2, <2`. Example `">=1.2, <2"` |
| `api` | integer | the plugin API the plugin was built for, 1 or more. Another value than the kernel's is refused with `plugin_incompatible` naming both |
| `database` | `"postgres"` | the plugin uses PostgreSQL features: it does not install on SQLite. Any other value is an error |
| `extensions` | array of identifiers | PostgreSQL extensions that must be installed (e.g. `["postgis"]`); needs `database = "postgres"` |

The old `abi` (the API) and `min_kernel` (a lower bound `MAJOR.MINOR.PATCH`) still work for one major version when
`[requires]` does not say; a plugin loaded from its folder in development logs a warning for each.

## `[contribution]`

Optional, kept for older hosts: `icon` (an emoji) and `label`. Absent, the label is the `name` and the icon a default
one. The shell uses `name` and `icon`.

## `[[resources]]`

Declares the items the platform keeps for the plugin. The host creates the table (named like the resource) with the
columns of the fields, plus `resource_id`, `tenant_id`, the foreign key and the row level security, and gives you the
CRUD, the search, sharing, trash and the `crud.*` calls of the UI.

| Key | Type | Rule |
|---|---|---|
| `name` | identifier, required | unique in the plugin; may not start with `kpi_` |
| `label` | string | shown in the UI |
| `title_field` | string | a field of the resource; default the first `text` field |
| `due_field` | string | a `date` field: the kernel copies it, and the Home of a person lists what is due soon |
| `done_field` | string | a `bool` field: a done item is no longer due |
| `fields` | array, required | at least one |

### Fields

| Key | Type | Rule |
|---|---|---|
| `key` | identifier, required | unique in the resource; not `resource_id`, `tenant_id`, `id`, `owner`, `my_level` |
| `label` | string | |
| `kind` | `text`, `number`, `bool`, `date`, `choice`, required | SQL types: `text`, `double precision`, `boolean`, `date`, `text`. A field that already exists cannot change type |
| `required` | bool | |
| `multiline` | bool | for `text` |
| `options` | array of strings | required (not empty) for `choice` |
| `option_labels` | table value to label | each key must be one of `options`; the stored value stays the option |
| `hidden` | bool | computed (for example by a hook): not shown in forms or sorted by the UI; kept for extensions |
| `search` | bool | whether the search of the shell looks into it. Absent: yes for visible `text` fields, no otherwise |

Adding a field to a resource of an installed plugin adds a column on update; the new key must not collide.

## `[ui]`

| Key | Rule |
|---|---|
| `entry` | the page of the UI, relative to `ui/dist`; default `index.html` |
| `public_view` | optional viewer for public links, relative to `ui/dist` |

Both are safe relative paths (no `..`, no absolute path, no `\`, no `:`, no names Windows reserves).

## `[permissions]`

Everything is off by default. The Administrator sees what a plugin asks for when it is installed.

| Key | Type | What it allows |
|---|---|---|
| `hooks` | array of resource names | the logic receives hooks on these resources; each must be declared |
| `files` | bool | the file and folder API with content on disk (the plugin owns files) |
| `content` | bool | folder content uploaded from a zip (sites) |
| `network` | array of origins | origins the logic reaches with `http.fetch` and the UI with `connect-src`: `https://example.com`, no path |
| `frame_src` | array of origins | origins the UI may embed |
| `web` | bool | the UI may call `msk.web.probe(url)` and embed any web site (`frame-src https: http:`) |
| `calls` | array of plugin ids | plugins whose commands the logic calls with `plugin.call`; not itself |
| `notify` | bool | the logic may send notifications (`ctx.notify`) |
| `files_read` | bool | the logic reads the Files area as the caller. **Sensitive** |
| `script_eval` | bool | the CSP of the UI allows `'unsafe-eval'` and `'wasm-unsafe-eval'`. **Sensitive** |

An origin is `http://` or `https://` and a host of letters, digits and `.-:[]`, with no `/`.
`validate --strict` compares the permissions with what the logic calls: a call with no permission is an error, and so is
`files_read`, `notify` or `calls` asked for and never used.

## `[[kpi]]`

| Key | Rule |
|---|---|
| `view` | the name of a view of the plugin, starting with `kpi_`; it must exist after the migrations, with a `tenant_id` column |
| `label` | required |
| `columns` | optional labels of the columns of the view |

Only the reporting role reads `kpi_*` views.

## `[[nav]]`

Pages of an `app` in the navigation of the shell. At most 40 entries, two levels.

| Key | Rule |
|---|---|
| `id` | identifier, unique |
| `label` | 1 to 60 characters |
| `icon` | icon name |
| `place` | letters, digits, `-`, `_`, at most 64: where the app opens (`msk.at`); absent: the `id`. An entry with children and no `place` is only a group |
| `parent` | the `id` of another entry that has no parent |
| `permission` | a standard permission or a declared `[[user_permissions]]` key; the entry is shown only to who has it |

## `[[user_permissions]]`

| Key | Rule |
|---|---|
| `key` | identifier, unique, not `use`, `create`, `delete`, `share` |
| `label` | required |
| `description` | |
| `default` | bool, default `true`: given by the profiles that do not list the plugin |

Experimental, together with `ctx.can`.

## `[[service_keys]]`

Keys of outside services the plugin uses, shared with other plugins that declare the same `id`.

| Key | Rule |
|---|---|
| `id` | lower case letters, digits and `-`, at most 40, not starting or ending with `-` |
| `label` | required |
| `description` | |
| `address` | bool: the value is an address (a self-hosted model), shown whole; `http.fetch` may reach it |
| `scopes` | subset of `platform`, `tenant`, `personal`, not empty, no repeats; default all three |

## `[[config]]`

Settings the Administrator sets for the platform (Plugins › Configuration). Experimental.

| Key | Rule |
|---|---|
| `key` | identifier, unique |
| `label` | required |
| `description` | |
| `kind` | `text`, `number`, `bool`, `choice`, `secret` |
| `options` | required for `choice` |
| `default` | must fit the kind; not allowed for `secret` |

## `[search]`

`command = "<name>"`: a command of the logic (a plain identifier, no dots) that adds results to the search of the
shell. It receives `{ "q": "..." }` and answers `{ "results": [{ "id", "snippet" }] }`. Experimental. Not for layouts and
languages.

## `[extends]` and `[extension]`

For `kind = "extension"`: `[extends] plugin = "<id>"`, `min_version = "MAJOR.MINOR.PATCH"` (default `0.0.0`);
`[[extension.fields]]`, `[[extension.actions]]`, `[[extension.tabs]]`. Details in
[Extensions and layouts](extensions-layouts.md).

## `[language]`

For `kind = "language"`: `code` (two or three lower case letters, not `en` or `it`) and `name` (at most 60 characters).

## `[i18n.<lang>]`

Translations of the manifest. `<lang>` is two or three lower case letters, not `en` (English is the manifest itself).
Every key is optional and falls back to English; a key that names something the manifest does not have is an error,
and no text is longer than 300 characters.

```toml
[i18n.it]
name = "Note"
description = "Note personali e condivise"
label = "Note"                       # the contribution label
[i18n.it.resources.notes]
label = "Note"
fields = { title = "Titolo" }
options.tag = { personal = "personale", work = "lavoro" }
[i18n.it.kpi.kpi_notes_by_tag]
label = "Note per tag"
columns = { notes = "note" }
[i18n.it.permissions.export]         # a [[user_permissions]] key
label = "Esportare"
```

Also: `details`, `nav.<id>`, `config.<key>` and `service_keys.<id>` (`label`, `description`),
`extension = { fields = {...}, actions = {...}, tabs = {...} }`. The values of fields stay identifiers; a plugin that
translates stored values converts them with a migration. The shell sends its language with every request
(`Accept-Language`). `validate --strict` requires a declared language to cover everything the English manifest has.

## Files of the package

```
plugin.toml  logic.wasm  migrations/NNN_name.sql  ui/**  media/**  layout/**  lang/**
```

Migrations are `NNN_name.sql`, numbered from 001 with no gap or duplicate ([Data](data.md)). Paths are safe relative
paths on every platform. Limits of a package: [Packaging and signing](packaging.md).
