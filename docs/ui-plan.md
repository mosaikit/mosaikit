# Mosaikit — Plan to build the mockup

From the mockup (`docs/mockup`) and the rules of [refactoring-ui.md](refactoring-ui.md) to the product.
Every phase includes kernel, migrations (PostgreSQL and SQLite), tests of the kernel and of the server,
API, pages of the shell (`ui/host/src/app`), e2e tests (Playwright, `cargo xtask e2e`) and cites the ids
of the screens of the mockup. A phase is closed when `cargo xtask test` and the e2e tests pass and its section of [manual-tests.md](manual-tests.md) is written.

| Phase | Content | Screens |
|---|---|---|
| 0. The shell becomes the product | The prototype replaces the old UI; a library for the languages; server errors as translatable codes; e2e and accessibility check (axe); development watcher on Windows | all |
| 0b. English by default | Code, comments, identifiers, documentation, server messages and the default language of the interface in English; Italian as a translation | all |
| 1. Settings on three levels | Value of the platform and of the tenant, kind (managed, with a limit, customizable), «tenants may customize it»: identity and texts with the logos, password rules, sessions, languages and formats, keys of outside services (encrypted), embedding | `system/*`, `config/*` |
| 2. Notifications | Notifications in the kernel (read, unread), real-time bell, preferences per kind and channel, email (SMTP), `msk.notify` for the plugins | `inbox`, `account/notifications`, `system/email` |
| 3. People and permissions | All the people (Administrator), Pending (invitations and access requests), permission profiles, permissions per plugin, read-only summaries | `gusers`, `members/*`, `person/*`, `group/*`, `module` |
| 4. Plugins | Manifest with `kind`, `extends` and icon; available (Administrator) and on (Tenant Manager); Extensions tab; updates | `marketplace/*`, `mpmod/*`, `splugins` |
| 5. Shares, Trash, Log | All the shares and «Shared by me»; trash with 30 days and restore; Log with filters, CSV and detail | `shares`, `trash`, `activity`, `audit` |
| 6. Quotas and usage | Default quotas and capacity, quotas per tenant, behaviour at the limit, usage, alerts, Account › Usage | `system/quotas`, `usage/*`, `account/usage` |
| 7. Life cycle and operations | Archiving and deleting a tenant, logo, trial; backup and restore, retention, maintenance; Monitoring | `tenant/*`, `system/*`, `monitoring/*` |
| 8. OIDC sign-in per tenant | Configuration per tenant, external identities, source of the roles, revocation (architecture §3.3) | `tenant/sign-in`, `login` |
| 9. Search, help, themes | Search in the contents with the plugins; tour, guide, what is new, shortcuts; high contrast; theme editor with WCAG check | `dlg-search`, `themeedit` |

Order: 0 → 0b → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Phase 8 can come earlier if a customer needs it.

## Status

| Phase | Status |
|---|---|
| 0 | done: the shell is the UI (old UI removed), real Share dialog, i18next (it/en) with server error codes, official logo and Tessera theme, Playwright e2e with axe, Windows dev watcher fixed |
| 0b | done: English by default (code, comments, docs, server messages, i18n keys, default language); the sign-in page takes the theme of the platform and of the tenant before a session exists; absolute social preview URLs; a server that does not answer is said and retried, never a bare HTTP status |
| 1 | done: settings on three levels (managed, with a limit, customizable, «tenants may customize it») for identity and logos, theme and mode, languages and formats, passwords and sessions (enforced by the kernel), embedding of public pages, keys of outside services encrypted at three levels; System, Tenant settings and Account › Keys |
| 1b | done: the official plugins (`mosaikit-plugins`) in English by default, with Italian available; manifest translations (`[i18n.<lang>]`) shown in the language of the shell (sidebar, plugin pages, CRUD fields and choice labels, KPIs, public pages) |
| 2 | done: notifications in the kernel (invitations, shares, public links, plugins through `msk.notify`), live bell (server-sent events), Notifications page with filters and selection, preferences by kind with immediate or daily emails, System › Email (SMTP with STARTTLS/TLS, encrypted password, test), queue with retries, digest and retention |
| 3 | done: permissions of the people in the plugins (standard ones enforced by the kernel, `[[user_permissions]]` of the manifests in `ctx.perms` and `msk.can`), permission profiles with a default, grants to groups and people, Access and permissions of each plugin; suspension of a membership, last sign-in; access requests (approve, refuse, forward to the owner) from `#/t/<t>/item/<id>`; one-time links to choose a new password; detail of a person (profile, sign-in and sessions, permissions with their sources, «why can't they see an item?», activity) for the Tenant Manager and the Administrator; the Administrator's People (every person, add to a tenant, role and profile, move of the home tenant); group detail |
| 4 | done: one name, Plugin, with kinds App / Service / Extension and the icon of the shell in the manifest; available to each tenant (the Administrator, with a default) and turned on by its Tenant Manager, enforced on every operation and on public links, with notifications to the Tenant Managers; extensions with fields and actions on the items of another plugin (values kept by the kernel with the permissions of the item, shown by `mountCrud`), sample `com.mosaikit.note-review`; settings of a plugin (`[[config]]`, secrets encrypted) in `ctx.config`; release notes in the registry, updates and bulk actions, uninstall with what goes away; the Administrator's plugin page (Overview, What it asks, Tenants, Configuration, Extensions) and the Plugins tab of a tenant |
| 5 | done: Shares with selection and Revoke (every grant and link of the items, the owner keeps them), «Shared by me» on the Home; trash (deleting moves to the trash, invisible everywhere, restore with grants and links, delete for good, empty, purge after `trash.retention_days`); Log of the tenant and of the platform (filters, failures, address and browser, detail pane, CSV of everything or of a selection, retention `log.retention_days`), the activity of a person and of a group from the Log; System › Retention |
| 6 | to do |
| 7 | to do |
| 8 | done: sign-in through the identity provider of a tenant (authorization code with PKCE, ID token RS256/ES256 checked in the kernel, key rotation), configuration and «Check the configuration» for the Administrator, people by issuer + `sub` created at the first sign-in, roles from Mosaikit or from the groups of the provider, local passwords turned off in OIDC tenants, end session and back-channel logout; test provider `mosaikit-fake-idp` for the tests and the development environment |
| 9 | to do |
