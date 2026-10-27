# Security review

Review of Mosaikit at `d928843` (branch `prototipo-shell`, all phases and follow-ups merged): kernel,
server, host shell, plugin-api and bridge, xtask release. Done on an isolated worktree; the suspicious
findings were checked with a test or a proof of concept on an isolated instance, never on a shared
server. The fixes are on the branch `review-sec` (not merged).

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| H1 | **High** | A static-site zip can declare false sizes: a 200 KB upload writes 200 MB (up to 20 000 × 512 MB), the quota sees 10 bytes | **fixed**, regression test |
| M1 | Medium | The import of a tenant trusts the rows of the file: a crafted export can add platform Administrators, members of other tenants, grants on their items | **fixed**, regression test |
| M2 | Medium | Behind a proxy (`trust_proxy`) the client address is the *first* `X-Forwarded-For` entry, chosen by the client: the per-address sign-in limit is bypassed | **fixed**, unit test |
| M3 | Medium | The CSP of the plugin UIs allows scripts from the whole untrusted origin, which also serves user files (`/c/…`) and public links (`/p/…`): an uploaded `.js` is a script gadget for any HTML injection in a plugin UI | **fixed** (scripts only from `/ui/<plugin>/`), e2e |
| M4 | Medium | Password-protected public links accept unlimited guesses, each one an argon2 check on the server (brute force and CPU exhaustion) | **fixed** (10 wrong attempts per link per 15 min), regression test |
| M5 | Medium | All plugin UIs share one origin (known limit, architecture §15): a malicious or compromised plugin can script the UI of another plugin opened in a frame of its own and read its browser storage | **fixed as an option**: `plugin_url = "https://*.plugins.example.org"` gives every plugin UI its own host (`ui_url`), the untrusted listener checks the `Host`, the CSP and the bridge use the exact origin; server test `one_origin_per_plugin_with_a_wildcard_plugin_url`, e2e `wildcard.spec.ts` (`MOSAIKIT_E2E_WILDCARD=1`) |
| L1 | Low | The map of failed sign-ins grows without end (keys are usernames and addresses chosen by whoever tries) | **fixed** (stale keys pruned), unit test |
| L2 | Low | CSV export: cells starting with tab or carriage return were not neutralised (formula injection) | **fixed** |
| L3 | Low | The SVG check of logos is a deny list (e.g. `href="//host"`, entity-encoded schemes pass) | **fixed**: allow-list sanitizer `kernel::svg` (XML parser without DTD, drawing elements and attributes only, `href`/`url()` only to `#id`), the sandbox CSP stays; unit tests |
| L4 | Low | `GET /p/<token>/api` returns every value of the item, including fields declared `hidden = true` (data kept for an extension) | **fixed**: hidden fields left out (`public_fields`), unit test |
| L5 | Low | Import and backup restore read whole archive entries into memory and have no total unpacked-size limit (zip bomb) | **fixed**: `[archives]` limits (unpacked MB, entries, one JSON table), counted while inflating (`archive_too_big`); kernel test `imports_stay_within_the_limits_of_the_archives` |
| L6 | Low | `is_safe_path` does not refuse Windows reserved names (`CON`, `NUL`, …) nor names ending in a dot or space | **fixed** on every platform (devices with any extension, trailing dot/space, control characters, `<>"|?*`); unit test |
| L7 | Low | Extension values are written on any item visible to the person: the kernel does not check that the id is an item of the extended plugin and of that resource | **fixed**: the item must belong to the base plugin and resource; kernel test (a task refused) |
| L8 | Low | A password link is checked and then marked as used in two statements: two requests at the same instant can both use it | **fixed**: consumed with one conditional `update` before the password is set (given back if the password is refused); concurrent kernel test |
| L9 | Low | `secret.key` is written and then restricted to `0600` (Unix): a short window with the default mode; on Windows no ACL is set | **fixed**: created `0600` from the start (Unix) or with the inherited ACL removed (Windows, `icacls`), linked under its name in one step; unit tests |
| I1 | Info | Eight wrong passwords lock an account for its lock time: anyone who knows a username can keep it locked (usual trade-off) | by design |
| I2 | Info | The CSRF token is compared with `!=` (not constant time); it is 128 random bits bound to the session | acceptable |
| I3 | Info | Front-channel logout accepts `iss` + `sid` without authentication (as the specification requires): whoever learns a `sid` can sign that session out | by design |
| I4 | Info | Replies to the frame of an extension tab go with target origin `*` (the frame is opaque): if the page of the tab navigates itself elsewhere, later context events (language, theme) reach the new page | acceptable |
| I5 | Info | Plugin UI files are served with `Access-Control-Allow-Origin: *` (needed by the opaque frames of extension tabs); they are public static files | acceptable |

