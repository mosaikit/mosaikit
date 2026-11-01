# Concepts

What a plugin author needs to know about the platform. The full text is in [../architecture.md](../architecture.md)
(§3 tenants and roles, §4 resources, §8 plugins).

## Tenants and roles

A **tenant** is a workspace with its own people, data and settings. Three roles:

| Role | Scope | In short |
|---|---|---|
| Administrator | the installation | installs plugins, makes them available to tenants, never sees content; signs in on its own page |
| Tenant Manager | one tenant | people, groups, permission profiles, turns plugins on and sets their permissions; sees metadata, never content |
| User | one tenant | creates items, shares them, uses what is shared |

A plugin runs for a **caller** in a **tenant**: every call carries the user, the tenant and the permissions of that
person. A plugin never sees another tenant, and never runs as an anonymous service.

## Resources, ownership and sharing

Every item a plugin keeps (a note, a task, a file) is a **resource** of the kernel: tenant, plugin, kind, title, owner
and, optionally, a parent. The kernel does ownership and sharing, so the plugin does not:

| Level | Value | Allows |
|---|---|---|
| read | 1 | see the item and its content |
| write | 2 | change it, create children |
| manage | 3 | share, revoke, public links, move, delete |

The owner has manage. Grants go to users and groups of the tenant; the effective level is the highest between the item
and its ancestors. The share dialog belongs to the host: the UI opens it with `msk.share(id)`.
Every row of a plugin table is protected by row level security with these rules ([Data](data.md)), so a query returns
only what the caller sees.

A row of the CRUD of a plugin has `my_level` (`read`, `write`, `manage`), `owner_id`, `owner_name`, `shared`,
`parent_id`, `created_at`, `updated_at`.

## Permissions

Every plugin has four standard permissions, enforced by the kernel: `use`, `create`, `delete`, `share`. A refusal is
`403` with code `missing_permission`. The manifest may add its own with `[[user_permissions]]`, enforced by the plugin
(`ctx.can("export")` in the logic, `msk.can("export")` in the UI). A Tenant Manager may do everything; other people get
the permissions of their **permission profile**, plus grants. Permissions never widen what a person sees: access to
items stays the one of the ACL.

A plugin must also be **on**: the Administrator makes it available to the tenant, the Tenant Manager turns it on. A plugin
that is off answers `404` with code `plugin_off`.

## Settings on three levels

| Level | Who | In the plugin |
|---|---|---|
| Platform | the Administrator | `[[config]]` settings (Plugins › Configuration), read in the logic as `ctx.setting("key")`; secrets are encrypted |
| Tenant | the Tenant Manager | the permissions of the plugin, whether it is on |
| Personal | each person | keys of outside services (`[[service_keys]]`), notification choices |

Keys of outside services exist at three scopes (`platform`, `tenant`, `personal`); `ctx.service_key("id")` returns the
one in use for the caller: their own, else the tenant's, else the platform's.

## Kinds of plugin

| Kind | What | Code |
|---|---|---|
| `app` | pages of its own; in the sidebar and the Home | logic and UI |
| `service` | works behind the scenes: logic, hooks, KPIs | logic |
| `extension` | adds fields, actions and tabs to another plugin | manifest, optional logic and UI |
| `layout` | arranges the slots of the shell | declarative files, never code |
| `language` | a language of the interface | texts, never code |

See [Manifest reference](manifest.md) for the rules of each, and [Extensions and layouts](extensions-layouts.md).

## What a plugin may do

- Declare resources (fields) and get the table, the CRUD, the search, sharing, trash and KPIs from the platform.
- Run Rust logic as WebAssembly: hooks before create or update and after delete, and commands the UI or another plugin
  calls. It runs in the same transaction as the operation; an error rolls back everything.
- Query its own schema with SQL checked by the guard, with the role of the plugin and row level security.
- Ask the host for more only when the manifest says so: notifications (`notify`), reading the Files area as the caller
  (`files_read`), calls to other plugins (`calls`), outside web origins (`network`, `frame_src`), run-time code
  (`script_eval`).
- Draw a UI in an iframe that talks to the host through the bridge.

## What a plugin may not do

- Read the tables of another plugin or the schema `core`; call SQL outside the allow-list.
- Name the recipients of a notification, read a secret back, or reach the network outside the declared origins.
- Run code in the shell, read its cookies or storage: the UI lives on an untrusted origin ([Security](security.md)).
- Change the platform or another tenant, or run unlimited work: instructions, memory and message size are limited
  ([Logic reference](logic.md)).

## The plugin API

The contract between a plugin and the kernel has one number, the **plugin API** (now 1). A plugin says which one it was
built for and which Mosaikit versions it works with in `[requires]`; the kernel refuses any other. A deprecated item
stays for one major version. Part of the surface is **experimental** (architecture §8.11; list in
[Changelog and compatibility](changelog.md)).
