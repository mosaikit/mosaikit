# Changelog

What changes from one version of Mosaikit to the next. The shell shows the section of its own version
in Help › What is new (one `## <version>` heading per version, `- ` items, `### ` groups), in the
language of the person: this file in English, [CHANGELOG.it.md](CHANGELOG.it.md) in Italian (keep them
in step).

## 1.0.15

- Administrator: the table of the people shows the name of the organization, not its slug; the cards of the plugins no longer show the signature (it stays in the list and in the page of the plugin) and are wide enough for all their badges; the filters of the log no longer overlap.
- Tenant Manager: «Your apps» in the overview is one row that scrolls sideways, however many apps there are; the lines of «My recent activity» stay inside their card.
- Sharing: a public link can be made without an expiry when the organization does not limit the lifetime, and the dialog says that the link does not expire (or until when it works) and that it works on every visit; transferring the ownership no longer ends with an error message when the former owner loses the access: the dialog closes.
- A plugin page shows a spinner with its name until the page is loaded.
- Plugins: `ctx.directory().users_with(permission, q, limit)` lists the people of the tenant who hold a permission of the plugin (`[[user_permissions]]`) and `msk.share(id, { principals, level })` opens the share dialog with people and groups ready to be shared with: a review flow can offer «share with the reviewers» and the owner confirms in one step. Same rights as the directory (`[permissions] directory = true`, Tenant Manager or `share`).
- Developer profile: once somebody is signed in, the full-width banner is a pill «Developer profile» in the top bar, before the search box, in the same orange; it is on every page and cannot be closed, its tooltip and a small panel carry the whole warning and the button of the developer tools. The sign-in page keeps the full banner. Nothing changes outside the developer profile.
- Development: `cargo xtask dev` creates the Administrator `admin` with the password `mosaikit` (it was `admin-sviluppo`); it applies to a new database. The desktop release already starts with `mosaikit` for `admin` and the work tenant user (`initial_password`).
- Navigation: the Administrator (System › Identity and appearance › Navigation) and a Tenant Manager (Tenant settings, same place) set the groups of the sidebar: groups and subgroups (one level) with an icon and a name in every language, and the order of the apps. Without a value the tenant uses the platform's groups, and the platform the ones of the distribution (`[[nav_groups]]`, which can now have `[[nav_groups.children]]`). In the open sidebar a group is a heading with its icon and the number of apps, the subgroups are indented; in the closed one a group is an icon with a menu of all its apps. Product policy: `[locked] keys = ["nav.layout"]` freezes it.

## 1.0.14

- Brand of a product: `tagline`, `login_message` and `footer` of `branding/brand.toml` can be written per language, as a table (`[login_message]` with `en = "..."` and `it = "..."`) in place of one string. The sign-in page shows the text of the language of the page, then the plain text, then `en`; a footer set in the platform settings still wins. `validate` accepts both forms.

## 1.0.13

- Desktop of a product: the configuration file takes the name of the executable (`geoportal.exe` reads `geoportal.toml`, and the release ships `geoportal.example.toml`); `mosaikit.toml` is still read when there is no file with the new name, so an installation made earlier works. `START.txt` and the comments of the file name it. Not renamed (internal names the data depends on): `data/logs/mosaikit.log`, `data/database/mosaikit.db`, the PostgreSQL database `mosaikit`, the files of the Docker and Kubernetes releases (`mosaikit.toml` inside the image).

