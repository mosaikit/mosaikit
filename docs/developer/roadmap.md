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
- new apps start as frontend-only plugins on the data API of the kernel, active without a restart;
  a backend comes only when an app needs it;
- federation with realms per organization, isolated frames, the MCP server, the portable
  distribution, the Helm chart and the signed marketplace are kept as they are and tested every
  night, without new work until an installation needs it.

Estimates are in weeks of 30 hours.

| Phase | Release | Content | Requirements | Weeks | Status |
|---|---|---|---|---|---|
| F0 Lean development | | Development without manual infrastructure, fast and full CI lanes, data API for frontend-only plugins, changed plugins shown at once in development | MK-046 | 1 | done |
| F1 Shell | 0.2 | UI kit on Fluent UI with the theme for public administrations; sign-in page with "remember me"; local registration confirmed by mail, which administrators turn off; shell like Teams (app bar, top bar, menu of the person); settings; apps per organization; progressive web app | MK-026, MK-047, MK-048, MK-025, MK-027, MK-030; MK-028, MK-029 | 4–5 | done |
| F2 Collaboration | 0.3 | Real-time channel, teams as groups with guests, presence, activity feed, `app-teams` (channels, posts, threads, mentions, reactions, tabs), `app-chat`, the assistant as a bot | MK-031, MK-032, MK-034, MK-035, MK-036, MK-038; MK-033, MK-037 | 7–9 | in progress: MK-031, MK-032, MK-034, MK-035, MK-036, MK-038 done |
| F3 Search and push | 0.4 | Global search with pills and providers of the plugins; push notifications of the browser | MK-040; MK-039 | 3–4 | |
| F4 Files | 0.5 | S3-compatible storage and file service, `app-files` with files of teams, channels and chats, connectors `ext-files-*` (WebDAV and Nextcloud first, then GeoNode, CKAN, S3), retention with audit | MK-041, MK-042, MK-044; MK-043 | 4–5 | |
| F5 Apps of Geoportal and verticals | 0.6 | `app-data`, `app-maps`, `app-dashboards`, `app-processes` ported from Geoportal, as apps of the app bar and tabs of the channels; mockups of the verticals Citizy (smart city: the management of a city) and Searen (identification and collection of oil spills at sea) built on them | in the repositories of the apps | 8–12 | |
| Later | | Calendar, eDiscovery, online editing of documents, meetings, OpenSearch | MK-045 | | |

In each row the requirements before the semicolon are needed for the release; the others (P2) can
move to the next release without blocking it. At 30 hours a week F1 to F5 take about 26 to 35
weeks: with F1 started in October 2026, the release 0.6 with the apps of Geoportal and the mockups
of the verticals falls between April and June 2027.

## In every phase

- The end-to-end tests of every requirement in `e2e/`, on a real installation, with axe-core for
  the accessibility of the screens (WCAG 2.1 AA); the automated tests of each requirement
  (`@Tag("MK-xxx")`).
- The guides of [docs/user](../user/README.md) and of plugin development for what changed, and the
  release notes.

## Order inside the phases

- **F1.** UI kit and themes (MK-026), sign-in and registration (MK-047, MK-048), then the frame of
  the shell (MK-025) with the sample plugins moved to `rail.app`, then settings (MK-027), apps per
  organization (MK-030), PWA and theme plugins.
- **F2.** Real-time channel (MK-031) and groups (MK-032) first: everything else needs them. Then
  the activity feed (MK-038), `app-chat` (MK-036), which is smaller and proves the real-time path,
  then `app-teams` (MK-034, MK-035), presence and the bot.
- **F4.** Storage and file service (MK-041) before `app-files`; the connector to WebDAV first,
  because Nextcloud and many document services speak it.
- **F5.** The apps of Geoportal one at a time, `app-data` first; the verticals Citizy and Searen
  as mockups made of those apps and of frontend-only plugins.

## Repositories

`app-teams`, `app-chat`, `app-files`, `app-calendar` and the connectors `ext-files-<service>` are
plugin repositories of the organization ([ADR-0024](../adr/0024-hosting-on-github.md),
[ADR-0025](../adr/0025-github-pages-and-maven-namespace.md)), created with
`@mosaikit/create-plugin` when their phase starts. The kernel, the shell, the UI kit and the
requirements of the platform stay in this repository.
