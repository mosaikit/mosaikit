# Security

What protects the platform from a plugin, and what a plugin author must do in return. Architecture §7, §8 and §9.

## Origins and CSP of plugin UIs

The platform has two origins: the **app** (the shell and the API) and the **untrusted** one (`plugin_url`), where plugin
UIs, uploaded contents and public links are served.

- A plugin UI runs in an iframe with `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads
  allow-modals"`. Being on another origin it cannot read the cookies, storage or DOM of the shell.
- It talks only through the **postMessage bridge**. The host checks that a message comes from the current iframe,
  translates it to a REST call **limited to that plugin** and runs it with the session of the person. Every message the
  plugin sends goes only to the origin of the host.
- With a wildcard `plugin_url` (`https://*.plugins.example.org`) every plugin has a host of its own (its id with `.` as
  `-`) and cannot frame, script or read the storage of another plugin. `mosaikit-plugin dev` uses
  `http://*.localhost:<port>`, so you test with the same isolation.
- **CSP of a plugin page** (`csp_for`, `crates/server/src/untrusted.rs`): `default-src 'self'`; scripts only from its own
  folder on its own host (inline `<script>`, `on...=` handlers and `javascript:` addresses are blocked, and so is run-time
  code compilation: `eval`, `new Function`, unless the manifest has `script_eval = true`); inline styles are allowed;
  requests (`connect-src`) only to itself and the origins of `network`; images also from `network` and `frame_src`,
  `data:` and `blob:`; fonts and media only from itself and `data:` (and `blob:` for media); frames only from itself, `blob:`,
  `frame_src` (and any `http(s)` address with `web`); `object-src 'none'`. Ship your files in `ui/dist`;
  `validate --strict` finds what the CSP would block.
- The session cookie is `HttpOnly; SameSite=Strict`; requests that change data need the CSRF token, which only the host
  has. A plugin never sees a token.

## Permissions

A plugin gets only what its manifest asks for, and the Administrator sees the list when installing it. Ask for the
minimum:

| Permission | Why it matters |
|---|---|
| `files_read` | reads the Files area **as the caller**: never more than the caller sees. **Sensitive** |
| `script_eval` | the plugin can run strings as code. Only for code you trust. **Sensitive** |
| `network`, `frame_src`, `web` | reach outside origins; the logic goes through the host, which refuses private addresses |
| `calls` | call commands of named plugins; the called plugin applies its own rules for the same user |
| `notify` | send notifications; never to recipients you choose |
| `files`, `content` | own files and uploaded folder content |

When the logic gets a refusal such as the text «the plugin does not declare notify in [permissions]» or `permission_denied`, the
manifest lacks the key; `validate --strict` finds it before you install.

Permissions of **people** (`use`, `create`, `delete`, `share` and your `[[user_permissions]]`) are separate: the kernel
enforces the standard ones; **your logic enforces its own** with `ctx.can`. Hiding a button with `msk.can` is only
comfort.

## What is signed

A `.mskp` is a zip with `MANIFEST.sha256` (the hash of every file) and `SIGNATURE` (ed25519 over `MANIFEST.sha256`, with
the publisher's key). At install the host recomputes every hash (no file more or less), checks the signature against
the **trusted keys** of the configuration (`trusted_keys`) and the blocklist. `allow_unsigned = true` is for development
only and flags the package. Details: [Packaging and signing](packaging.md).

## Secrets

- `[[config]]` secrets and keys of outside services are encrypted with the secret key of the installation and never
  go back to the browser. The logic receives them (`ctx.setting`, `ctx.service_key`): **never put them in a result, a
  log line or an error message**, and never send them to the UI.
- `fetch_with_key` adds the service key on the host side, so the logic never reads it: prefer it.
- Never put a secret in the manifest, the migrations or the UI bundle: every installer can read them.
- Keep your signing key out of the repository. The tool's default key is per user (`%APPDATA%\mosaikit\signing.key`,
  `~/.config/mosaikit/signing.key`); use `MOSAIKIT_SIGNING_KEY` or a key file in CI.

## Untrusted content

- Treat every field value, file name and web response as untrusted. In the UI use `textContent` and the `el()` builder,
  not `innerHTML` with data.
- The platform serves user contents with `Content-Security-Policy: sandbox`, `nosniff` and
  `Referrer-Policy: no-referrer`; a page that embeds user contents must keep them in a sandboxed frame (opaque origin).
- SQL: always parameters (`$1`), never string concatenation, even though the guard and RLS are there.
- Paths inside packages refuse `..`, absolute paths, control characters and the names Windows reserves, on every
  platform.
- A layout is declarative CSS checked at install; a language is texts only. Neither runs code in the shell.

## The developer profile is not a security boundary

The profile (known passwords, no signature check, no second factor) is for your computer only: it refuses to start on a
non-loopback address, with a database on another host or behind a proxy (architecture §8.12). Never expose it.