- Desktop (Windows): no console window flashes at start or stop any more: every helper process of the program (`initdb`, `pg_ctl`, `pg_dump`, `icacls`) runs hidden. The sidecars were already started hidden.
- Desktop: only «Open» of the icon menu (and a click on the icon) opens the browser; choosing another item (Quit, Data folder...) no longer opens a tab.
- The file with the initial credentials of the first start is `initial-credentials.txt` (it was `credenziali-iniziali.txt`); the icon menu still opens the old file of an installation made earlier.
- One mechanism for the texts inside the pages of the plugins: a language plugin brings `lang/ui/<plugin id>.json` (English phrase to translation), the server sends it with the texts of the language (`ui` in `GET /api/languages/{code}`), the shell hands the part of a plugin to its page in the `context` (`texts`) and the plugin API has `msk.t(phrase, vars?)` and `msk.ownTexts(tables)`. Additive and opt-in; plugin API 1 unchanged.
- Public commands that write: `[[public_commands]]` takes `write = true` and `[[tables]]` takes `insert_for = "visitor"`; a visitor of a public link can then add rows (an answer to a form, a vote) to the tables made for visitors, only for the item of the link and never change or delete one; 10 calls a minute for a link, shown to the Administrator as «adds data».
- Languages written from right to left: the page takes its direction (`dir`) from the language (Arabic, Hebrew, Persian, Urdu). The official language plugins now are Spanish, Portuguese, French, Dutch, Arabic, Chinese and Russian.
- Real-time channels: a plugin with `permissions.realtime` opens a channel on a resource with `msk.realtime.open` (presence, messages to everyone or to one person, a small state per person, over SSE and POST); the kernel only relays, nothing is stored.
- `permissions.media`: the frame of the plugin may pass the camera, the microphone and the screen to a service it embeds (with `frame_src`).
- `mountCrud` has the view kind `custom`, the option `sort` and a handle with `reload()`; the plugin API has a UI kit (toast, dialog, menu, popover, tag input, person picker, date field, timeline, kanban, Markdown) and `MockHost::hook_with_previous` for hook tests.

## 1.0.12

- Fix: `mosaikit-product build k8s` without `--base-k8s` (1.0.11) wrote the Kubernetes manifests with their `{{id}}`, `{{image}}`... placeholders unresolved and without the `initdb` script, so `kubectl kustomize` failed. The manifests are now rendered with the id, name, version, image and PostgreSQL image of the product, and the result is checked with `kubectl kustomize` in the tests.

## 1.0.11

- `mosaikit-product build k8s` no longer needs `--base-k8s`: the Kubernetes manifests of the Base are built into the kit, so they always match its version. `--base-k8s <folder>` still replaces them. `[[sidecars]]` have no effect on Kubernetes (a warning says so).

## 1.0.10

- `[[sidecars]]` in `distribution.toml` now work for products built with the kit: `mosaikit-product build desktop` copies the executables into `sidecars/<name>/` and writes `sidecars.toml`, so the desktop application starts a Node service, a map server... before the kernel and stops it after. Keys: `command`, `args`, `env`, `health`, `port`, `depends_on`, `restart`, `kind = "oneshot"`, `files`. `validate` warns about a missing executable; `build docker` and `build k8s` print a warning (use `[docker] compose_files`).

## 1.0.9

- `mosaikit-plugin dev`, `mosaikit-product dev` and `mosaikit-product test` take `--database postgres://…` (or `MOSAIKIT_DEV_DATABASE_URL`): the development server runs on a PostgreSQL database of this computer instead of SQLite, for plugins with `[requires] database = "postgres"` (PostGIS). The recipe is in `docs/devkit/data.md`.

## 1.0.8

- `mosaikit-plugin validate --strict` no longer says that `files_read` is unused when the page of the plugin calls `msk.files.*` (a plugin whose page alone reads the Files area of another plugin is accepted).
- `mosaikit-product test --run "<command>"` runs a command of the product (its own HTTP or browser tests) against the running product, with `MOSAIKIT_APP` and the test users in the environment: no crate of the kernel is needed to test a product.
- `[docker] compose_files` and `copy` in `distribution.toml`: the Docker release takes compose files of the product (services next to it) and merges them with the generated `compose.yml` through `.env`; `validate` checks the paths.

## 1.0.7

- A plugin with `files_read` can read the content of a file of another plugin's Files area: `msk.files.blob(id, source)` (the route `GET …/files/{id}/content?source=`), as it already could list it, ask its size and get a ticket.

## 1.0.6

- The log of the Docker kit no longer shows an `ERROR` for the empty development plugin folder: it says there is nothing to load.
- The plugin made by `mosaikit-plugin new` has a list page with the form of an item in a dialog (it opens with «New» and when you select a row), the status as a coloured chip and the illustrated empty state. `mountCrud` has the options `form: 'modal'` and `cell` for the plugins that want the same.
- The Docker release of a product has a `README.md` with what the folder is, the default credentials of a new installation, how to recover the second factor and the password, and where to read more.
- The sign-in page of Keycloak in that release has the look of the sign-in page of the product: a band with the name, the line and the logo of the brand, the form on the right, the colours of the brand.
- The button of the sample tenant reads "Sign in with SSO" (it read "Sign in with Sign in with Keycloak").
- A sign-in through an identity provider started at another address of the app than the one in `MOSAIKIT_URL` (for example `127.0.0.1` instead of `localhost`) now says so, instead of "started in another browser".
- `mosaikit-product validate`, `dev` and `test` take the Base of the Dev Kit by themselves when the product keeps official plugins.

