# Testing

Three levels, from cheap to complete: static conformance, unit tests, end to end against the development server.

```
mosaikit-plugin test [dir]
```

runs `validate --strict`, then `cargo test` of the logic, then the type check, `lint` and `test` scripts of the UI where
they exist. It exits with 1 when anything fails.

## 1. `validate --strict`: the conformance suite

```
mosaikit-plugin validate [dir | file.mskp] [--strict]
```

Without `--strict` it checks the manifest, the migrations against the SQL allow-list of the server, the permissions, the
package integrity and signature, and the entry pages. **With `--strict`** it is the suite a plugin passes before it is
proposed to an Administrator. It is static: no server, no browser. Errors make it exit with 1; warnings (old keys, no
`[requires]`, an unsigned package) do not.

| Check | How |
|---|---|
| Manifest | the schema (unknown keys refused); `description`, `author` and `license` required |
| Permissions against the logic | in a folder the Rust source (`src/**/*.rs`, up to `#[cfg(test)]`, comments left out) is scanned for `.files()`, `.notify(`, `.call_plugin("id"`, `.http()`, `.service_key(` and literal host operation names; in a package `logic.wasm` is scanned for the literals the SDK links in (`files.*`, `plugin.call`, `http.fetch`, `key.get`; `notify` has none, so it is checked in the source only). A call without its permission is an error; `files_read`, `notify` or `calls` asked for and never used are errors; a listed hook with no registered `"<resource>.<hook>"` is an error; `network` unused is a warning |
| Migrations | numbered from 001 with no gap or duplicate, lower-case names, no `drop table`, `drop column`, `truncate`, SQL accepted by the guard of PostgreSQL (own schema only) and by the SQLite translation |
| UI | at most 10 MiB; no script, `<link>`, image, frame or media from an outside origin, no `url()` or `@import` of one, no `fetch`, `import()`, `WebSocket`… towards an outside literal address unless declared in `network` or `frame_src`; nothing the CSP blocks (inline `<script>`, `on...=` handlers, `javascript:`); `eval` and `new Function` are a warning without `script_eval`; the entry page has a title, a charset and a viewport |
| i18n | every declared `[i18n.<lang>]` covers `description`, `details`, label, resources and visible fields, navigation, KPIs and user permissions (a language plugin is exempt) |
| Layout contract of `mountCrud` pages | on the source, best effort: the resource of the call is declared, the UI imports `@mosaikit/plugin-api/style.css` and calls `connect()`, the page has a `title` option (warning), an own `<table>` instead of `gridTable` is a warning |

Not covered by it: the accessibility smoke test (below) and anything that needs a running server.

## 2. Unit tests of the logic: `MockHost`

The logic compiles natively for tests (`cargo test`); `MockHost` plays the host ([Logic reference](logic.md)). The template
has working examples.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mosaikit_plugin_sdk::testing::{FakeFile, MockHost};

    #[test]
    fn a_hook_sets_the_default() {
        let host = MockHost::new();
        let v = host.hook(&__msk_registry(), "before_create", "notes", json!({ "title": "x" })).unwrap().unwrap();
        assert_eq!(v.str("tag"), "personal");
    }

    #[test]
    fn the_error_keeps_its_code() {
        let host = MockHost::new().with_perms(&["use"]);       // the caller may not export
        let err = host.command_err(&__msk_registry(), "notes.export", json!({})).unwrap_err();
        assert_eq!(err.code.as_deref(), Some("export_not_allowed"));
    }
}
```

Recipes (the module documentation has them all):

| To test | Do |
|---|---|
| `db.query`, `db.exec` | `.on("db.query", \|req\| { assert_eq!(req["params"][0], "work"); Ok(json!([…])) })` |
| `notify` | nothing to program; read `host.notifications()`. A refusal: `.on("notify", \|_\| Err("…".into()))` |
| `call_plugin` | `.with_plugin_command("com.example.other", "other.total", \|args\| Ok(json!({ "total": args["n"] })))` |
| permissions | `.with_perms(&["use", "export"])`; an operation the manifest does not allow: `.deny("files.read", "…")` |
| groups | `.with_groups(&[("g1", "Field")])` |
| the Files area | `.with_files(vec![FakeFile::folder("d1", "Reports"), FakeFile::file("f1", "a.txt", b"hello").in_folder("d1")])` |
| what was asked | `host.calls()`, `host.logs()` |

An operation with no answer fails the call with `MockHost: no answer for <op>`: a test that forgets one fails loudly.
The pure rules of the UI (formatting, filters, dates) belong in plain TypeScript modules tested with `vitest`, with no
browser (`tasks.test.ts` in the `todo` example).

## 3. End to end: `@mosaikit/plugin-testing`

Playwright helpers that drive the plugin in a real shell against the development server (`mosaikit-plugin dev`).
The package ships TypeScript source; Playwright runs it as it is. Peer dependencies: `@playwright/test` and, optional,
`@axe-core/playwright`.

```ts
import { test, expect } from '@playwright/test'
import { attachDevServer, signIn, openPlugin, createItem, expectAccessible } from '@mosaikit/plugin-testing'

