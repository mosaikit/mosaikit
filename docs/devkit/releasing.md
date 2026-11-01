# Releasing the kit

For the people who publish the dev kit (the maintainers) and for whoever downloads and checks it. The kit is a GitHub
Release of `mosaikit/mosaikit`: one archive per platform, `SHA256SUMS`, and signatures.

## What a release holds

| File | What |
|---|---|
| `mosaikit-devkit-<version>-windows-x86_64.zip` | CLI and server (`bin/mosaikit-plugin.exe`, `bin/mosaikit-server.exe`) |
| `mosaikit-devkit-<version>-linux-x86_64.tar.gz`, `...-macos-aarch64.tar.gz` | CLI only; the development server comes from the Docker image |
| `<archive>.sig` | signature of that archive |
| `SHA256SUMS`, `SHA256SUMS.sig` | the hashes of every archive, and the signature of that file |

The server is in the archive only where the desktop server exists today (Windows). Elsewhere the kit has the Docker folder
`docker/` and the image `ghcr.io/mosaikit/mosaikit-dev:<version>` (the same image as the normal one; the compose file turns
the developer profile on).

Inside an archive: `bin/`, `sdk/` (the unpacked `.crate` of `mosaikit-plugin-sdk`), `plugin-api/` (the unpacked
`npm pack` tarball of `@mosaikit/plugin-api`), `docs/devkit/` (and `docs/api/sdk` with `--api-docs`), `examples/`,
`docker/`, `LICENSE`, `THIRD-PARTY-NOTICES.md`, `RELEASE-NOTES.md`, `COMPATIBILITY.md`, `VERSION`, `trusted_key.txt`,
`KIT.txt`.

## Make a release (maintainer)

1. Bump the versions (platform, SDK, UI packages) and write the changelogs: one `## <version>` section each; put what
   breaks under a `### Breaking changes` heading inside it (without one, the release notes say "None").
2. Tag `v<version>` and push the tag: `.github/workflows/release.yml` builds the kit on Windows, Linux and macOS
   (`cargo xtask release devkit`), tags the Docker image `-dev`, then signs `SHA256SUMS` over all the archives
   (`cargo xtask release devkit-sums`) and publishes the GitHub Release with the generated release notes. The signing key is
   the secret `MOSAIKIT_SIGNING_KEY`, the same as the official `.mskp` packages.
3. On one machine, the same command: `cargo xtask release devkit` (needs `MOSAIKIT_SIGNING_KEY`; `--allow-dev-key` for a
   trial with a key nobody trusts). It writes `dist/devkit/`.

Pieces on their own, with no build: `cargo xtask release devkit-notes --out <folder>` (release notes and the compatibility
table, generated from the manifests: versions, plugin API, `[requires]` of the examples and of the official plugins) and
`cargo xtask release devkit-notices --out <folder>` (third-party notices from `cargo metadata` and the npm licences; it
runs `cargo deny check licenses` when `cargo-deny` is installed, and fails on a licence outside `deny.toml`).

## Check a download

```
sha256sum -c SHA256SUMS --ignore-missing
mosaikit-plugin self-update --from-dir <folder with the files> --trusted-key <public key> --check
```

The first command checks the hash of the archive. The second verifies the signature of `SHA256SUMS` against the key you
pass (the public key of the official packages), then prints the breaking changes. A kit you already have holds the key
in `trusted_key.txt`.

## Update an installed kit

```
mosaikit-plugin self-update --check     # is there a newer release, and what does it break
mosaikit-plugin self-update             # download, verify, replace
mosaikit-plugin self-update --yes       # accept a new major version, or the breaking changes the release lists
```

It downloads the latest release (or `--version`), checks the signature of `SHA256SUMS` with the key of the installed kit
(`trusted_key.txt`, or `--trusted-key`, or `MOSAIKIT_KIT_KEY`), checks the hash, prints the "Breaking changes" of the
release notes, and refuses without `--yes` when there are some or the major version changes. It replaces `bin/` (the
running tool is renamed to `.old`), `sdk/`, `plugin-api/`, `docs/`, `examples/` and `docker/`. A tool installed with
`cargo install` is updated with `cargo install mosaikit-plugin-cli --force`. Plugins made with `--kit` point at the kit
folder: after an update run `mosaikit-plugin test` in each, and read the breaking changes first.

## `cargo install` and a private registry

`mosaikit-mskp` and `mosaikit-sql-guard` (the libraries of the tool) carry the metadata a registry needs (version, licence,
repository, readme, `include`), as do `mosaikit-plugin-sdk` and `mosaikit-plugin-cli`; the other crates are
`publish = false`. Publishing is a decision, not part of the release workflow. To publish to a private registry, in the
order of the dependencies:

```
cargo publish -p mosaikit-mskp --registry <name>
cargo publish -p mosaikit-sql-guard --registry <name>
cargo publish -p mosaikit-plugin-sdk --registry <name>
cargo publish -p mosaikit-plugin-cli --registry <name>

cd ui/plugin-api && npm publish --registry https://npm.example.com
```

(`<name>` is a registry of `.cargo/config.toml`.) Developers then depend on `mosaikit-plugin-sdk = { version = "1", registry =
"<name>" }` and on `@mosaikit/plugin-api`, and run `cargo install mosaikit-plugin-cli --registry <name>`. Nothing is
published by the commands of the kit. Until a registry has the packages, the kit carries them in `sdk/` and `plugin-api/`.
