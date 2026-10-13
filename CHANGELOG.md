# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- The apps per role (MK-030) moved onto permissions (MK-056): every app has the permission
  `<extension>:use-<app>`, and an app is shown to the members and administrators of the
  organization or restricted to the people who hold it (`restricted` in
  `/api/v1/organizations/{slug}/apps`; `roles` is deprecated, and `[organization-admin]` reads as
  restricted, so apps for the administrators only stay so). Members and administrators see the same
  apps as before; guests, already refused the backends of extensions, see an app only when a team of
  theirs or a personal exception grants its permission.

### Added

- The kernel keeps the sessions of people on the server (MK-125). Signing in with a password opens
  a session recorded in the new table `account_session` (migration V19) and the `mosaikit-session`
  cookie holds only a random value, kept as its digest: after signing out, a copy of the cookie is
  refused at once (401). The session of a realm is recorded from the `sid` of its tokens, so that
  signing out with a bearer token, or ending it, refuses its tokens before they expire. Platform
  administrators suspend and reactivate accounts (`PUT, DELETE
  /api/v1/platform/accounts/{email}/suspension`, audited): a suspended account signs in by no means
  and its sessions and "remember me" tokens end at once; removing a person from an organization
  ends their sessions in it. People see their live sessions in their settings (browser, address,
  opened, last used, this browser marked) and end any of them (`GET, DELETE
  /api/v1/accounts/me/sessions`); ending one revokes its "remember me" token too. Every request is
  checked against its session, with what was read kept for `mosaikit.accounts.session-cache` (5
  seconds) and dropped at once when this kernel ends the session; new settings
  `mosaikit.accounts.session-timeout` (8 hours without activity) and `session-max-life` (24 hours);
  expired sessions are removed every 15 minutes.

- The kernel implements sharing (MK-055, ADR-0037): the `Sharing` bean of `kernel-api` shares a
  registered resource with a person, a team, the organization, a link or the public at the levels
  that the manifest declares, ordered as listed; deny by default, every level to the owner and to
  the administrators of the organization, none to platform administrators for being platform
  administrators, grants only add, granting again replaces the level (also lowering it), the public
  gets the lowest level and links at most the `linkLevel` of the type. Links keep only the SHA-256
  of their secret, expire within `mosaikit.sharing.link-max-validity` (default `30d`), may have a
  password, are revoked, and answer 404 afterwards; every grant, revocation and use of a link is
  audited. The SQL function `mk_kernel.allows(extension, type, id, level)` lets extensions filter
  large lists in the database with the same answers. REST API under `/api/v1/sharing` for the
  sharing dialog, and `POST /api/v1/sharing/links/open` for people without an account. An
  extension update that removes a resource type or a level with grants is refused with their list.
  Grants are kept in `mk_kernel.resource_grant` (migration V18) under row-level security. The
  sharing dialog, the `@mosaikit/sdk` counterpart and the move of the team sharing of documents
  (MK-032) onto this model come next.

- The kernel implements permissions (MK-056, ADR-0038): the `Permissions` bean of `kernel-api`
  answers for the person and the organization of the request, deny by default, with profiles
  (one per member, the assigned one or the default profile of members), teams and personal
  exceptions that only add; administrators of the organization hold every declared permission,
  guests only what their teams and exceptions grant, platform administrators none for being so; a
  permission the manifest does not declare is never granted, and none of an extension whose apps
  are all off. `AccessDeniedException` is answered with 403 (404 when concealed). New tables
  `permission_profile`, `member_profile` and `permission_grant` (migration V17) under row-level
  security; grants of permissions that the extensions no longer declare are removed at start, so
  that a permission added again arrives switched off. REST API for the administrators of an
  organization under `/api/v1/organizations/{slug}/permissions` (declared permissions, profiles,
  profile of a member, grants to teams, exceptions, effective permissions with their sources, and a
  preview for invitations without side effects), every change in the audit log, and
  `GET /api/v1/shell/permissions` for the shell. The console and the move of the apps per role onto
  permissions follow.

