# Plugins

Platform plugins and samples. Each directory is a plugin with a `manifest.yaml` at its root
(see `sdk/java/src/main/resources/dev/mosaikit/kernel/api/plugin/plugin-manifest.schema.json`),
and a `pom.xml` that builds its package, `target/<name>-<version>.zip`, with only what the kernel
needs (manifest, `lib/`, `db/`, `web/`; see `plugin-package.xml`). The packages are also copied
to `target/dist/plugins`. In development mode the kernel loads every plugin in this directory.

| Plugin | Purpose |
|---|---|
| `app-chat` | Chats one to one and in groups, with history, typing and reading, and cards of plugins (MK-036). |
| `app-teams` | Teams with channels, posts, threads, mentions and reactions, without a backend (MK-034). |
| `sample-hello` | Minimal frontend-only app without any framework. Shows the plugin context and the event bus. |
| `sample-notes` | Java plugin with an entity, a migration, a REST API, an app and actions for assistants (MK-011, MK-015). |
| `sample-activities` | The test app of the prototype (MK-020): table under row-level security, a data contract view, the extension point `activities.detail`, actions for assistants. |
| `sample-estimates` | Extension of Activities: a field in its own table, a widget contributed to `activities.detail`, events on the bus; no foreign key. |
| `sample-react` | App written with React, bundled with Vite into one module; declares the `palette.preview` point and publishes `palette.selected` (MK-021). |
| `sample-vue` | Extension written with Vue: a swatch contributed to `palette.preview`, which follows `palette.selected` (MK-021). |

To start a new plugin, use the generator in [`sdk/create-plugin`](../sdk/create-plugin/README.md).
