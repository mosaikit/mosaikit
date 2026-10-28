# Changelog

What changes from one version of Mosaikit to the next. The shell shows the section of its own version
in Help › What is new (one `## <version>` heading per version, `- ` items, `### ` groups), in the
language of the person: this file in English, [CHANGELOG.it.md](CHANGELOG.it.md) in Italian (keep them
in step).

## 1.0.0

### The shell

- A new interface for every role, in English and Italian, with light, dark and automatic mode.
- The top bar is decided by the Administrator: logo and name, search, language, help and mode.
- Themes: Mosaikit, Italia and Tessera, plus the themes made with the theme editor, checked for
  contrast (WCAG 2.1 AA). High contrast for whoever reads with effort.
- Search everywhere: pages, apps and the items of the apps you can see (Ctrl K).
- Help: a guided tour of the main pages, the guide, what is new and the keyboard shortcuts.
- Overviews of widgets for every role: the apps as a compact strip, fast figures, notifications, recent activity, due dates and, for the Administrator, the tenants by storage, requests and recent errors.
- The overviews fill the page without gaps (a dense grid of four, two or one columns). The Administrator sees one card per app, with small charts of items and space, and a chart of the space by app.
- Headers, filters and tabs stay in place. Pages that are a list or a table do not scroll as a whole: the list fills the page and scrolls inside, with its header row in sight, and loads more as you scroll. The pages of the apps have the same header as the pages of Mosaikit, and a page with subsections (System, Monitoring, Settings, Usage, Account, Notes) shows both the page and the selected subsection in its header. The sidebar scrolls, closed or open, and shows its scrollbar only under the mouse.
- Long lists and tables load a page at a time, with a count and «Load more» (or as you scroll), including the Log.

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

- A plugin can call an outside service with the key an Administrator set: `http.fetch` takes a `key` (a service of `[[service_keys]]`) and the host adds it as a bearer token; the address may be the one set in Keys of outside services (`address = true`). Requests of plugins go through the same guard as the page probe (public addresses only). The SDK has `ctx.http().fetch_with_key(...)`.
- Notes translates a note with a translation service (Translate note, under the note), as the example.
- The manifest brochure (details, pictures, author, licence, link) shows as a full page in the plugin detail; the official plugins now come with pictures and texts.

- `mountCrud` can draw the items itself (`views`: list, cards or board, with a switch) next to a detail panel and a reading pane (`reader`); `avatar`, `chip` and `el` are shared helpers.
- The logic of a plugin knows the groups of the person who calls it (`ctx.groups`).
- The logic can notify the person who calls it, or the people who can see one of its items, with the
  new `notify` host operation (`[permissions] notify = true`, `ctx.notify` in the SDK).

### The platform

- Administrators have a required, unique email. They change their own from Account (current password and second factor) and the name and email of another Administrator from System › Administrators.
- System › Email says what is missing and how to set it up, with a preset for a local test server (Mailpit in the development setup).

- Tenants with a trial period, archived or deleted, exported and imported again.
- Backups every day, with the restore of a whole tenant or of one item.
- Maintenance mode, also planned in advance, with a notice for everybody.
- Monitoring of the services, the performance, the errors and the capacity, with alerts.
- A new language is a plugin: once installed it appears in the language menus. The Spanish plugin now translates the whole interface and the texts of every official plugin.
