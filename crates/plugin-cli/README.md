# mosaikit-plugin

The command-line tool of [Mosaikit](https://github.com/mosaikit) plugin developers. One executable does the
whole loop, with no dependency on the layout of the `mosaikit` repository: a plugin is a folder with a
`plugin.toml`, wherever it is.

```text
mosaikit-plugin doctor                       toolchain: Rust, the wasm32 target, Node
mosaikit-plugin new acme-reports             a standalone plugin folder (--variant, --example, --lang, --kit, --id, --into)
mosaikit-plugin build [dir] [--release]      logic (WASM) and UI; installs the wasm32 target if it is missing
mosaikit-plugin test [dir]                   validate, tests of the logic (native, mock host), type check, lint and tests of the UI
mosaikit-plugin pack [dir] [--key file]      build, validate, sign: dist/<id>-<version>.mskp
mosaikit-plugin validate [dir|file.mskp]     manifest, migrations (SQL allow-list), permissions, package integrity
mosaikit-plugin keygen --out publisher.key   a signing key pair (the public key goes in the server's trusted_keys)
mosaikit-plugin sign file.mskp --key k       sign a package again with another key
mosaikit-plugin install file.mskp --server <url> --user admin --password ... [--totp code]
mosaikit-plugin dev                          arrives with phase 4 (the bundled development server)
```

**Variants and examples.** `new --variant app|ui|service|extension|language|layout` (`app` is the default; a
language needs `--lang fr` or a name like `lang-fr`) and `new --example todo|insights|note-priority`, a complete commented
plugin with a `WALKTHROUGH.md`. The folder is standalone: own `Cargo.toml`, `ui/package.json`, `tsconfig.json`, `.oxlintrc.json`,
`.gitignore`, README, CI file, sample migration, tests and texts in English, Italian and Spanish.

**SDK and UI package.** Until a registry has them, `new` takes them from `--sdk-path` / `--plugin-api-path`
(`MOSAIKIT_SDK_PATH`, `MOSAIKIT_PLUGIN_API_PATH`), else from the folders `sdk/` and `plugin-api/` of the kit
(`--kit <folder>`, `MOSAIKIT_KIT`), else it asks for the published versions.

`validate` exits with 1 when it finds an error; warnings (old keys, no `[requires]`, an unsigned package) do not
change the exit code.

**Signing key.** `--key <file>`, else `MOSAIKIT_SIGNING_KEY` (base64), else `MOSAIKIT_SIGNING_KEY_FILE`, else a
development key that the tool makes once in the configuration folder of the user (`%APPDATA%\mosaikit\signing.key`,
`~/.config/mosaikit/signing.key`). A server installs a signed package only if it trusts the public key.

**`install`** signs in to the server as an Administrator (the same door as the shell, with the second factor if the
account has one) and uploads the package the way Plugins › Install from a file does. Give the address with its base
path (`http://localhost:8080/mosaikit`). The user and the password can come from `MOSAIKIT_ADMIN_USER` and
`MOSAIKIT_ADMIN_PASSWORD`.

`cargo xtask plugin new|build|pack|keygen` of the `mosaikit` repository call the same code (the `mosaikit_plugin_cli`
library) for the plugins of a distribution.

## Distribution (prepared, nothing is published)

- Archives per platform: `cargo build --release -p mosaikit-plugin-cli` on Windows, Linux and macOS, then zip the
  `mosaikit-plugin` executable with this README and a `SHA256SUMS` file. The release workflow that does it, and the
  choice of the registry (D1 of the plan), belong to phase 7.
- `cargo install mosaikit-plugin-cli`: the metadata is ready (`description`, `license`, `readme`, `include`). Before the
  first publish, `mosaikit-mskp` and `mosaikit-sql-guard` must be published too, and the workspace dependencies on them
  need a `version` next to their `path`.
- One version for the whole kit, on the cadence of the platform (D6): this crate takes the workspace version.