## High

### H1 — Static-site zips with false sizes (fixed)

`crates/kernel/src/blobs.rs` (`extract_site`, before the fix lines 90-112). The limit of 512 MB summed
`ZipFile::size()`, the uncompressed size *declared in the headers* of the zip, which whoever builds the
file writes. Each entry was then read with `take(512 MB + 1)`, and `SiteInfo.size` (what quotas and
usage count) was the declared sum.

**Exploit.** Any member who can write an item of the Static sites plugin uploads a 200 KB zip with one
entry of 200 MB of zeros whose headers say 10 bytes: 200 MB land on disk and the resource records
10 bytes. With 20 000 such entries one request can fill the disk of the whole installation (every
tenant down) while the storage quota of the tenant sees almost nothing. Verified with a crafted zip
against `extract_site`: `Ok(size = 10)`, 209 715 200 bytes written.

**Fix.** The limit now applies to the bytes the entries really inflate to (each one read at most up to
what is left), the recorded size is the real one, and `content::upload_site` unpacks at most what the
storage quota of the tenant still leaves (refused with `quota_exceeded`, the previous site stays).
The same pattern was applied to `mskp::Package::read` (plugin packages, Administrator only). Test:
`blobs::tests::the_sizes_declared_in_a_zip_are_not_trusted`.

## Medium

### M1 — Import of a tenant trusts the rows of the file (fixed)

`crates/kernel/src/transfer.rs` (`import_tenant`, `restore`). The rows of `core/*.json` were inserted as
they were: nothing tied them to the tenant of the manifest.

**Exploit.** An Administrator imports an export received from elsewhere (another installation, a
customer, a backup copied around). A crafted file can carry a `users` row with
`is_system_admin = true` and a known password hash (a new platform Administrator), `memberships` with
the `tenant_id` of another tenant of the installation (its own people become members there), `grants`
or `public_links` on items of other tenants. Restoring a backup goes through the same code.

**Fix.** `check_scope` refuses the archive (`export_invalid`) unless every row belongs to the tenant of
the manifest: the tenant row is that tenant and not the system one, users have it as home and are not
Administrators, rows with a `tenant_id` name it, preferences name its users, group members its groups,
grants and links its items; plugin rows with a `tenant_id` must name it too. Test:
`lifecycle_ops::an_export_cannot_reach_outside_its_tenant`.

### M2 — `X-Forwarded-For` took the client's entry (fixed)

`crates/server/src/auth.rs` (`ClientIp`) and `crates/server/src/lib.rs` (`request_info`). With
`trust_proxy = true` the address was the first entry of the header. Proxies such as nginx
(`$proxy_add_x_forwarded_for`) append the real address to what the client sent, so the first entry is
whatever the client wants.

**Exploit.** Password spraying across many usernames while sending a different fake address every
time: the per-address limit never triggers (the per-account limit still does). The Log also records the
fake address.

**Fix.** The last entry counts (the one the trusted proxy added); `mosaikit.example.toml` says that
exactly one proxy must sit in front. Test: `auth::tests::the_address_added_by_the_proxy_counts`.

### M3 — Script gadget on the untrusted origin (fixed)

`crates/server/src/untrusted.rs` (`plugin_csp`). The plugin UIs had `script-src 'self'`. The same origin
serves user files through tickets and public links: a `.js` file uploaded to Files or inside a static
site is served from `'self'` with a JavaScript MIME type.