## 1.0.5

- `mosaikit-product build desktop` and `build docker` no longer need `--base`: without it the Base is the version of the Dev Kit you run, which is released together with it. `--base` stays for another version, a folder or a `.zip`.
- `cargo xtask docs` makes the PDF manuals (user, installation, developer, architecture), in English, and a PowerPoint presentation of Mosaikit, with its advantages, a measured footprint and an estimate of the time and cost saved against starting from zero. Every release attaches them.

## 1.0.4

- The sign-in page of Keycloak in the Docker release of a product shows the logo once, a readable title and a card at full width.

## 1.0.3

### The platform

- A product can make a sample tenant that signs in through an identity provider at the first start: `[bootstrap.idp_demo]` in `distribution.toml` (tenant, issuer, client id, groups of the Tenant Managers and of the Users; the client secret is read from an environment variable, never from the file). Nothing happens in the developer profile or when the tenant exists.

### The development kit

- The Docker release of a product can also run Keycloak (`[docker] keycloak = true`, the default of `mosaikit-product new`): a realm named after the product, a sign-in page with the logo and the colours of the brand, three test people and the sample tenant `idp-demo`, to try the integration with an identity provider through OpenID Connect at once. It is a demonstration, and it needs a base from 1.0.3: `validate` says so.

## 1.0.2

### The development kit

- `mosaikit-product` takes the Base by itself: `--base 1.0.2` (or `MOSAIKIT_BASE=1.0.2`) downloads the desktop kit of that release once, checks it against the signed `SHA256SUMS` and keeps it in a cache (`MOSAIKIT_CACHE` moves it). A product now needs only the Dev Kit, like a plugin. With `--base <version>` the Docker base image is `ghcr.io/mosaikit/mosaikit:v<version>` by itself.
- The release signs the desktop kit of the Base together with the Dev Kit, which is what makes that check possible (earlier releases do not list it: use their zip by hand).
- `mosaikit-plugin new` takes the SDK and the UI package from the kit the tool is in: no `--kit`. A failed build of a plugin that asks the registry for the SDK says what to change.
- `mosaikit-product build` says clearly when a plugin of `include` is neither in the roots nor in the base.
- The documents are revised for the shortest way to a plugin and to a product: what to download (only the Dev Kit), the brand of a product (logo, favicon, icon, colours, texts) and the public base image.

## 1.0.1

### The platform

- The first update of the platform after 1.0.0, made so that a product can be tried on one base and then moved to the next one with its data. It changes no behaviour of the kernel, the plugin API or the shell: a product built for `>=1.0, <2` runs on it as it is.

## 1.0.0

### Distributions

- A distribution can group the apps of the sidebar (`[[nav_groups]]` in `distribution.toml`: id, label, icon, the plugins in order, labels in other languages). The open sidebar shows a collapsible heading per group; the closed one shows the group icon and a menu with its apps and their pages. Apps no group lists stay at the bottom. Other layouts keep the flat list.
- A distribution can ship sidecars (`[[sidecars]]` in `distribution.toml`): extra processes next to the app. The desktop app starts them before the kernel (with a progress message, a timeout and a clear error if one cannot start), restarts them according to their policy, logs their output and stops them after the kernel; the Docker and Kubernetes releases add a service for each. Their addresses are allowed for the plugins' fetches automatically.
- A sidecar can be a one-time task (`kind = "oneshot"`, for example a database initialisation): it runs to completion before the sidecars that depend on it start, and a failure or a timeout stops the start with the end of its log. A sidecar can also receive files of the distribution (`files`, for example a configuration) where it expects them, on the desktop, in Docker and in Kubernetes.

### The shell

- The sidebar has a calmer style: no separator lines and no lines around the selected item (it has a soft background and the accent colour instead); in a group the apps are indented under the heading and their pages one level deeper; the icons of the closed sidebar are equally spaced; the menus of the closed sidebar show the icon of each entry; Overview and Settings keep their short name when the sidebar is open; in the closed sidebar the menus also open when the mouse rests on an icon (those icons show no tooltip over the menu; a menu opened this way never takes the keyboard focus, and clicking an entry does not pop its menu up over the page).
- Public pages (public links) can now be embedded by default by the static sites of the same installation, with no setting; the sites listed in Settings › Embedding are added on top, and nobody else may embed them.

