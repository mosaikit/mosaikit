# @mosaikit/create-plugin

Creates a Mosaikit plugin (MK-023): the manifest, the app as a custom element and, with
`--backend`, the Java code, a database schema under row-level security and actions for
assistants. The plugin builds with Maven on the parent of plugins (MK-051) and is tested on the
bench of [`@mosaikit/testing`](../testing/README.md) (MK-050).

```bash
npx @mosaikit/create-plugin dev.acme.traffic --name "Traffic" --backend
cd traffic && npm install
npm run dev      # Mosaikit with the plugin, until Ctrl+C
mvn verify       # the package in target/, and the tests of tests/ on the bench
```

| File | Content |
|---|---|
| `manifest.yaml` | identity, frontend, contributions; with `--backend` also backend, schema and actions |
| `web/index.js`, `web/icon.svg` | the app, a custom element, and its icon |
| `pom.xml` | the parent `io.github.mosaikit:mosaikit-plugin-parent`; with `--backend` the APIs of the Java code |
| `package.json`, `playwright.config.ts`, `tests/` | the bench: `npm run dev`, and a first test for `npm test` |
| `src/`, `db/` | with `--backend`: entity, repository, REST resource, and the migration of the schema |
| `.github/workflows/ci.yml` | build, tests and release on GitHub, with the workflow of the Mosaikit organization |

| Option | Meaning |
|---|---|
| `--name` | human readable name (default: from the identifier) |
| `--backend` | add Java code, schema and actions |
| `--directory` | where to create it (default: the last part of the identifier) |
| `--author` | for the licence headers |
| `--mosaikit` | version of Mosaikit to build against: the parent POM and the test bench |

See the [plugin development guide](../../docs/development/plugin-development.md).
