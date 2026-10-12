# Architecture decision records

Decisions are recorded in the [MADR](https://adr.github.io/madr/) format. A decision is changed
by a new record that supersedes the old one, never by editing it.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-license-mpl-2.0.md) | License: Mozilla Public License 2.0 | Accepted |
| [0003](0003-quarkus-jvm-and-jakarta-data.md) | Quarkus in JVM mode with Jakarta Data | Accepted |
| [0004](0004-plugin-model-restart-and-packages.md) | Plugin model: manifest, restart for backend plugins, signed packages | Accepted |
| [0005](0005-organizations-and-identity.md) | Organizations and identity | Accepted |
| [0006](0006-frontend-web-components.md) | Frontend: Lit shell and Web Component plugins | Accepted |
| [0007](0007-typescript-6-until-tooling-supports-7.md) | TypeScript 6 until the tooling supports TypeScript 7 | Accepted |
| [0008](0008-requirements-and-documentation-as-code.md) | Requirements and documentation as code | Accepted |
| [0009](0009-english-for-code-and-technical-documents.md) | English for code and technical documents | Accepted |
| [0010](0010-portable-distribution.md) | Portable distribution with a jlink runtime and bundled PostgreSQL | Accepted |
| [0011](0011-federated-identity-per-organization.md) | Federated identity: one Keycloak realm per organization | Accepted |
| [0012](0012-repository-and-distribution-layout.md) | One build, a plugin SDK and compact distributions | Accepted |
| [0013](0013-kernel-creates-organization-realms.md) | The kernel creates the realm of a federated organization | Accepted |
| [0014](0014-signed-plugin-packages.md) | Signed plugin packages with Ed25519 | Accepted |
| [0015](0015-isolated-plugin-frontends.md) | Isolated plugin frontends in sandboxed iframes | Accepted |
| [0016](0016-membership-of-several-organizations.md) | One account, memberships in several organizations | Accepted |
| [0017](0017-ai-tools-drafts-and-audit.md) | Plugin actions as AI tools, confirmed drafts and an audit log | Accepted |
| [0018](0018-row-level-security.md) | Row-level security of the data of organizations | Accepted |
| [0019](0019-plugins-extending-plugins.md) | Plugins that extend other plugins | Accepted |
| [0020](0020-frontends-in-any-framework.md) | Plugin frontends in any framework, bundled per plugin | Accepted |
| [0021](0021-minimal-marketplace.md) | A minimal marketplace: signed catalogs and installation from the interface | Accepted |
| [0022](0022-assistant-on-plugin-tools.md) | An assistant on the tools of the plugins, with any OpenAI-compatible model | Accepted |
| [0023](0023-documentation-and-release-documents.md) | Documentation checked at every push, release documents generated from it | Accepted |
| [0024](0024-hosting-on-github.md) | Hosting on GitHub: one organization, the core and the plugins in separate repositories | Accepted |
| [0025](0025-github-pages-and-maven-namespace.md) | Publishing on GitHub Pages, and the Maven namespace `io.github.mosaikit` | Accepted |
| [0026](0026-teams-like-shell.md) | A shell that works like Microsoft Teams, on Fluent UI Web Components | Accepted |
| [0027](0027-teams-channels-and-chat.md) | Teams, channels and chats: groups in the kernel, collaboration in plugins | Accepted |
| [0028](0028-real-time-activity-and-notifications.md) | Real time, presence, activity and notifications in the kernel | Accepted |
| [0029](0029-files-on-s3-and-connectors.md) | Files on S3-compatible storage, and connectors to external services | Accepted |
| [0030](0030-global-search-with-pills.md) | Global search with pills, on PostgreSQL full-text and providers of the plugins | Accepted |
| [0031](0031-frontend-plugins-on-the-data-api.md) | Frontend plugins on a data API of the kernel, active without a restart | Accepted |
| [0032](0032-fluent-ui-and-themes.md) | Fluent UI web components behind `@mosaikit/ui`, with selectable themes | Accepted |
| [0033](0033-lean-collaboration.md) | Collaboration on the real-time channel and the data API, without brokers or backends | Accepted |
| [0034](0034-repository-layout-by-role.md) | Repository laid out by role, with the sources under src/ | Accepted |
| [0035](0035-plugins-outside-the-kernel-repository.md) | Plugins outside the kernel repository, tested on a published snapshot | Accepted |
| [0036](0036-extensions-not-plugins.md) | Extensions, not plugins | Accepted |