- The console of the organization has **Permissions** (MK-056): profiles with their permissions by
  extension and the default profile of members; for each person the profile, the personal
  exceptions and what they can do with its source; the permissions of each team. **Invite a person**
  chooses role, profile and teams and shows the resulting permissions before sending:
  `PUT /api/v1/organizations/{slug}/members/{email}` accepts `profile` and `teams`, all or nothing.
  The administrators of the organization, signed in to it, list its members and give profile and
  teams to those who are already members; adding people and changing roles stay with the platform
  administrators until invitations by link (MK-068). The shell hides the contributions whose
  `permission` the person lacks.

- The kernel implements the registry of resources (MK-054): the `Resources` bean of `kernel-api`
  lets Java extensions register, update, remove, find and list their resources (type, identifier,
  title, owner, link, parent) in the organization of the request, within the transaction of the
  caller. The entries are kept in the new table `mk_kernel.resource` (migration V16) under
  row-level security; a resource registered without a person is owned by the organization; the
  entries of an extension that is no longer installed are removed at the next start. Sharing and
  permissions (MK-055, MK-056) are still a preview.

- Preview of the extension API for resources, sharing and permissions (MK-054, MK-055, MK-056;
  ADR-0037 and ADR-0038, now accepted), before the kernel implements it: `permissions` and
  `resources` in the manifest (resource types with their sharing levels, the levels that edit, the
  accepted subjects and the `linkLevel` of links), validated by the JSON Schema and by
  `ExtensionManifests`, with `ExtensionManifest.sharingRemovedBy` for updates that remove levels; in
  `kernel-api` the packages `dev.mosaikit.kernel.api.resource` (`ResourceRef`, `Resource`,
  `Resources`), `dev.mosaikit.kernel.api.sharing` (`Subject`, `Grant`, `SharedLink`, `Sharing`) and
  `dev.mosaikit.kernel.api.permission` (`Permissions`, `PermissionId`, `AccessDeniedException`).
  The kernel does not provide the beans yet.

- A theme extension can name the product and bring its logo (MK-052, `theme.product` and
  `theme.logo` with `light` and `dark`): as the theme of the installation, the shell shows them in
  its bar and on the sign-in page, and uses them as the title and the icon of the page.
  `/api/v1/system/info` gives them as `name`, `logo` and `logoDark`. The sign-in page waits for the
  installation and its themes, so it no longer shows the name and colors of Mosaikit first.

- The texts of a contribution in other languages (MK-053): an `i18n` block by language tag, such as
  `i18n: { it: { title: Catalogo } }`, which the shell uses for the names of the apps and of the
  sections of the settings in the language of the person; `textAttribute` in `@mosaikit/sdk`.

- The installation is also a Maven artifact, `io.github.mosaikit:mosaikit-distributions:zip:installation`,
  on which products build their own distributions, with the builder of the portable archives
  (`zip:portable-tools`, `portable/build.sh` with `PORTABLE_*` variables), Docker Compose
  (`zip:docker`) and the Helm chart (`zip:helm`); the snapshot of `main` publishes them too. `mosaikit-bench --set <key>=<value>` starts the bench with a setting.

- The parent POM of extensions, `io.github.mosaikit:mosaikit-extension-parent` (MK-051): an extension POM
  names it, its coordinates and, with Java code, the APIs it compiles against; `mvn package` writes
  the JAR in `lib/` and the package, `mvn verify` also runs the tests of the extension on the bench.
  `create-mosaikit-extension` writes POMs on it, for extensions with and without Java code, and the
  fixtures of the kernel are built on it.

- The test bench of extensions, `@mosaikit/testing` (MK-050): a real installation with the extension on
  an embedded PostgreSQL, with an organization and two people, for `npm run dev` (`mosaikit-bench`)
  and for Playwright tests; `create-mosaikit-extension` writes both, and the end-to-end tests of the
  kernel run on it. Every push to `main` publishes the installation, the extension API and the npm
  packages of the SDK in the pre-release `snapshot`.

