# Dependencies and release

Audit of the dependencies of Mosaikit at `d928843` (branch `review-sec`), with cargo-deny 0.20.2,
cargo-audit 0.22.2 (advisory database of 2026-10-23) and `npm audit`.

## Summary

| Check | Result |
|---|---|
| `cargo deny check` (advisories, bans, licenses, sources) | **ok** after the changes below (before: advisories and licenses failed) |
| `cargo audit` | **ok** with six documented exceptions (none reachable at run time) |
| tokio 1.54.0: RUSTSEC-2026-0384 (race in `Interval`) and yanked | **fixed**: updated to 1.54.1 |
| zip 2.6.1: RUSTSEC-2026-0367, -0368, -0369 | **not applicable**: they concern `ZipArchive::extract`, never called; exception documented, upgrade to zip ≥ 9 recommended |
| `npm audit`: root workspace (ui/host, ui/plugin-api, e2e) | **0 vulnerabilities** |
| `npm audit`: ../mosaikit-plugins (read only) | **0 vulnerabilities** |
| Desktop release build | **built**, starts headless and serves `/api/health` (see [Release](#release)) |

## Rust advisories

| Advisory | Crate | Reachable? | Action |
|---|---|---|---|
| RUSTSEC-2026-0384 (vulnerability) + yanked | tokio 1.54.0 | yes (runtime) | updated to 1.54.1 |
| RUSTSEC-2026-0367 / 0368 / 0369 (vulnerability) | zip 2.6.1 | no: only `ZipArchive::extract` and `ZipStreamReader::extract` are affected (symlinks, SUID bits). Mosaikit reads every archive entry by entry and checks each path (`blobs::extract_site`, `transfer::extract`, `mskp::Package::read`) | ignored with reason in `deny.toml` and `.cargo/audit.toml`; move to zip ≥ 9 (the reading API changed: `ZipFile::name()` returns a `Result`, entries are slices — a few dozen lines in mskp, kernel and xtask) |
| RUSTSEC-2024-0370 (unmaintained) | proc-macro-error 1.0.4 | no: build-time proc macro of `glib-macros`, through `gtk` → `tray-icon`, Linux desktop only | ignored with reason |
| RUSTSEC-2024-0429 (unsound) | glib 0.18.5 | no: `VariantStrIter` is not used; Linux tray only | ignored in `cargo audit` (cargo-deny does not see it on Windows targets) |
| RUSTSEC-2023-0071 (Marvin attack) | rsa | no: only in `Cargo.lock` through `sqlx-mysql`, never compiled (`cargo tree -i rsa` is empty) | ignored in `cargo audit` |

## Licenses and sources (`deny.toml`)

- **CC0-1.0** allowed: `notify` (file watching of the plugins in development) uses it; it is a
  permissive public-domain dedication.
- **Private crates ignored** (`[licenses] private = { ignore = true }`): `xtask` has no license field
  and is never published.
- **Sources**: only crates.io (`allow-registry`), no git dependency.
- **Bans**: 41 crates present in two versions, reported as warnings (mostly `windows-*`, `digest` 0.10/0.11,
  `getrandom`, `rand`): they come from the dependency tree, not from direct choices.
- **Wildcards** stay allowed: the crates of the workspace depend on each other by path and are not
  marked `publish = false`; marking them would let `wildcards = "deny"` guard crates.io dependencies.

## Outdated major versions (direct dependencies)

| Crate | In use | Latest | Risk of staying | Effort to move |
|---|---|---|---|---|
| zip | 2.6.1 | 9.0.5 | advisories (not reachable today) | medium: reading API changed |
| sqlx | 0.8.6 | 0.9.0 | low | high: database layer of PostgreSQL |
| rusqlite | 0.32.1 | 0.40.2 | low; bundled SQLite gets older | medium |
| sqlparser | 0.52.0 | 0.63.0 | medium: the SQL guard should follow the parser of the dialect | medium: AST changes in `sql-guard` |
| wasmi | 0.40.0 | 2.0.0 | low; performance and fixes | medium: runtime of the plugins |
| reqwest | 0.12.28 | 0.13.5 | low | low |
| argon2 | 0.5.3 | 0.6.0 | low (hashes stay compatible) | low |
| ed25519-dalek | 2.2.0 | 3.0.0 | low | low (signing of packages) |
| rand | 0.8.8 | 0.10.3 | low | medium (API) |
| sha2 / sha1 / hmac | 0.10 / 0.10 / 0.12 | 0.11 / 0.11 / 0.13 | low | low |
| base64 | 0.22.1 | 0.23.1 | none | low |
| notify | 6.1.1 | 8.2.0 | low (development only) | low |
| sysinfo | 0.33.1 | 0.39.6 | low | low |
| tray-icon | 0.21.3 | 0.26.1 | low; would drop the old gtk 0.18 chain on Linux | medium |

npm: everything at the latest major; only patch releases of `i18next` (26.5.6) and `react-i18next`
(17.1.3) are pending.

## Release

`cargo xtask release desktop` in the worktree (release profile, thin LTO): **built**.

| Check | Result |
|---|---|
| Bundle | `mosaikit-1.0.0-desktop-windows-x86_64`: 34 MB folder, 13 MB zip, `SHA256SUMS`; executable, commented configuration, branding, signed plugins and registry, `START.txt` |
| Start without the browser (`MOSAIKIT_OPEN_BROWSER=false`, no tray interaction) | listening on 48080/48081 within 2 s |
| `GET /api/health` | `200 {"ok":true,"dev":false,"version":"1.0.0"}` |
| Host page | `200`, CSP without inline scripts |
| Plugin UI (Notes) | `200`, `script-src` limited to `/ui/com.mosaikit.notes/` (fix M3 of the security review) |
| Sign-in of the first-start account (`locale` / `user`) | `200` |

The process was stopped and the release output deleted afterwards (`dist/` is not tracked).

## Follow-up (2026-10-23)

`zip` is now 9.0.5: the reading code was adapted (`ZipFile::name()` and `ZipArchive::file_names()` return
a `Result`; an entry whose name cannot be decoded refuses the archive). RUSTSEC-2026-0367, -0368 and
-0369 no longer apply and their exceptions are removed. `cargo deny check` and `cargo audit` are clean.