test('Alice creates a note', async ({ page }) => {
  const dev = await attachDevServer()               // MOSAIKIT_DEV_URL, else http://localhost:8080/
  await signIn(page, dev.url, 'alice')
  const frame = await openPlugin(page, dev.url, 'com.example.notes')
  const row = await createItem(frame, { title: 'Plan the week' })
  await expect(row).toContainText('Plan the week')
  await expectAccessible(page)                      // axe: serious and critical violations of the page and the plugin frame
})
```

| Function | What |
|---|---|
| `startDevServer({ plugin, port, fresh, … })` | starts `mosaikit-plugin dev --no-open --no-watch` for a folder, waits for the address and `/api/health`; `stop()` ends it. The tool is `MOSAIKIT_PLUGIN_BIN` or `mosaikit-plugin` |
| `attachDevServer(url?)` | uses a running server (`MOSAIKIT_DEV_URL`, the Docker kit); refuses one that is not in the developer profile |
| `signIn(page, app, user)` | `admin`, `manager`, `alice` or `bob` (tenant `dev`, password `mosaikit-dev`: `DEV_USERS`, `DEV_PASSWORD`) |
| `openPlugin(page, app, pluginId)` | opens the plugin in the shell and returns the frame of its UI |
| `createItem(frame, { title })` | in a `mountCrud` page: New, fills the fields by key, Save; returns the row |
| `accessibilityViolations`, `expectAccessible`, `formatViolations` | the axe smoke test |
| `pluginUrl`, `waitForHealth`, `devArgs`, `parseDevOutput`, `freePort` | small pieces for tests that do things their own way |

The shell is driven in English, so the labels the helpers click are the English ones. They work only against a server in
the developer profile. To test sharing or roles, sign in as `bob` or `manager` in another context.

## CI recipes

The generated folder has `.github/workflows/ci.yml`, with the steps that apply to its variant. It needs no checkout of
Mosaikit; `mosaikit-plugin` and the two packages of the kit come from the folder the repository variable `MOSAIKIT_KIT`
names (it has `bin/`, `sdk/` and `plugin-api/`) until a public registry has them:

```yaml
env:
  MOSAIKIT_KIT: ${{ vars.MOSAIKIT_KIT }}
steps:
  - uses: actions/checkout@v4
  - run: echo "$MOSAIKIT_KIT/bin" >> "$GITHUB_PATH"
  - run: mosaikit-plugin validate                    # add --strict to enforce the conformance suite
  - uses: dtolnay/rust-toolchain@stable
    with: { targets: wasm32-unknown-unknown }
  - run: |                                           # point Cargo at the SDK of the kit
      mkdir -p .cargo
      printf '[patch.crates-io]\nmosaikit-plugin-sdk = { path = "%s/sdk" }\n' "$MOSAIKIT_KIT" > .cargo/config.toml
  - run: cargo test
  - run: mosaikit-plugin build --release
  - uses: actions/setup-node@v4
    with: { node-version: 24 }
  - working-directory: ui                            # point npm at the UI package of the kit
    run: |
      npm pkg set "dependencies.@mosaikit/plugin-api=file:$MOSAIKIT_KIT/plugin-api"
      npm install --no-audit --no-fund
      npm run typecheck && npm run lint && npm test
```

To publish from CI add `mosaikit-plugin pack --release` with the key in `MOSAIKIT_SIGNING_KEY` (a repository secret,
base64). For the end-to-end level start `mosaikit-plugin dev --no-open --no-watch` in the background and attach with
`MOSAIKIT_DEV_URL`; for PostgreSQL use the Docker kit.

## What to test, in short

- Every hook and command: the happy path and each refusal with its **code**.
- Every permission-dependent branch (`with_perms`).
- Every host call the logic makes (`calls()` shows what it asked).
- Rules of the UI as plain functions; one end-to-end test per page that opens, creates and checks accessibility.
- `validate --strict` in CI on every change.
