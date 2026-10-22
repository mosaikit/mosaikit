# Mosaikit — Plan to build the mockup

From the mockup (`docs/mockup`) and the rules of [refactoring-ui.md](refactoring-ui.md) to the product.
Every phase includes kernel, migrations (PostgreSQL and SQLite), tests of the kernel and of the server,
API, pages of the shell (`ui/host/src/app`), e2e tests (Playwright, `cargo xtask e2e`) and cites the ids
of the screens of the mockup. A phase is closed when `cargo xtask test` and the e2e tests pass.

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
| 8. OIDC sign-in per tenant | Configuration per tenant, external identities, source of the roles, revocation (architecture §15) | `tenant/sign-in`, `login` |
| 9. Search, help, themes | Search in the contents with the plugins; tour, guide, what is new, shortcuts; high contrast; theme editor with WCAG check | `dlg-search`, `themeedit` |

Order: 0 → 0b → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Phase 8 can come earlier if a customer needs it.

## Status

| Phase | Status |
|---|---|
| 0 | done: the shell is the UI (old UI removed), real Share dialog, i18next (it/en) with server error codes, official logo and Tessera theme, Playwright e2e with axe, Windows dev watcher fixed |
| 0b | done: English by default (code, comments, docs, server messages, i18n keys, default language); the sign-in page takes the theme of the platform and of the tenant before a session exists; absolute social preview URLs; a server that does not answer is said and retried, never a bare HTTP status |
| 1 | to do |
| 2 | to do |
| 3 | to do |
| 4 | to do |
| 5 | to do |
| 6 | to do |
| 7 | to do |
| 8 | to do |
| 9 | to do |
