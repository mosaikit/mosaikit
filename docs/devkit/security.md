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
| `[[public_commands]]` | anyone with a public link runs the command, read only, on the shared item; with `write = true` it may also insert rows into the `insert_for = "visitor"` tables of the plugin. **Sensitive** (see below) |
| `run_commands` | a service of a distribution calls the command as the person who started a run, in the background. **Sensitive** (see below) |
| `run_targets` | a run started by this plugin may call the run commands of these other plugins as the person. **Sensitive** (see below) |
| `directory` | lists the usernames and names of the people and groups of the tenant to callers who may share. **Sensitive** (see below) |
| `[[config]] public = true` | a public page may read that setting. Never a secret: the manifest refuses it |
| `files`, `content` | own files and uploaded folder content |

When the logic gets a refusal such as the text «the plugin does not declare notify in [permissions]» or `permission_denied`, the
manifest lacks the key; `validate --strict` finds it before you install.

Permissions of **people** (`use`, `create`, `delete`, `share` and your `[[user_permissions]]`) are separate: the kernel
enforces the standard ones; **your logic enforces its own** with `ctx.can`. Hiding a button with `msk.can` is only
comfort.

## Public link commands: review checklist

A command in `[[public_commands]]` is run by strangers. The kernel restricts what it can read (the item of the link and what is
inside it, the keys of the tenant or the platform), not what it **returns**: WASM may return data it legitimately read, and the
kernel cannot tell. So the plugin author carries this part, and a reviewer should check each public command against this list:

1. **Never echo a secret.** Nothing from `ctx.config`, no key, no URL with a token in the answer, an error or a log line. Use
   `fetch_with_key` so the logic never reads the key.
2. **Never take the id of the item from the arguments.** Use `ctx.link_resource()` only. Arguments are chosen by the visitor.
3. **Treat every argument as hostile**: validate size and shape, bind parameters in SQL, build no URL by pasting them.
4. **Mind the cost.** An outside request with a key spends the tenant's or the platform's paid key for an anonymous visitor. Keep
   it small, cache what you can, and expect the limits (30 a minute per link, 300 per tenant).
5. **Return the least that the page needs**, not the whole row, and declare only the commands the public page really calls.
6. Remember the tenant policy: it is off by default, so the page must work (or say so) when the command is refused.

## Run commands: review checklist

A command in `permissions.run_commands` is called by a service with no session, as the person who started the run. The kernel
checks the ticket, the manifest and the person's rights on every call, and a ticket with a resource list is cut to those resources
by the database. It cannot limit what the logic **returns**: WASM may return data it legitimately read. So the plugin author carries
this part, and a reviewer should check each run command against this list:

1. **Return the least the run needs**, not whole rows, and never a setting, a key or anything from `ctx.config`.
2. **Check what you are asked to work on.** Ids come from the arguments the service sends; read them through the database (it
   applies the person's rights and the ticket's resources) and treat the arguments as possibly chosen by a compromised service.
3. **It writes as the person.** Keep writes minimal and idempotent; a repeated call must not do harm.
4. **Use `ctx.on_behalf()`** to tell a run from the person's own call and be stricter in a run, never looser.
5. Declare only the commands a run really calls, and expect a call to fail when the ticket is over (`run_ticket_invalid`).
6. A ticket without a resource list reaches everything the person can reach for that command: ask the distribution to scope the
   ticket whenever the command touches sensitive data.

`permissions.run_targets` is the other side: the plugin whose process **starts** a run lists the plugins that run may reach. List
only what the process really needs (every entry is a plugin whose run commands run with the person's rights, reviewed by the
Administrator), mint tickets for the least set of targets and commands, scope the entries to the items of the run when you can, and
treat what a target returns as data of the person, not of the run. The target does not have to agree, but it decides what is
reachable: only its own `run_commands`.

## Directory: the author rule

`permissions.directory` lets the plugin search the people and groups of the tenant (`ctx.directory()`, `msk.directory.search`).
The kernel lets in only a Tenant Manager or a person who may share in the plugin, shows only active members of the current tenant,
gives only `id`, `username` and `name` (never an email), refuses it in public links and in runs, rate limits it and logs one event
a minute with no query and no rows. It cannot limit what the plugin does with the answer, so the author carries this rule:

1. **Fill the picker, nothing else.** Search when the person types (with a short pause), show the rows, forget them when the
   editor closes.
2. **Never store or forward the directory.** Do not copy names or usernames into your tables, settings, logs or notifications
   beyond what the person chose; do not return the list from another command; do not send it to an outside service.
3. **Keep the ids the person picked**, not the names (a name can change; look it up again to show it).
4. **Declare it only if you use it**, and expect `permission_denied` for people who may not share: show the field read-only.

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