- The lists and cards that were left with a bare line when empty (the two lists of Manage › Pending, Home without apps, usage, backups, log and overview widgets, members of a group) now show an illustration with a title and the action, in a small version inside a widget or a section.
- The Overview tab of a plugin fits the screen: the pictures at the left, the information at the right (it scrolls by itself only if it is longer than the screen). Every official plugin now ships two realistic pictures.
- A new interface for every role, in English and Italian, with light, dark and automatic mode.
- The top bar is decided by the Administrator: logo and name, search, language, help and mode.
- Themes: Mosaikit, Italia and Tessera, plus the themes made with the theme editor, checked for
  contrast (WCAG 2.1 AA). High contrast for whoever reads with effort.
- Search everywhere: pages, apps and the items of the apps you can see (Ctrl K).
- Help: a guided tour of the main pages, the guide, what is new and the keyboard shortcuts.
- Overviews of widgets for every role: the apps as a compact strip, fast figures, notifications, recent activity, due dates and, for the Administrator, the tenants by storage, requests and recent errors.
- The overviews fill the page without gaps (a dense grid of four, two or one columns). The Administrator sees one card per app, with small charts of items and space, and a chart of the space by app.
- Headers, filters and tabs stay in place. Pages that are a list or a table do not scroll as a whole: the list fills the page and scrolls inside, with its header row in sight, and loads more as you scroll. The pages of the apps have the same header as the pages of Mosaikit, and a page with subsections (System, Monitoring, Settings, Usage, Account, Manage) shows both the page and the selected subsection in its header. The list of sections of a page stays in place and scrolls by itself. A layout you save is used at once, without reloading the page. The sidebar scrolls, closed or open, and shows its scrollbar only under the mouse.
- Long lists and tables load a page at a time, with a count and «Load more» (or as you scroll), including the Log.
- In the long lists that load a page at a time (Tenants, People, Items, Invitations, Trash, the Log and the lists of the apps) the titles of the columns sort the whole list, not only the rows already loaded: the first row is the first or the last of everything. A column that cannot be sorted by the server (a count, a computed value) is plain text.
- Every table works the same way, in the shell and in the apps: the header row stays in place and only the rows scroll, the titles of the columns sort, a filter box in the header searches every field, and more rows load as you reach the end. The installed plugins also show as cards (the default) or as a table. The same table is used inside cards and dialogs (the data under the charts, the CSV import and its results, the items of a backup, the extensions of a plugin); the permission matrices, the notification kinds and the quota capacity keep their grid but with the same look, header row and first column in sight.
- In Contacts, Tasks and Notes the panel with the details appears only when you open an item or create a new one; otherwise the list uses the whole width.
- Notes are coloured post-its: eight colours (readable in light and dark mode), chosen in the editor or from a small menu on the note, slightly turned, straight under the pointer. Drag the folded corner, or press Alt and the arrow keys, to resize a post-it; its size is kept. The List view is still there.
- Notes have tags of your own, each with its own colour: create, rename, recolour and delete them from the Tags button (deleting a tag removes it from your notes), and filter the notes by tag.
- Pages and lists with nothing in them show an illustration with a title, a short line and the buttons of what to do, the same in the shell (Tenants, Plugins, Groups, Access requests, Shares, Trash, Notifications) and in the apps; a filter that matches nothing shows a small message with a link to clear it.
- Documents: the list and the details panel are one flat block; the bar of the selected files shows only icons (the name appears as a tooltip); the panel no longer scrolls sideways; PDF files are shown in the panel and in the viewer by the app itself, so they work in every browser. Scrollbars are as thin as those of Mosaikit in every app.
- Documents: a folder with many files opens at once: the list and the grid draw 100 items at a time and the next ones come as you scroll (the foot reads «N of N items» at the end). Ctrl+A, Shift selection and the arrow keys work on the whole folder.

### People and tenants

- Settings on three levels: the platform, the tenant and each person. Each setting says whether it is
  inherited, customized or managed by the platform.
- People and permissions: permission profiles, groups, invitations of people of other tenants, and
  requests to see or edit an item, decided by its owner or a Tenant Manager.