- Tabs of the channels (MK-035): Posts, Files and the tabs that extensions contribute to the point
  `channel.tab` of `app-teams`, added by the people of the channel; the sample To do offers one. The
  shell no longer loads the frontends of extensions turned off for the organization, whose tabs show
  as unavailable.

- The app Chat, `app-chat` (MK-036): chats one to one and in groups, as groups of the kernel of
  kind `chat` seen only by their people; messages at once, with history, indicators of typing and
  reading, notifications, and cards of extensions whose actions run with the rights of who uses them.

- The app Teams, `app-teams` (MK-034): channels General, standard and private for each team, posts
  with threads, reactions, and mentions of people or of the team in the activity feed, all at once
  for whoever has the channel open; an extension without a backend. Teams have groups, private teams
  inside a team (`parent`), for its private channels.

- Teams (MK-032): groups of an organization with owners, members and guests of other organizations
  (`/api/v1/teams`, `Teams` of `kernel-api`, audited); documents of the data API shared with a team
  (`context.data(collection, { team })`), readable only by its people under row-level security;
  guests see only their teams.

- The activity feed (MK-038): **Activity** at the top of the app bar, with the unread count pushed
  on the real-time channel; extensions notify people with `context.notify` or `Notifications` of
  `kernel-api` (`/api/v1/notifications`); people turn kinds of notifications off in their settings.

- The real-time channel (MK-031, ADR-0033): one WebSocket per page (`/api/v1/live`), events sent
  with PostgreSQL NOTIFY when a transaction commits; extensions subscribe with `context.live` and
  `collection.onChange` and publish with `LiveEvents` of `kernel-api`; the kernel refuses topics the
  person may not read. The sample To do shows the changes of colleagues at once.

- The shell is an installable progressive web app (MK-029): a manifest with icons, a service
  worker that keeps the shell and its files, and a notice when the network is missing instead of
  an error page.

- Apps per organization (MK-030): the administrators of an organization choose in **Organization
  apps** which apps its app bar shows, in which order, which are pinned and which only
  administrators see (`/api/v1/organizations/{slug}/apps`, audited); an extension whose apps are all
  off refuses its API and its documents to the organization; pinned apps cannot be hidden in the
  personal settings.

- Theme extensions (MK-028): an extension of kind `theme` declares `theme` (title, font, radius, light and
  dark colors); it is active at once, offered in the personal settings and usable as the theme of
  the installation (`mosaikit.ui.theme=<extension id>`); what it leaves out comes from the default
  theme (`/api/v1/system/themes`). New sample `sample-theme`.

- Personal settings (MK-027): appearance (as the device, light, dark, high contrast), theme,
  language (English or Italian, for the shell and for the extensions through `context.locale`),
  organization and the apps of the app bar, kept with the account
  (`/api/v1/accounts/me/preferences`); extensions add sections with `settings.section`, for the roles
  they choose. The platform administration page is now called **Platform**.

- A shell that works like the collaboration suites (MK-025, ADR-0026): an app bar on the left
  (at the bottom on phones) with an icon per app, Home and the pages of administrators; a top bar
  with the search of apps and pages and the menu of the person (organization, sign-out); Home
  lists the apps. Extensions contribute to the app bar with `rail.app` (`title`, `route`, `element`,
  `icon`, `order`); `launcher.app` still works, with a warning in the status of the extension. The
  sample extensions and `create-mosaikit-extension` use `rail.app` with an icon.

- Local registration confirmed by mail (MK-048): the sign-in page offers **Create an account** in
  the organizations that allow it; the account signs in after the link sent to the address is
  opened (`mosaikit.accounts.confirm-email`, `mosaikit.accounts.confirmation-valid-for`, the mail
  server in `quarkus.mailer.*`, the links on `mosaikit.public-url`). Platform administrators turn
  self-registration off and on in **Settings** (`/api/v1/platform/settings`). `npm run dev` and the
  end-to-end tests use a fake mail server that prints or keeps the links.

