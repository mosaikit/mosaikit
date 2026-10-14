# Roadmap

The plan from the prototype (requirements MK-001 to MK-024, all done) to a first version that
works like the web version of Teams ([ADR-0026](../adr/0026-teams-like-shell.md) to
[ADR-0030](../adr/0030-global-search-with-pills.md)). Each phase ends with a release that can be
installed and shown; the next phase starts from what the previous one released.

## How the work is done

One person works on Mosaikit about **30 hours a week**, with an AI assistant that writes most of the
code, the tests and the documents. The way of working is lean
([ADR-0031](../adr/0031-frontend-plugins-on-the-data-api.md)):

- nothing to install or start by hand: `npm run dev` brings PostgreSQL, a fake model and a fake mail
  server; the tests need no Docker;
- pull requests are merged by auto-merge when the required checks (`frontend`, `backend`, `e2e`,
  about 4 minutes) pass, and documentation-only ones in about a minute;
- new apps start as frontend-only extensions on the data API of the kernel, active without a restart;
  a backend comes only when an app needs it;
- federation with realms per organization, isolated frames, the MCP server, the portable
  distribution, the Helm chart and the signed marketplace are kept as they are and tested every
  night, without new work until an installation needs it.

Estimates are in weeks of 30 hours.

| Phase | Release | Content | Requirements | Weeks | Status |
|---|---|---|---|---|---|
| F0 Lean development | | Development without manual infrastructure, fast and full CI lanes, data API for frontend-only extensions, changed extensions shown at once in development | MK-046 | 1 | done |
| F1 Shell | 0.2 | UI kit on Fluent UI with the theme for public administrations; sign-in page with "remember me"; local registration confirmed by mail, which administrators turn off; shell like Teams (app bar, top bar, menu of the person); settings; apps per organization; progressive web app | MK-026, MK-047, MK-048, MK-025, MK-027, MK-030; MK-028, MK-029 | 4–5 | done |
| F2 Collaboration | 0.3 | Real-time channel, teams as groups with guests, activity feed, `app-teams` (channels, posts, threads, mentions, reactions, tabs), `app-chat` | MK-031, MK-032, MK-034, MK-035, MK-036, MK-038 | 7–9 | done |
| F3 Search | 0.4 | Global search with pills and providers of the extensions | MK-040 | 2–3 | |
| F4 Resources, sharing and permissions | 0.5 | Registry of the resources of extensions; permissions declared by manifests and granted through profiles, groups and people; one sharing model (person, group, organization, link, public); audit log; personal access keys; secrets store; quotas; S3-compatible storage and file service with signed, expiring links; read-only views of people and teams for external services, service identities, sessions ended on the server; platform events for extension backends, credentials of the installation, external origins allowed by the content security policy, settings of extensions in every distribution | MK-054, MK-056, MK-055, MK-059, MK-060, MK-062, MK-076, MK-041, MK-093, MK-123, MK-124, MK-125, MK-085, MK-127, MK-128, MK-129 | | |
| Composition | 0.6 | Products composed from the common extensions of `mosaikit-ext` ([ADR-0041](../adr/0041-common-extensions-composed-by-products.md)): libraries brought by Java extensions, required and optional dependencies between extensions, presence of other extensions on the server and in the frontend, versioned contracts between extensions, references between resources that survive an absent extension | MK-131, MK-132, MK-133, MK-134, MK-135 | | |
| F5 Console | 0.7 | Administration of platform and organizations on one model, home of widgets, list and empty-state patterns, branding per organization, deep links, tags, embedding, favorites, trash, versions, access requests, transfer of resources | MK-072, MK-101, MK-105, MK-074, MK-099, MK-097, MK-100, MK-094, MK-095, MK-096, MK-058, MK-071 | | |
| F6 Events, mail, files and collaboration | 0.8 | outgoing mail, notifications by mail; `app-files` with files of teams, channels and chats, connectors `ext-files-*`, retention with audit; presence; the assistant as a bot | MK-087, MK-088, MK-042, MK-043, MK-044, MK-033, MK-037 | | |
| F7 Distributions | 0.9 | Companion services started by the portable launcher, single-organization mode | MK-121, MK-073 | | |
| Later | | Push notifications, calendar, and the other proposed requirements | MK-039, MK-045, and the `proposed` ones in `docs/requirements` | | |

The phases are kept in step with the products built on Mosaikit, which need F4, Composition and F5
first; a requirement is `planned` when it is in a phase, and `proposed` while it waits. Estimates of
the new phases come when they start.

## In every phase

- The end-to-end tests of every requirement in `tests/e2e/`, on a real installation, with axe-core for
  the accessibility of the screens (WCAG 2.1 AA); the automated tests of each requirement
  (`@Tag("MK-xxx")`).
- The guides of [docs/guide](../guide/README.md) and of extension development for what changed, and the
  release notes.

## Order inside the phases

- **F1.** UI kit and themes (MK-026), sign-in and registration (MK-047, MK-048), then the frame of
  the shell (MK-025) with the sample extensions moved to `rail.app`, then settings (MK-027), apps per
  organization (MK-030), PWA and theme extensions.
- **F2.** Real-time channel (MK-031) and groups (MK-032) first: everything else needs them. Then
  the activity feed (MK-038), `app-chat` (MK-036), which is smaller and proves the real-time path,
  then `app-teams` (MK-034, MK-035), presence and the bot.
- **F4.** The registry of resources (MK-054) first: sharing, favorites, trash, versions, tags and
  search of resources all build on it. Then permissions (MK-056) and sharing (MK-055), then the
  rest.
- **Composition.** Dependencies (MK-132) and presence of other extensions (MK-133) first, since
  the others rely on them; then libraries (MK-131) and contracts (MK-134), then references between
  resources (MK-135).
- **F6.** Storage and file service (MK-041, in F4) before `app-files`; the connector to WebDAV
  first, because Nextcloud and many document services speak it.

## Repositories

`app-teams`, `app-chat`, `app-files`, `app-calendar` and the connectors `ext-files-<service>` are
extension repositories of the organization ([ADR-0024](../adr/0024-hosting-on-github.md),
[ADR-0025](../adr/0025-github-pages-and-maven-namespace.md)), created with
`@mosaikit/create-extension` when their phase starts. The kernel, the shell, the UI kit and the
requirements of the platform stay in this repository.

The common extensions that products compose (a file catalog, dashboards, processes) are in
`mosaikit/mosaikit-ext`, with requirements of their own (`EXT-nnn`); the sample extensions for
extension developers are in `mosaikit/mosaikit-ext-samples`
([ADR-0041](../adr/0041-common-extensions-composed-by-products.md)).