**Exploit.** Any HTML injection in a plugin UI (a missing escape) is normally harmless because the CSP
forbids inline scripts; with `<script src="/p/<token>/x.js">` the attacker's file runs inside the UI of
the plugin, with its bridge to the host (the person's data in that plugin).

**Fix.** `script-src` and `worker-src` are limited to `<plugin_url>/ui/<plugin id>/`. The e2e suite runs
all the official plugins with the new policy.

### M4 — Password guessing on public links (fixed)

`crates/kernel/src/links.rs` (`check_password`), `POST /p/<token>/unlock`. No limit on wrong passwords;
every attempt is an argon2 verification queued on the shared argon semaphore.

**Exploit.** Unauthenticated brute force of the password of a link; the same flood slows every sign-in of
the installation (they wait for the same semaphore).

**Fix.** Ten wrong passwords lock the link for 15 minutes (`too_many_attempts`), on the existing limiter.
Test: `links_files_content::guessing_the_password_of_a_link_is_limited`. A per-address limit on the
unlock page would be a further improvement.

### M5 — One origin for every plugin UI (fixed as an option)

Known and documented (architecture §15). A plugin is installed by the Administrator from a signed
package, but if one plugin is malicious or has an XSS, it can open the UI of another plugin in a frame
of the same origin, read and change what that UI shows, and read or change the `localStorage` of every
plugin. It cannot use the bridge of the other plugin (the host answers only its own frames, and a framed
UI talks to its parent, the malicious page). **Recommendation:** one
subdomain per plugin (`<id>.plugins.example.org`), the CSP and the bridge already check exact origins.

**Follow-up (fixed as an option):** a wildcard `plugin_url` (`https://*.plugins.example.org`) gives every
plugin UI its own host, `com-mosaikit-notes.plugins.example.org`, and the contents and public links
`public.plugins.example.org`; the listener serves each part only on its host. It stays optional because
it needs a wildcard DNS record and certificate (docs/architecture.md §9, deploy notes).

## Low and info

See the table. Recommendations: an allow-list SVG sanitiser (or rasterising logos to PNG); leaving
`hidden` fields out of `/p/<token>/api` unless the public view of the plugin declares it needs them;
limits on the unpacked size of imports and restores; refusing Windows reserved names in `is_safe_path`;
checking the plugin and resource of an item in `extensions::editable`; consuming a password link with
`update … where used_at is null returning`; creating `secret.key` with mode `0600` from the start
(`OpenOptions::mode`) and restricting its ACL on Windows.

## What was checked and found sound

- **Sessions**: 256-bit random tokens stored as SHA-256, `HttpOnly; SameSite=Strict`, `Secure` on HTTPS,
  CSRF token for every change, expired sessions removed, sessions closed on password change and reset.
- **Passwords**: argon2id with a bounded semaphore, dummy hash for unknown users (no timing oracle),
  limits per account and per address from the three-level settings.
- **TOTP**: replay refused (`totp_last_step` updated conditionally), recovery codes stored hashed and
  single use, attempts limited, pending sessions of 10 minutes.
- **OIDC**: PKCE S256, `state` and `nonce` in an encrypted `SameSite=Lax` cookie bound by AAD and
  expiry; ID token checked for signature (RS256/ES256 only, `none` and HMAC refused), `iss`, `aud`/`azp`,
  `exp`, `nonce`; identities by issuer + `sub`; back-channel logout tokens used once; client secrets
  encrypted.
- **Authorization**: every Administrator API checks `require_admin` (in the handler or the kernel
  function it calls, all audited); every tenant API goes through `Caller` (membership checked);
  Tenant Manager operations call `require_manager` and limit themselves to accounts whose home is the
  tenant; plugin permissions are enforced in the kernel; search, trash, log and quotas are scoped to the
  tenant and to what the person can see.
- **Database**: RLS on PostgreSQL with the plugin roles; the SQL of plugins is parsed and re-serialised by
  `sql-guard` (one statement, allow-listed relations and functions, `set_config` and `pg_*` refused).
- **Plugin sandbox**: a new WASM instance per call, fuel and 64 MB memory limits, 16 MB messages,
  plugin-to-plugin calls at most 3 deep; plugin notifications rate-limited and only to readers of an
  item the caller can write.
- **Web**: host CSP without `unsafe-inline` scripts, `frame-ancestors 'none'` and `X-Frame-Options`;
  user contents served with `CSP: sandbox` (opaque origin) and `nosniff`; public pages with strict CSP and
  nonces; content tickets bound to the session and re-checked on every request.
- **Uploads and archives**: images recognised by their bytes and capped at 512 KB; paths inside
  archives checked (`is_safe_path` + `enclosed_name`); export file names validated before download.
- **Secrets**: ChaCha20-Poly1305 with AAD per value; `secret.key` outside backups; secrets never returned
  to the browser.

## Follow-ups (2026-10-23)

All the open items of this review are closed: M5 as an option (wildcard `plugin_url`), L3–L9 fixed, each
with a regression test; `zip` moved from 2.6 to 9 (the three advisory exceptions are gone from
`deny.toml` and `.cargo/audit.toml`); the OIDC sign-out now sends `id_token_hint` (the ID token is kept
encrypted with its session and goes away with it).