- A new sign-in page with "remember me" (MK-047): a remembered person stays signed in on the
  browser for `mosaikit.accounts.remember-for` (30 days), with an HttpOnly cookie kept in the
  database as a digest, until they sign out.
- `@mosaikit/ui` (ADR-0032): the Fluent UI web components and the themes of the shell, selected
  with `mosaikit.ui.theme`: `mosaikit` (default) or `pa`, for public administrations, in the style
  of Bootstrap Italia. The fonts are served by the kernel.

- Extensions without a backend (MK-046, ADR-0031): a manifest declares `data.collections`, and the
  kernel keeps their JSON documents for each organization under row-level security at
  `/api/v1/data/<extension>/<collection>`; the SDK offers `context.data(collection)` and the bridge
  the service `data`. Such an extension is active as soon as it is installed, without a restart, and
  the shell loads it without a reload. New sample `sample-todo`; `create-mosaikit-extension` without
  `--backend` writes one.
- In development mode the kernel watches the extensions directory (`mosaikit.extensions.watch`): a
  changed frontend or a new extension without Java code shows at once, as the shell reloads its page
  by itself.

### Changed

- The session cookie of the shell is no longer the encrypted cookie of the form authentication of
  Quarkus (MK-125): `quarkus.http.auth.form.timeout` and `quarkus.http.auth.session.encryption-key`
  are not used any more, and sessions no longer end when the kernel restarts. Sessions open before
  the update end with it: people sign in again once.

- Plugins are called extensions (ADR-0036), everywhere: code, API (`/api/v1/extensions`,
  `/api/v1/ext/<api>/`), settings (`mosaikit.extensions.*`), the `extensions/` directory of an
  installation, database (schemas `ext_<name>`; migration V15), SDK (`@mosaikit/create-extension`,
  `mosaikit-extension-parent`) and documentation.

- A whole build with every test is faster: the Quarkus tests that need extensions share one kernel
  (5 profiles instead of 10), the end-to-end tests run in three groups at the same time, each on a
  bench of its own (`node tests/e2e/run.ts`, also one group or one file), and the installation
  tests run only with `-DskipITs=false`, as the CI does on `main` and every night.

- The extensions are no longer part of the kernel repository (ADR-0035): the tests of the kernel
  install fixtures of their own (`tests/fixtures/extensions`, `dev.mosaikit.fixture.*`); the sample
  extensions and the apps Teams and Chat move to `mosaikit/mosaikit-samples`, a project each. The
  installation no longer comes with a catalog of samples, and
  `mosaikit.marketplace.sources` has no default.
- The repository is laid out by role (MK-049, ADR-0034): the sources under `src/` (`src/server`,
  `src/web`, `src/extensions`), beside `sdk/`, `distribution/`, `tests/e2e`, `build/`, `docs/guide`
  and `docs/development`. The layout of an installation does not change.

- The Maven coordinates are `io.github.mosaikit` (`io.github.mosaikit:mosaikit-kernel-api`) and
  `io.github.mosaikit.samples`, the namespace that Maven Central verifies with the GitHub
  organization (ADR-0025); the Java packages and the extension identifiers do not change.
- The documentation is published on GitHub Pages at <https://mosaikit.github.io/mosaikit/>; the
  `$id` of the JSON schemas is under <https://mosaikit.github.io/schemas/>.
- The project moved to the public GitHub organization `mosaikit` (ADR-0024): CI and releases run
  on GitHub Actions, the extension API is published to Maven Central and the SDK to npmjs.org, the
  container image and the Helm chart to the GitHub Container Registry; no token is needed to use
  them.
- `@mosaikit/create-extension` also writes `.github/workflows/ci.yml`, which builds, checks and
  releases the extension with the reusable workflow of the organization.