- A forgotten password is replaced with a link that works once. On the sign-in page, **Forgot your password?** sends that link to the email address of the account.
- Every local account has an email address (required when it is created or imported).
- Your own name and picture: you change them in Account › Profile (the name comes from the identity
  provider in the tenants that use one).
- Sign-in through the identity provider of a tenant (OIDC), next to local accounts; the groups of the
  provider can become groups of the tenant.
- Quotas of the tenants with the usage, the trend and the alerts.

### Your work

- Notifications in the bell, by email and in a daily digest.
- Shares and public links of every item, the trash for 30 days and the log of what happened.
- Plugins on and off per tenant, with extensions that add fields, actions and tabs to the apps.
- Keys of outside services: the plugins say which services they use, and only those are listed.
- Static sites can show a web address inside Mosaikit (a site that forbids framing opens in a new tab), as cards or as a list with thumbnails.
- Contacts show as cards with the initials of each person and a reading panel, Tasks as a list or a board (overdue, open, done) with status chips and a checkbox, Notes as note cards that open in a reading pane before you edit them; on a phone the panel covers the list.

### For plugin authors

- Public link pages can do more. A plugin can mark a setting `public = true` in `[[config]]` and the page reads it with `msk.publicConfig()` (never a secret: the manifest is refused), and it can declare `[[public_commands]]`, commands that anyone who holds a public link may run with `msk.publicCall(name, args)`. They run read only, with no user, on the shared item alone, with no secrets in the settings, with the tenant's or the platform's key and never a personal one, within a limit of calls (30 a minute for a link, 300 for a tenant) and a smaller computing budget. The Administrator sees them when the plugin is installed, and the Tenant Manager must turn on the new policy «Public commands» (off by default) in Manage › Settings. The plugin author must still never return a secret or take the item from the arguments: see the Security page of the dev kit. These are additions to API 1 (no new version); a plugin that uses them needs `[requires] mosaikit = ">=1.0"`.
- A distribution can call a plugin on behalf of a background run. The person who starts the run mints a **run ticket** (`POST /api/t/{t}/run-tickets`) for one plugin, a list of its commands, a short time (15 minutes by default, 60 at most), a number of calls and, if wanted, a list of resources; the service redeems it on every call (`POST /api/run/{ticket}/call/{plugin}/{command}`) with no session. A plugin lists the commands a run may call in `[permissions] run_commands` (shown to the Administrator when the plugin is installed); the command runs as the person with their rights at the time of the call, sees `ctx.on_behalf()`, and with a list of resources the database itself shows it nothing else. The token is never stored, a ticket can be revoked by the person, a Tenant Manager or the service, and every mint and call is in the Log. The plugin author must still never return more than the run needs: see the Security page of the dev kit. An addition to API 1 (no new version); a plugin that uses it needs `[requires] mosaikit = ">=1.0"`.
- A run can reach other plugins. A plugin lists them in `[permissions] run_targets` (shown to the Administrator); the same ticket then names those plugins with their own commands (only what each declares in its `run_commands`), a schedule names them in `[[schedules]] targets`, and the command that starts a run can ask for the ticket with `runs.mint`. Every check is made again on every call: the target must still be declared, on in the tenant and used by the person, whose rights are the only ones in play. Uses, rate and lifetime are shared by the whole ticket, and a ticket cannot mint a ticket.
- A plugin can search the people and groups of the tenant. `[permissions] directory = true` gives it `ctx.directory().users(q, limit)` and `.groups(q, limit)` in the logic and `msk.directory.search({ kind, q, limit })` in the page, for a picker of its own (an assignee, a reviewer). Only a Tenant Manager or a person who may share in the plugin can use it; the answer is `{ id, username, name }` of the active members of the current tenant (never an email) or `{ id, name }` of its groups, at most 50 rows; it is refused in public links and in runs, rate limited, and the Log gets one event a minute with no query and no rows. The Administrator sees it when the plugin is installed. The plugin must not store or forward the list beyond what the editor on screen needs: see the Security page of the dev kit. An addition to API 1 (no new version); a plugin that uses it needs `[requires] mosaikit = ">=1.0"`.
- A plugin can change the top band for a resource on the full page. `msk.band.set({ search, mode, presence, comments })` asks the shell for no search bar, a View | Edit switch (or «Read only» when the person cannot edit), the people connected (three avatars and «+N») and a comments button; the shell checks everything the page sends, never lets a plugin hide the tenant, the bell, the help or the person menu, and gives the band back when the page closes. No permission is needed. An addition to API 1 (no new version); a plugin that uses it needs `[requires] mosaikit = ">=1.0"`.
- The plugin API has a version: **API 1**. The manifest declares what a plugin was built for: `[requires] mosaikit = ">=1.2, <2"` (the versions of Mosaikit it works with) and `[requires] api = 1`. A plugin outside the range, or built for another API, is not installed: one clear message names the range and the version of Mosaikit, and Plugins › Updates shows the same reason beside the version that cannot be installed. The old keys `abi` and `min_kernel` still work for one major version (a plugin loaded from its folder in development logs a warning); `[contribution]` is optional. Release this Mosaikit before the first plugin that uses `[requires]`: older ones reject the table.
- The UI of a plugin and the shell agree on the API version when the page opens (`msk.api`, `API_VERSION`): a plugin built for a newer API than the shell speaks is refused with the code `incompatible_api` and the person is told to update Mosaikit.
- An error of the logic can carry a code of its own (`Error::coded("invoice_locked", "...")` in the SDK); it reaches the UI of the plugin as `BridgeError.code`, and the codes are typed (`ErrorCode`).
- `mosaikit-plugin-sdk` and `@mosaikit/plugin-api` have their own version (1.0.0), changelog and README. The UI package lists its exports one by one and keeps its internals private; the SDK hides its plumbing (`Ctx` is `#[non_exhaustive]`). The `theme` event is deprecated in favour of `context`. Deprecation rule: a deprecated item stays for one major version, is marked and logged in development, and is removed in the next. The features that no official plugin uses yet are marked experimental in the architecture document.
- New manifest permission `[permissions] script_eval = true` (default false): the UI of that plugin alone gets `'unsafe-eval'` and `'wasm-unsafe-eval'` in `script-src` and `worker-src`, for engines that compile code at run time. The shell, the contents, the public links and every plugin that does not declare it keep the strict policy; the Administrator sees it in the plugin's «What it asks» as a sensitive permission.
- A plugin can call an outside service with the key an Administrator set: `http.fetch` takes a `key` (a service of `[[service_keys]]`) and the host adds it as a bearer token; the address may be the one set in Keys of outside services (`address = true`). Requests of plugins go through the same guard as the page probe (public addresses only). The SDK has `ctx.http().fetch_with_key(...)`.
- Notes translates a note with a translation service (Translate note, under the note), as the example.
- The destructive buttons of the plugins (Delete) keep a readable contrast in the dark mode, as in the shell. Notes 0.5.0 shows the page that is open in its header (Notes › Mine).
- The manifest brochure (details, pictures, author, licence, link) shows as a full page in the plugin detail; the official plugins now come with pictures and texts.

