# Packaging and signing

How a plugin becomes a `.mskp` package an Administrator can install. Architecture §8.5 to §8.8 and §10.

## The package

```
mosaikit-plugin pack [dir] [--key file] [--release] [--out folder] [--no-build]
```

`pack` builds the logic and the UI, validates, signs and validates the result: `dist/<id>-<version>.mskp`. Default is a
debug build of the logic; use `--release` for what you ship.

A `.mskp` (version 3) is a zip with:

| File | What |
|---|---|
| `plugin.toml` | the manifest |
| `logic.wasm` | the logic (optional) |
| `ui/**` | the built UI (`ui/dist` of the folder) |
| `migrations/NNN_name.sql` | the migrations |
| `media/**`, `layout/**`, `lang/**` | screenshots, a layout, a language pack, where the kind has them |
| `MANIFEST.sha256` | the hash of every file |
| `SIGNATURE` | JSON `{ key, sig }`: the public key and the ed25519 signature of `MANIFEST.sha256` |

Limits: the package at most 64 MiB, a file at most 64 MiB, 256 MiB unpacked, 5000 files; paths safe on every platform;
migration names `NNN_name.sql`, no duplicate numbers; every screenshot named in the manifest must be in `media/`.

## Keys

```
mosaikit-plugin keygen --out publisher.key     # prints the public key; never overwrites an existing file
mosaikit-plugin sign file.mskp --key other.key # sign again, or sign an unsigned package (--out to keep the original)
```

The key used by `pack` and `sign` is, in order: `--key <file>`, `MOSAIKIT_SIGNING_KEY` (base64),
`MOSAIKIT_SIGNING_KEY_FILE`, else a development key the tool makes once per user (`%APPDATA%\mosaikit\signing.key`,
`~/.config/mosaikit/signing.key`). Keep the private key out of every repository; give CI the base64 in a secret.

## Trusted keys

A server installs a package only if its signature verifies and the **public key is trusted**. The Administrator adds the
publisher's public key (the one `keygen` printed) to the configuration:

```toml
# mosaikit.toml
trusted_keys = ["<base64 ed25519 public key>"]
```

or `MOSAIKIT_TRUSTED_KEYS="key1, key2"`. Revoking a publisher is removing the key. An unsigned package needs
`allow_unsigned = true`, which is for development only and flags the package; the developer profile sets it. The
errors are `unsigned package` and `publisher key not trusted: <key>`.

## Install

- The Administrator: Plugins › **Install from a file**, or from the catalog.
- You, against a test server: `mosaikit-plugin install file.mskp --server http://localhost:8080 --user admin --password …
  [--totp code]` (`MOSAIKIT_ADMIN_USER`, `MOSAIKIT_ADMIN_PASSWORD`). The address carries its base path if the server has
  one.

At install the host recomputes every hash, checks the signature and the blocklist, checks `[requires]` against its
version and API, applies the migrations in one transaction and, if anything fails, rolls everything back.

## Versions and updates

`version` is `MAJOR.MINOR.PATCH`. Installing a newer version keeps the plugin's state, its settings and the choices of the
tenants; its new migrations run in the same transaction as the update. **A downgrade is refused** (`downgrade not
allowed`). A plugin loaded from a folder in development cannot be installed over (`is loaded in development mode`).
Declare `[requires] mosaikit` and `api` so the Administrator sees why an update does not fit
(`plugin_incompatible`; Plugins › Updates shows the reason).

Uninstalling shows first what goes away (items, tenants, extensions that stop working), then removes the schema, items,
files, settings and secrets of the plugin.

## The registry `index.json`

A catalog of the plugins the installation trusts, set with `registry = "registry/index.json"` in the configuration (the
release carries a copy for offline installs). It serves to install from a trusted source, check integrity, show updates
and revoke versions.

```json
{
  "plugins": [
    { "id": "com.acme.notes", "name": "Notes", "description": "…", "icon": "…",
      "versions": [
        { "version": "0.3.0", "file": "plugins/com.acme.notes-0.3.0.mskp", "sha256": "…", "publisher": "<base64 key>",
          "notes": "what changes", "kind": "app", "extends": null, "mosaikit": ">=1.0, <2", "api": 1 }
      ] }
  ],
  "blocklist": [ { "id": "com.acme.notes", "version": "0.2.0", "sha256": null, "reason": "data loss" } ]
}
```

`file` is relative to the folder of `index.json`. `notes` (plain text) comes from `RELEASE.md` of the plugin when the
repository build makes the index; the Updates list shows the notes of the versions newer than the installed one.
`mosaikit` and `api` copy `[requires]`, so the catalog can mark a version that cannot be installed.

**Blocklist.** An entry names a plugin, a `version` (absent: all) and optionally a `sha256`, with a `reason`. A blocked
package is refused at install (`<id> <version> is in the blocklist of the registry`); that is the revocation of a
compromised version.

## Release checklist

1. `mosaikit-plugin test` (validate --strict, tests of the logic and the UI).
2. Raise `version`; write the notes (`RELEASE.md`).
3. `mosaikit-plugin pack --release --key <publisher key>`.
4. Install on a developer server, and on the Docker kit when you use PostgreSQL features.
5. Publish the `.mskp` and its `sha256`; tell the Administrator the public key.