- One build for everything (ADR-0012): `./mvnw install` also builds and checks the frontend and
  writes every deliverable to `target/dist` (installation, Docker, Kubernetes, extension packages,
  and with `-Pportable` the portable archives).
- Repository: `sdk/java` (extension API, was `kernel/kernel-api`) and `sdk/js` (`@mosaikit/sdk`)
  for third parties; one `kernel` module with services, launcher and UI; requirements in
  `docs/requirements`.
- Installations: at the root only `mosaikit`, `mosaikit.cmd`, `README.md`, `config/`,
  `extensions/` (and `data/` in the portable); the kernel, with the UI and the launcher inside, and
  the portable Java and PostgreSQL are in `bin/`.
- Extensions are installed as one zip copied into `extensions/`, without unpacking it; each extension
  build produces it.
- Docker Compose distribution (`target/dist/mosaikit-docker`): PostgreSQL 18, Keycloak and
  Mosaikit configured together, with `mosaikit.identity.keycloak-internal-url` for a kernel that
  reaches Keycloak by another name than the browsers.

### Fixed

- A slow or stuck mail server no longer makes a registration fail with 500 after 60 s (MK-048):
  the confirmation mail goes out after the account and its link are committed, outside of any
  database transaction, and the kernel waits for the mail server at most
  `mosaikit.accounts.mail-timeout` (15 s), in two attempts of half each: when the first times out,
  the mail is sent once more on another connection. When the mail is not sent the answer is 503, the
  account stays, and the sign-in page offers to send the link again. The same holds when the link
  is asked for again.
- The test bench and `npm run dev` send mail to `127.0.0.1`, where their mail server listens: on
  Linux `localhost` resolved to `::1` too, and every other mail failed the registration that sent it.
- The shell no longer misses an extension that changes in a watched directory while it loads its
  extensions: it reads the revision of the extensions before loading them.

- A release publishes everything that extensions use: the parent of extensions on Maven Central, also
  `@mosaikit/ui` and `@mosaikit/testing` on npm, and the installation archive
  `mosaikit-X.Y.Z.tar.gz`, signed in `SHA256SUMS`, which the test bench downloads. npm no longer
  drops the commands `create-mosaikit-extension` and `mosaikit-bench` from the packages.

- The nightly checks of `main` pass again: constructor injection in the live socket and in the
  access filters of apps and guests, no final method in an entity, a stable sort of the kinds of
  notifications, and `source-map-js` 1.2.2 (CVE-2026-93749).

- Installing an extension without a backend no longer reports it active when the kernel could not load
  it, and its package is unpacked on Windows even while an antivirus holds the new files.

- When the apps cannot be loaded after signing in, the person enters and the workspace says that
  the apps could not be loaded, instead of a failed sign-in ("The request failed.").
- `npm run dev` builds the extension API at every start: after a `git pull` the dev mode ran the new
  kernel on the old classes of `sdk/java/target` and failed with `NoSuchMethodError`.
- The rebuild of the kernel for Java extensions no longer records the settings of the installation:
  passwords of `config/application.properties` or of the environment ended up in
  `bin/kernel/quarkus/generated-bytecode.jar`, and a removed setting kept applying. The next start
  that rebuilds the kernel removes them; rebuild once (add or remove a Java extension) to clean an
  existing installation.
- A reload of the shell keeps the session of a local account: the shell signs in once and the
  kernel keeps the session in an HttpOnly cookie, so no script of the page holds the password.
- The way back to Home from an app or the Extensions page works again.
- A confirmed action that the extension refuses is reported in the shell with its reason.
- The formats `uuid`, `date`, `date-time` and `email` in the input schema of an action are
  checked, so that an assistant that passes a title as an identifier is told at once.
- The Extensions page shows a package waiting for the restart as such, instead of offering to install
  it again.
- People in no organization are told why the apps have nothing to show.
- "Cannot reach the model" says where the model was expected instead of "null".

### Security

