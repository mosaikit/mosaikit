# @mosaikit/create-plugin

Creates a Mosaikit plugin (MK-023): the manifest, the app as a custom element and, with
`--backend`, the Java code, a database schema under row-level security and actions for
assistants, with a Maven build that produces the package to install.

```bash
npx @mosaikit/create-plugin dev.acme.traffic --name "Traffic" --backend
```

| Option | Meaning |
|---|---|
| `--name` | human readable name (default: from the identifier) |
| `--backend` | add Java code, schema and actions |
| `--directory` | where to create it (default: the last part of the identifier) |
| `--author` | for the licence headers |
| `--mosaikit` | version of `io.github.mosaikit:mosaikit-kernel-api` to compile against |

See the [plugin development guide](../../docs/development/plugin-development.md).