- `mountCrud` can draw the items itself (`views`: list, cards or board, with a switch) next to a detail panel and a reading pane (`reader`); `avatar`, `chip` and `el` are shared helpers.
- The logic of a plugin knows the groups of the person who calls it (`ctx.groups`).
- The logic can notify the person who calls it, or the people who can see one of its items, with the
  new `notify` host operation (`[permissions] notify = true`, `ctx.notify` in the SDK).

### The platform

- A deployer can open a service on the private network to the plugins that declare it: `allow_private_fetch_hosts = ["host:port"]` in `mosaikit.toml` (exact entries only). Everything else stays guarded.
- A distribution can seed the settings of plugins (secrets included) and the platform keys of outside services with `[[plugin_settings]]` and `[[service_key_values]]`, from `env:NAME` or `file:PATH`. They are applied once, only while unset, and never overwrite what an Administrator chose.

- Administrators have a required, unique email. They change their own from Account (current password and second factor) and the name and email of another Administrator from System › Administrators.
- System › Email says what is missing and how to set it up, with a preset for a local test server (Mailpit in the development setup).

- Tenants with a trial period, archived or deleted, exported and imported again.
- Backups every day, with the restore of a whole tenant or of one item.
- Maintenance mode, also planned in advance, with a notice for everybody.
- Monitoring of the services, the performance, the errors and the capacity, with alerts.
- A new language is a plugin: once installed it appears in the language menus. The Spanish plugin now translates the whole interface and the texts of every official plugin.