- jackson-databind 2.22.3 over the version of the Quarkus BOM, for CVE-2026-91776 and
  CVE-2026-91777.
- The marketplace inspects a package in a directory of the extensions directory, ignored by the
  scan, instead of the temporary directory that other users share (SonarQube Cloud S5443).
- Isolated frontends talk with the shell through a `MessageChannel` handed over in the `ready`
  message, instead of messages posted to the wildcard origin (SonarCloud S2819).

### Added

- The parent POM of extensions, `io.github.mosaikit:mosaikit-extension-parent` (MK-051): an extension POM
  names it, its coordinates and, with Java code, the APIs it compiles against; `mvn package` writes
  the JAR in `lib/` and the package, `mvn verify` also runs the tests of the extension on the bench.
  `create-mosaikit-extension` writes POMs on it, for extensions with and without Java code, and the
  fixtures of the kernel are built on it.

- Each installation brings the sample extensions as a signed catalog in `catalog/`, the default
  source of the marketplace, so the Extensions page offers them at once; a catalog can be a path
  relative to the installation. The configuration file shows the marketplace, the assistant and
  the session of the shell.
- End-to-end tests with Playwright (`e2e/`, `npm run e2e`, job `e2e` of the CI) on a real
  installation, one per case of the manual test plans of MK-008 and MK-020 to MK-024; releases are
  published only when they pass.

- Documentation checked at every push and release documents (ADR-0023): `DocumentationTest`
  (API and settings guides follow the code), `docs/test` (links, ADR index, compliance evidence),
  the `changelog` job on merge requests; `docs/build/build.py` and the `docs` job generate the
  guides in Word and PDF, the compliance workbook (Excel), the release overview (PowerPoint) and
  extended release notes; the `sign` job signs the image and the checksums with cosign keyless.
- Assistant on the tools of the extensions (MK-024, ADR-0022): `POST /api/v1/ai/assistant/replies`
  answers in natural language with any OpenAI-compatible model with tool calling
  (`mosaikit.assistant.*`, for example a local Ollama); changes become drafts; the home page of
  the shell has an assistant panel.
- `create-mosaikit-extension` (MK-023, `sdk/create-extension`): creates an extension that the kernel
  accepts, frontend only or with a Java backend, a schema under row-level security and actions for
  assistants, with a standalone Maven build.
- Minimal marketplace (MK-022, ADR-0021): catalogs are directories with a signed `index.json`
  (`PackageSigningTool index`), local or over HTTPS (`mosaikit.marketplace.sources`); platform
  administrators install, update or upload signed packages from the Extensions page; the build
  publishes `target/dist/extensions` as a signed catalog.
- Extension frontends written with any framework (MK-021, ADR-0020): the samples Palette (React) and
  Swatch (Vue) share the page, the theme and the event bus, bundled with Vite into one module each;
  extension packages include `dist/`.
- Extensions that extend other extensions (MK-020, ADR-0019): frontends declare extension points
  (`frontend.points`) and read the contributions of other extensions with
  `context.contributionsTo(point)`; extensions are migrated after those they require. The samples
  Activities (app with a data contract view, an extension point and actions for assistants) and
  Estimates (a field, a widget and an event, without foreign keys) show it.
- Row-level security of the data of organizations (MK-019, ADR-0018): requests run as the member
  role of the installation with the organization of the request, so that the PostgreSQL policies
  of extension tables apply to every query; `mk_kernel.current_organization()` for the policies;
  `mosaikit.database.row-security` to turn it off. The sample notes extension uses it.
- AI tool registry (MK-015, ADR-0017): extensions declare typed `actions` with a JSON Schema and a
  risk level; the kernel offers them as tools at `/api/v1/ai/tools` and through an MCP server at
  `/mcp`, with the credentials and the organization of the person. `write` and `execute` tools
  become drafts that the person confirms or rejects under "Pending actions" in the shell. The
  sample notes extension declares `list-notes` and `create-note`.
- Audit log: append-only `audit_event` table, the `mosaikit.audit` log category and
  `GET /api/v1/audit-events` for platform administrators; it records the actions of assistants and
  the changes of organizations and members.
- Membership of several organizations (MK-017, ADR-0016): one account per person, with roles in
  each organization; each request acts on one organization (realm, sub-domain or the selector of
  the shell); each organization chooses `password`, `realm` or `password-or-realm`; extensions read
  `CurrentOrganization` and extension APIs are refused without an organization; members are managed
  with `/api/v1/organizations/{slug}/members`.
- Isolated extension frontends (MK-014, ADR-0015): a frontend that asks for it, or whose publisher
  is not verified (`mosaikit.extensions.unverified-frontends=iframe`, the default), runs in a
  sandboxed iframe and reaches the shell only through the events and the API calls declared in
  `frontend.bridge` of its manifest.
- Signed extension packages (MK-013, ADR-0014): Ed25519 signature inside the zip, checked by the
  kernel and the launcher against `config/trusted-keys`; a changed package is always refused, and
  `mosaikit.extensions.signatures=required` accepts only packages of trusted publishers.
  `PackageSigningTool` in the Java extension API generates keys, signs and verifies packages; the
  build signs the sample extensions and trusts their key.

- Code analysis on SonarQube Cloud (Free plan), Java and TypeScript with their coverage, from the
  `sonarqube` job of the pipeline.

- Creation of the Keycloak realm of an organization (MK-018): `POST /api/v1/organizations` with
  `federation` creates the realm with the kernel UI client, the `organization-admin` role and a
  first manager with a temporary password, through a service account of the master realm
  (`mosaikit.identity.admin`); nothing is created when Keycloak refuses or cannot be reached.

- Repository structure, governance files and MPL-2.0 license.
- Kernel: semantic versions and version ranges, extension manifest model and validation,
  extension registry loaded from a directory, organizations, local accounts with
  self-registration, system information, RFC 9457 error responses.
- Web shell with extension contributions loaded from the kernel (`kernel/kernel-ui`).
- `@mosaikit/sdk` with the extension frontend contract.
- Sample frontend extension.
- Java extensions installed with a restart (MK-011): `backend.jar` in the manifest, launcher
  `bin/mosaikit` that rebuilds the kernel (mutable JAR) when extension JARs change, status
  `RESTART_REQUIRED`, Flyway migrations of each extension schema at start, extension APIs under
  `/api/v1/ext/<api>` always authenticated and served only for active extensions, automatic
  rollback of extensions with which the kernel cannot be rebuilt or started, and the sample Java
  extension `sample-notes`.
- Federated sign-in with one Keycloak realm per organization (MK-012): realm and email domains
  of each organization (`PUT /api/v1/organizations/<slug>/identity`), sign-in options chosen
  from the sub-domain or the email domain (`GET /api/v1/identity/sign-in-options`), bearer
  tokens verified per realm as dynamic OIDC tenants, federated accounts created or linked at the
  first sign-in, kernel roles only, `503` with a problem detail when a realm is unreachable,
  sign-in in two steps in the UI with the authorization code flow and PKCE, and a Keycloak realm
  template in `distributions/keycloak`.
- Portable distribution (MK-016): archives for Windows, Linux and macOS with a Java runtime
  built with jlink and PostgreSQL 18 started by the launcher on localhost, secrets generated at
  first start, backup by copying `data/`; built and tested in the `portable` CI jobs and
  attached to GitHub releases.
- Installation layout shared by all distributions, with `distributions/installation/assemble.sh`.
- The kernel serves the built UI from the `ui/` directory; Quinoa is used in development mode only.
- Requirements as code, architecture decision records, CI pipeline, container image and
  Helm chart.
- Release pipeline: on a `vX.Y.Z` tag, container image, kernel-api, `@mosaikit/sdk` and the
  Helm chart are published (container image and chart to GHCR, extension API to Maven Central, SDK to npmjs.org) and a GitHub release is created.
