# Mosaikit — Manual tests

Manual checks of what each phase of [ui-plan.md](ui-plan.md) delivers, to run by hand in the development
environment at the end of a phase. The automated tests (Rust, vitest, Playwright e2e) cover the same flows;
these checks are for a person looking at the product: what it looks like, how it reads, whether it does
what the mockup ([docs/mockup](mockup/README.md)) promises.

The document grows with the plan: every phase adds its section when it is committed.

**Every check is automated too.** Each id has its twin in `tests/manual/checks` (one Playwright test per
id, titled with the id), run on a new installation seeded like the development environment:

- The automated suite runs only on an explicit release request (about one hour); while working run one area, e.g. `cargo xtask manual-tests --area P3-`.
- `cargo xtask manual-tests` runs them all; `cargo xtask manual-tests -- --grep P3-12` runs one;
- `cargo xtask manual-tests --check` (not part of `cargo xtask ci`; run it when you add checks) fails if an id of this document has
  no automated test or an automated test has no id here, so a new check needs both;
- screenshots go to `tests/results/raw/manual-screens/<id>.png`, the results to the report of the
  automated tests; a check that cannot run automatically (Docker, an outside crawler…) is reported as
  skipped with the reason, and a known defect as an expected failure with its finding in
  [reports/qa-walkthrough.md](reports/qa-walkthrough.md).

Running them by hand stays useful: the automated checks see what can be measured, a person sees how it
looks and reads.

## Setup

1. From the `mosaikit` folder: `cargo xtask dev` (development PostgreSQL, plugins, server, Vite). Wait for
   the line `app: http://127.0.0.1:5173`.
2. Open **http://127.0.0.1:5173** in Edge or Chrome. A private window starts from a clean browser
   (no remembered language, theme or tenant).
3. After a change in `crates/**` the server is rebuilt and restarted: for a few seconds the page says
   that the server is not responding and retries by itself.

### Accounts of the development environment

| Who | Sign-in | Password | Email | Role |
|---|---|---|---|---|
| Administrator | `#/admin`, user `admin` | `admin-sviluppo` | `admin@example.test` | platform administrator (second factor at the first sign-in) |
| Elena Ricci | tenant *Comune di Roma*, `e.ricci` | `password-prova-1` | `e.ricci@example.test` | Tenant Manager |
| Marco Esposito | *Comune di Roma*, `m.esposito` | `password-prova-1` | `m.esposito@example.test` | Tenant Manager |
| Sara Greco | *Comune di Roma*, `s.greco` | `password-prova-1` | `s.greco@example.test` | User |
| Luca Bianchi | *Comune di Roma*, `l.bianchi` | `password-prova-1` | `l.bianchi@example.test` | User |
| Davide Conti | *Comune di Roma*, `d.conti` | `password-prova-1` | `d.conti@example.test` | User, guest in *Regione Lazio* |
| Luca Verdi | *Regione Lazio*, `l.verdi` | `password-prova-1` | `l.verdi@example.test` | Tenant Manager |

Every account has an email address (it is required). `cargo xtask dev` gives the first Administrator
`admin@example.test` (`MOSAIKIT_ADMIN_EMAIL`); an Administrator created before this change adds it from
Account › Profile. The other accounts are created by you or by the automated seed with the addresses above.

On the sign-in page the **Username** field suggests these users and fills in the password (development
only). The Administrator needs an authenticator app (Google or Microsoft Authenticator, FreeOTP…): the first
sign-in shows a QR code, then 10 recovery codes; keep one, it replaces the app if needed.

If a test changes a password, a theme or a setting, put it back at the end so the next tests start from the
same state.

### How to report a problem

For each failed check write: the **id** of the check (e.g. `P1-07`), the account, what you did, what you saw
(a screenshot helps), what you expected. Text in the wrong language, a raw error code or something that
differs from the mockup counts as a problem too.

---

## Phase 0 — The new shell is the product

| Id | Check | Expected |
|---|---|---|
| P0-01 | Open http://127.0.0.1:5173 | Sign-in page: on the left the brand panel in the colours of the band, tiles in the top right corner (a few yellow), the official Mosaikit symbol (negative), the version at the bottom; on the right language, mode, the form, the legal links at the bottom right |
| P0-02 | Look at the browser tab | Favicon: the Mosaikit symbol (burgundy tiles, yellow tile) |
| P0-03 | Narrow the window under 1024 px (or a phone) | The brand panel disappears, the symbol and name stay above the form; no horizontal scroll |
| P0-04 | Sign in as `s.greco` | Home of *Comune di Roma*; sidebar: Home and the apps; top bar: sidebar button, tenant, search, language, mode, help, bell, person menu |
| P0-05 | Person menu | Account, Notifications, Access requests, Trash, Sign out |
| P0-06 | Open an app (e.g. Notes) from the sidebar | The app opens inside the shell; create an item |
| P0-07 | On that item: **Share** | Share dialog: people and groups with a level, public link, transfer of ownership |
| P0-08 | Create a public link, open it in a private window | The item read-only, without signing in |
| P0-09 | Help menu (?) | Guided tour of this page, Guide of Mosaikit, What is new, Keyboard shortcuts, version; each item opens (tour over the page, the guides, the notes of the version, the list of shortcuts) |
| P0-10 | Sign out, sign in as `e.ricci` | Sidebar with Tenant overview, the apps, Tenant management (Manage, Plugins, Shares, Usage) and Tenant settings at the bottom |
| P0-11 | Manage › People: tick a person | The action bar appears only with a selection |
| P0-12 | Manage › People › a person › Remove from the tenant | If the person owns items, asks who gets them (new owner); then removes |
| P0-13 | Shares | All the shared items of the tenant, filter by owner, app and title; Public filter; Revoke a public link |
| P0-14 | Usage | Figures of the tenant and the KPIs of the plugins |
| P0-15 | Sign in at `#/admin` as `admin` (second factor) | Platform overview with the KPIs; a stable "Platform" badge in the band |
| P0-16 | Sidebar of the Administrator | Platform overview, Tenants, People, Plugins, Monitoring, Log, System |
| P0-17 | Tenants › *Comune di Roma* | Breadcrumb, status badge, "⋯" menu with suspend/reactivate, tabs |
| P0-18 | Plugins | Installed, Updates, Catalog; activate, deactivate, Install from file |
| P0-19 | Dark mode (mode button), then light | Every page reads well in both modes; no white-on-white or invisible text |
| P0-20 | Stop the server (or wait for a rebuild) and reload the sign-in page | "The server is not responding. Trying again…", no "HTTP 502", no "No tenant available"; the form comes back by itself |

## Step 0b — English by default

| Id | Check | Expected |
|---|---|---|
| P0b-01 | Private window with the browser in English (or any language but Italian) | Sign-in and shell in English |
| P0b-02 | Language menu (top bar or sign-in): Italiano | Everything in Italian at once, including the apps; reload: the choice is kept |
| P0b-03 | Browser set to Italian, private window | Italian by default |
| P0b-04 | Sign in with a wrong password, in English and in Italian | A clear message in the chosen language, never a code |
| P0b-05 | Open `#/login/comune-roma` | Sign-in with the tenant already chosen, in the theme of that tenant if it has one (P1-10) |
| P0b-06 | Share a link to the sign-in page in Teams or a chat (needs an address reachable from outside; skip in pure local development) | A preview card with the Mosaikit image |

## Phase 1 — Settings on three levels

As Administrator (`#/admin`) unless said otherwise.

| Id | Check | Expected |
|---|---|---|
| P1-01 | System | Sections: Administrators, Passwords and sessions, Keys of outside services, Embedding, Email, Identity and appearance |
| P1-02 | System › Identity and appearance › Identity and texts: change the welcome text, upload a light and a dark logo (SVG or PNG), save | The save bar appears only after a change; the sign-in page shows the new text and logo |
| P1-03 | Upload a file that is not an image, or a big one (> 512 KB) | Refused with a clear message |
| P1-04 | Theme and mode: choose **Tessera**, save | Burgundy band and accent for the Administrator; the sign-in page in a private window uses Tessera too |
| P1-05 | Languages and formats: offer only English | The language menu disappears for everybody; put Italian back afterwards |
| P1-06 | Top bar: turn off search and help | For every tenant: no search box, Ctrl K does nothing, the help items move into the person menu; logo off: the sidebar button takes the corner. Put everything back on |
| P1-07 | Passwords and sessions: minimum length 12 | As `s.greco`, Account › Sign-in and security › Change password: the hint reads «At least 12 characters»; with a 10-character password **Update password** stays disabled |
| P1-08 | Tenants may customize it: turn off for the theme | As `e.ricci`, Tenant settings: the theme row is locked ("Managed by the Administrator") |
| P1-09 | Put the minimum back to 10 | — |
| P1-10 | As `e.ricci`: Tenant settings › Identity and appearance › Theme: choose a theme other than the platform one (Mosaikit if the platform is on Tessera after P1-08; switch of P1-08 on again) | Marked **Customized**, the whole tenant in that theme; **Restore** goes back to the platform theme (**Inherited**) |
| P1-11 | As `e.ricci`: Passwords and sessions | Values with "Platform minimum: N"; a value below the platform minimum is refused, a stricter one is accepted |
| P1-12 | As `e.ricci`: Managed by the platform | Sign-in method and the other platform rules shown read-only with a padlock |
| P1-13 | As `e.ricci`: Identity and texts: tenant name and logo | They show in the band (tenant switcher) and on `#/login/comune-roma` |
| P1-14 | As Administrator: Keys of outside services: add a key, mark it shared with tenants | After saving only the last four characters show; the switch «Shared with every tenant» appears on the saved key; Change and Remove work |
| P1-15 | As `s.greco`: Account › Keys: add a personal key | Saved and masked; the Administrator has no Keys section in Account |
| P1-16 | As Administrator: Embedding: add a site | Accepted; as `e.ricci` the tenant can choose only among the platform's sites |

## Step 1b — Plugins in English and Italian

| Id | Check | Expected |
|---|---|---|
| P1b-01 | As `s.greco`, English | Sidebar and pages of the apps in English (Notes, Tasks, Contacts, Documents, Maps, Apps) |
| P1b-02 | Switch to Italiano | Names in the sidebar ("Note", "Attività"…), fields and choice values ("personale", "lavoro") in Italian, without signing in again |
| P1b-03 | Notes: create a note with a tag, switch language | The same note, the tag shown in the language of the moment |

## Phase 2 — Notifications

| Id | Check | Expected |
|---|---|---|
| P2-01 | As `l.verdi` (*Regione Lazio*): invite `s.greco` of *Comune di Roma* (Manage › Pending › Invite: type her address, Home tenant shows *Comune di Roma*) | — |
| P2-02 | In another window signed in as `s.greco` (no reload) | The bell gets a badge by itself |
| P2-03 | Open the bell panel | The invitation with Accept and Decline, "Mark all as read", a gear, "See all" |
| P2-04 | Accept | `s.greco` can switch to *Regione Lazio* from the tenant switcher; `l.verdi` gets a notification of the answer |
| P2-05 | Share an item with another person | That person gets a notification with a link that opens the item |
| P2-06 | Create a public link on your item while someone else owns it, or vice versa | The owner is notified |
| P2-07 | See all | The Notifications page: filters (Unread, kind, period, search), selection with mark read / delete |
| P2-08 | Mark all as read | The badge disappears |
| P2-09 | Gear (or Account › Notifications) | Emails: off / immediately / daily digest; for each kind the checkboxes In the app and Email; saved after reload |
| P2-10 | As Administrator: System › Email | SMTP server, port, TLS, user, password (masked after saving), sender, footer, test message. Without a mail server in the development environment the test message fails with a readable message; with a local catcher (e.g. Mailpit on port 1025) the message arrives |
| P2-11 | Dark mode on the panel and the page | Readable, unread dot visible |

## Phase 3 — People and permissions

As `e.ricci` (Tenant Manager of *Comune di Roma*) unless said otherwise.

| Id | Check | Expected |
|---|---|---|
| P3-01 | Manage | Sections People, Groups, Permission profiles, Pending; the people table shows role and profile, groups, status, last sign-in |
| P3-02 | Permission profiles | The profile *Standard* (Default) with its people and, for each plugin, what it gives |
| P3-03 | New profile «Reader» | It appears; in its menu: Edit the permissions, Duplicate, Use for new invitations, Delete |
| P3-04 | Plugins › Notes › Access and permissions | What each permission means (Use the app, Create items, Delete items, Share items); a row per profile with check boxes; Groups and people empty |
| P3-05 | Untick Create, Delete and Share for «Reader», Save | The save bar appears only after a change; «Permissions saved» |
| P3-06 | Manage › People › Sara Greco (click the name) | Her page: tabs Profile, Sign-in, Permissions, Activity; breadcrumb back to Manage |
| P3-07 | Profile tab: Permission profile → Reader | «Profile updated»; in People her profile reads Reader |
| P3-08 | Permissions tab | Notes: Use the app ✓ (Profile Reader), Create items — ; the other plugins still from her profile |
| P3-09 | As `s.greco`, open Notes and try to create a note | Refused: «Your permission profile does not allow it» |
| P3-10 | As `e.ricci`, Plugins › Notes › Access and permissions › Add a group or person › Sara Greco, tick Create items, Save | As `s.greco` creating a note works again; her Permissions tab shows Create items from «Personal» |
| P3-11 | People: tick two people, «Change profile», «Add to a group», «Suspend» | The action bar appears only with a selection; each action applies to all of them |
| P3-12 | A suspended person (e.g. `l.bianchi`) signs in | The tenant is not offered to them any more; reactivate from their page («⋯» › Reactivate in the tenant) |
| P3-13 | Groups: click a group | Group page: Members (add, remove), Shared items, Plugins (what the group adds) |
| P3-14 | As `e.ricci`, create a note in Notes and copy its address; take the identifier after the last `/` | — |
| P3-15 | As `s.greco` open `#/t/comune-roma/item/<identifier>` | «You cannot see this item» with Access (See, Edit) and a message; Send the request; «Request sent» |
| P3-16 | As `e.ricci`: the bell | «Sara Greco asks to see «…»»; Manage › Pending lists it under Access requests with Approve and Refuse (Forward to the owner only when the manager is not the owner of the item) |
| P3-17 | Approve | `s.greco` gets «… gave you access to …»; the same address now opens the note in Notes |
| P3-18 | Sara's page › Permissions › «Why can't they see an item?» with an identifier | The steps (account, membership, use of the app, owner, shared) with ✓ or — |
| P3-19 | Sara's page › Sign-in | Send the password link: a dialog with the link to copy («it works once, until <date>»); her open sessions, Close and Close every session |
| P3-20 | Open the link in a private window | «Choose a new password» with the rule of the tenant; after saving, «Done: sign in with the new password.»; the link does not work a second time |
| P3-21 | A guest (`d.conti` seen from *Regione Lazio* as `l.verdi`) › Sign-in tab | It says that the home tenant handles password and sessions |
| P3-22 | As Administrator: the sidebar | A new item People |
| P3-23 | People | Every person (Administrators too), pills All / In several tenants / Administrators, filters by tenant, role, status, search; the Administrators link to System › Administrators |
| P3-24 | New person (home tenant, role, profile; no password) | Created; a dialog with the link to choose the password |
| P3-25 | A person › Tenants | Role and profile per tenant, suspend or remove (not the home), Add to a tenant, Move the home tenant (the person then signs in from the new one) |
| P3-26 | Select people › Send the password link | One link per person, Copy all |
| P3-27 | Italian | Every new page and message in Italian |
| P3-28 | Dark mode on the new pages | Readable, check boxes and badges visible |

## Phase 4 — Plugins

The dev environment loads the plugins of `mosaikit-plugins` from their folders (development mode), among them the sample extension *Note review*. Plugins in development mode cannot be uninstalled and there is no catalog: P4-03 and P4-20 need an installation (Docker or desktop release) or `cargo xtask e2e`, which installs them from a registry.

| Id | Check | Expected |
|---|---|---|
| P4-01 | As Administrator: Plugins | Every plugin with its icon, kind (App, Service, Extension) and version; *Note review* is an Extension; the filter Apps / Services / Extensions narrows the list |
| P4-02 | Tick two plugins | The selection bar appears only now: Update (when an update exists), Turn off, Uninstall, Deselect |
| P4-03 | Updates and Catalog | Updates lists only newer versions with what they bring (release notes); Catalog what is not installed yet |
| P4-04 | Click *Notes* | Its page: breadcrumb to Plugins, status badge, tabs Overview, What it asks, Tenants, Extensions; the "⋯" menu has Turn off and Uninstall |
| P4-05 | What it asks | What the plugin uses: logic on the server, hooks, files, network, other plugins, database (the permissions it brings are listed in Access and permissions, not here) |
| P4-06 | Extensions tab | *Note review* (active); a link opens its page, whose What it asks lists the field «Reviewed» and the action «Mark as reviewed» |
| P4-07 | Tenants tab | One row per tenant: Available switch, whether the tenant turned it on, Restore when the tenant has its own choice; the switch «Available to every tenant» on top |
| P4-08 | Turn off «Available to Regione Lazio» | «Availability updated»; Tenants › Regione Lazio › Plugins tab: Notes «not available» |
| P4-09 | As `l.verdi` (Tenant Manager of Regione Lazio) | Notes is gone from the sidebar and from Plugins; the bell says «Notes is no longer available to the tenant»; *Note review* says «Turn on Notes first» |
| P4-10 | As Administrator: Restore for Regione Lazio | Available again; `l.verdi` gets «Notes is available to the tenant» |
| P4-11 | As `e.ricci`: Tenant management › Plugins | The plugins available to Comune di Roma with kind, version, an On switch, Access and permissions, Open for the apps |
| P4-12 | Turn Tasks off | «Turned off for the tenant»; Tasks leaves the sidebar of everybody in the tenant (as `s.greco`, after a reload: no Tasks) |
| P4-13 | Turn Notes off | A confirmation names the extensions that go off with it (*Note review*); after it, *Note review* says «Turn on Notes first»; turn Notes and Tasks on again |
| P4-14 | As `s.greco`: Notes, open a note | A column «Reviewed», and in the detail a box *Note review* with Reviewed, Reviewed by and the button «Mark as reviewed» |
| P4-15 | Mark as reviewed | The box ticks, «Reviewed by» shows Sara Greco, the column shows ✓ |
| P4-16 | A note shared with `s.greco` read only | Fields of the extension read only, no button |
| P4-17 | Switch to Italiano | «Revisionata», «Segna come revisionata»; kinds App / Servizio / Estensione in the pages of the plugins |
| P4-18 | A public link to a note, then turn Notes off in the tenant | The link stops working; on again, it works again |
| P4-19 | As Administrator: a plugin with settings (`[[config]]`), Configuration tab | A field per setting; secrets show «Saved: type to replace» and never their value; the save bar appears only after a change (none of the official plugins has settings yet: try with a package of your own) |
| P4-20 | Uninstall *Note review* (⋯ › Uninstall) | The confirmation says how many items and tenants are touched; the extension disappears, Notes keeps working; reinstall it from Catalog (Install): it comes back in the state it had before (on, with the tenants that had it), the platform remembers it |
| P4-21 | Dark mode on the new pages | Readable; switches and badges visible |

## Phase 5 — Shares, Trash, Log

As `e.ricci` (Tenant Manager of *Comune di Roma*) unless said otherwise. Notes from the Notes app are
enough as items.

| Id | Check | Expected |
|---|---|---|
| P5-01 | As `s.greco`: create a note, share it with `l.bianchi` and create a public link (Share) | — |
| P5-02 | As `s.greco`: Home | Section **Shared by me** with the note, «with Luca Bianchi · 1 public link», buttons Share and Revoke all |
| P5-03 | Revoke all, Confirm | The note leaves the section; the public link opened in a private window says it is not valid; `l.bianchi` no longer sees the note |
| P5-04 | As `s.greco`: share the note again with a public link; as `e.ricci`: Shares › pill **Public and links** | The note of Sara Greco with 1 public link; a check box on the rows that have shares or links |
| P5-05 | Tick it (or several) › **Revoke shares and links**, Confirm | «Revoked: 0 shares, 1 public links»; the row leaves the list; Sara Greco still owns the note |
| P5-06 | As `s.greco`: delete the note in Notes | It disappears from Notes and from the Home figures |
| P5-07 | Person menu › **Trash** | The note with app, when it was deleted and by whom, size, the day it will be deleted for good (30 days later) |
| P5-08 | Restore | «Restored»; the trash is empty; the note is back in Notes with its shares and links (if it had any) |
| P5-09 | Delete it again, then in the Trash the bin icon of the row › Confirm | «Deleted for good»; it cannot be restored any more |
| P5-10 | Delete two notes; Trash: select both › Restore; again › Delete for good | The bar of the selection appears only with a selection; both restored, then both gone |
| P5-11 | Empty the trash (with something inside) | Confirmation; what Sara owns or deleted is deleted for good |
| P5-12 | As `e.ricci`: Trash | The whole trash of the tenant, with the column Owner; Restore works on the items of others too |
| P5-13 | As `l.bianchi`: Trash, while Sara's note is in the trash | Not shown: only what one owns or deleted |
| P5-14 | In the Documents app: delete a folder with files, then Trash | One row for the folder (its size counts the files); Restore brings back the folder and its files |
| P5-15 | Sign out, sign in as `s.greco` with a wrong password, then as `e.ricci`: **Log** (sidebar, Tenant management) | The events of the tenant, the latest first: when, who, what (in words), on what, result |
| P5-16 | Pill **Only failures** | «Sign-in refused» for Sara Greco, result Failed |
| P5-17 | Filters Who = Sara Greco, What = Items, period Last 24 hours, search «note» | Only her events on items: Created, Moved to the trash, Restored from the trash, Deleted for good |
| P5-18 | Click an event | Side pane: who, result, app, item, event name, address, browser, details; buttons «Only Sara Greco» and «Only this item» |
| P5-19 | Only this item | A filter chip «Only this item» with its ×; the table shows the history of that note |
| P5-20 | Tick two events › Export the selected; then «Export everything as CSV» | Two CSV files: the selected events, then all the events of the filters (opens in a spreadsheet, accents included) |
| P5-21 | Older events (with more than 50 events) | The next 50 below |
| P5-22 | Manage › People › Sara Greco › Activity | Her events, the same descriptions as the Log, «See everything in the log» |
| P5-23 | Manage › Groups › a group › Activity, after adding and removing a person | «Added a person to a group», «Removed a person from a group» |
| P5-24 | As `s.greco`: open `#/t/comune-roma/log` | «Reserved to Tenant Managers» |
| P5-25 | As Administrator: **Log** (sidebar) | Every tenant, column Tenant; filter Tenant = *Comune di Roma* shows only its events; a person's page › Activity shows the person everywhere |
| P5-26 | As Administrator: System › **Retention** | Trash kept (30) and Log kept (365) days; values outside 1–365 / 30–3650 refused |
| P5-27 | Italian, and dark mode, on Trash, Log, the side pane and Shares | Everything translated (events too) and readable |

## Phase 6 — Quotas and usage

Quotas are off until the Administrator sets them: put every quota back as it was at the end (Restore,
or empty fields in System › Quotas). Storage is in GB (1 GB = 1024 MB).

| Id | Check | Expected |
|---|---|---|
| P6-01 | As Administrator: System › Quotas | «Quotas of new tenants» (Storage, People, Items, empty = no limit), «Capacity of the platform» with what is given to the tenants and what they use, the tenants with their usage and quotas |
| P6-02 | Capacity: People 1, save | The save bar appears only after the change; a warning «More is given than the platform has: people» and «Over the capacity» (tenants without a limit while a capacity is set); empty it again |
| P6-03 | Tenants › Comune di Roma › Details | A Quotas box: each quota «Of the platform: …» with Customize; Used: … |
| P6-04 | Items: Customize, type a number a little above what Comune di Roma has, save | «Of this tenant», «Quotas of the tenant saved»; System › Quotas shows it in the tenant row with «of this tenant» |
| P6-05 | As `e.ricci` (Tenant Manager): Usage | Sections Quotas, Trend, Who uses the most, Activity, Alerts; Quotas read only with «Managed by the Administrator», a bar per quota, «At the limit: …» and, when growing, «At the pace of the last 30 days the limit arrives in about N days» |
| P6-06 | Create notes until the quota of items is reached | Above 80 % an alert appears at the bottom of the sidebar (also for `s.greco`); the bell of `e.ricci` gets «Items of Comune di Roma: N% of the quota» (within a few seconds); at 100 % «the quota is used up, additions stop» |
| P6-07 | One more note | Refused; the plugin says the quota of the tenant is used up; nothing is created |
| P6-08 | Delete two notes, create one | Still refused: the notes in the trash count until they are deleted for good (Usage › Activity shows «of which in the trash»); restoring one works; empty the trash, then a new note is created; the 80 % alert comes again only after the usage went below 80 % and back above |
| P6-09 | As Administrator: Comune di Roma › People quota equal to its people today | As `e.ricci`: Manage › New user → «The tenant has reached one of its quotas…» (Italian: «Il tenant ha raggiunto una delle sue quote…»); an invitation to a person of Regione Lazio is refused the same way |
| P6-10 | Suspend a person, then create the user again | Works (a suspended membership does not count); reactivating the suspended person is refused while the tenant is full |
| P6-11 | As Administrator: Storage quota 0.001 GB (about 1 MB) for Comune di Roma | As `s.greco`: upload a file of a few MB in Documents → refused; a smaller file replaces a bigger one without problems |
| P6-12 | As `e.ricci`: Usage › Trend | A chart per quota with the line of the limit and «Show as a table»; the history grows by one day a day (on a new installation only today) |
| P6-13 | Usage › Who uses the most | By person, by group (a person in two groups counts in both), by app: items and storage |
| P6-14 | Usage › Alerts | Switches at 80 %, at 100 %, Forecast; recipients: the Tenant Managers and chosen people and groups; save; only the chosen recipients get the next alert |
| P6-15 | Tenant settings › Managed by the platform | A Quotas row (Storage …, People …, Items …) with the padlock and a link to Usage |
| P6-16 | Tenant overview of `e.ricci` | A Usage panel with the bars and Details |
| P6-17 | As `s.greco`: Account › Usage | Their items and space; «What is left in the tenant» with the quotas of storage and items; without quotas «The tenant has no quotas…» |
| P6-18 | Italian, dark mode | Everything translated («Quote», «Consumi», «Andamento», «Chi consuma di più», «Avvisi»); bars and alerts readable in dark mode |
| P6-19 | As Administrator: Restore every quota of the tenants and empty System › Quotas | No limit again; the sidebar alert disappears |

## Phase 7 — Lifecycle of the tenants and operations

As Administrator (`#/admin`) unless said otherwise. The checks create and delete a test tenant (*Test
Town*, address `test-town`): Comune di Roma and Regione Lazio are only read.

| Id | Check | Expected |
|---|---|---|
| P7-01 | Tenants › New tenant | A dialog in four steps (Tenant, Sign-in, Tenant Manager, Summary) with the bar of the steps; Next is disabled until the step is complete |
| P7-02 | Step 1: Name *Test Town* | The identifier fills in by itself (`test-town`); Trial period: turn it on and choose a date 10 days ahead (the date is empty until chosen) |
| P7-03 | Step 2 | Local accounts chosen; Identity provider (OIDC) asks issuer and client id and says that roles and the check are on the Sign-in tab |
| P7-04 | Step 3 and 4: Tenant Manager `boss` with a password, Summary, Create the tenant | The summary lists what the platform prepares by itself; the page of the tenant opens with «on trial until …» |
| P7-05 | Details of Test Town | Below the details and the quotas: Trial period (date, Update the trial, Remove the trial), Logo of the tenant (read only, or «No logo»), Export, the red area Archive or delete |
| P7-06 | Export the tenant | A link `test-town-<date>.zip` with its size; it downloads a zip with `manifest.json`, `core/…`, `plugins/…` |
| P7-07 | Archive the tenant (confirm) | The confirmation lists what it holds; the badge becomes «archived»; signing in as `boss` is refused |
| P7-08 | ⋯ › Reactivate the tenant | Back to «on trial until …»; `boss` signs in again |
| P7-09 | Tenants › ⋯ › Import a tenant, choose the zip of P7-06 | «The tenant of this export exists. Replace it?»; confirming, the tenant comes back as it was at the export |
| P7-10 | Delete the tenant | A dialog with what goes away and «Type test-town to confirm»; Delete for good stays disabled until the address is typed; then the tenant disappears from the list |
| P7-11 | Import the zip of P7-06 again | Test Town comes back with `boss` (the same people, items and files); delete it again at the end |
| P7-12 | System › Maintenance: Maintenance mode on, notice «Upgrade, back at 10», Save, confirm | A yellow band «Maintenance mode is on · only the Administrators can work» on every page of the Administrator |
| P7-13 | In a private window: the sign-in page | The notice «The platform is under maintenance» with the text; signing in as `s.greco` is refused with «The platform is under maintenance: only the Administrators sign in»; a public link answers with the maintenance page |
| P7-14 | A session of `e.ricci` opened before | At the next action it goes back to the sign-in page with the notice |
| P7-15 | Maintenance off, Save | The band disappears; `s.greco` signs in again |
| P7-16 | Planned maintenance: a start 5 minutes ahead and a notice, Save | Everybody (also `s.greco`, in the shell) sees «Maintenance planned on …» within a minute; at the time the mode turns on by itself (wait, then turn it off) |
| P7-17 | System › Backup and restore › Run now | A row «running», then «complete» (PostgreSQL with a `pg_dump` of the same version in the PATH, or SQLite) or «tenants only» with the reason (no usable `pg_dump`); size and number of tenants; Download gives the zip with `README.txt` |
| P7-18 | Restore a tenant on a backup | The tenants inside; restoring one that exists asks to replace it |
| P7-19 | Schedule: hour and backups kept, Save | Saved; with «Backups kept» 1 and another Run now only the last backup stays |
| P7-20 | Monitoring › Status | Database, Storage of the contents, Emails (off without a mail server), Background work, Plugin runtime, Backups, and the identity providers of OIDC tenants, each with its state; a row opens its detail |
| P7-21 | Performance, period 1 hour / 12 hours / 7 days | Charts of requests and errors, response time (p50, p95, p99), sessions and emails waiting; «Show as a table» gives the same numbers; a new installation says «No data yet» for the first minute |
| P7-22 | Errors | Server errors and error rate; the latest refused operations (e.g. a wrong password) with «See in the log» |
| P7-23 | Tenants | Requests in the last hour and day, people, items, space and the nearest quota of each tenant |
| P7-24 | Capacity | Disk of the data and memory as bars with what is free; database, contents, backups, memory of Mosaikit |
| P7-25 | Alerts: Free disk under 99 %, Save, wait a minute | «Alerts now» shows «Disk almost full»; the bell gets «Alert: …» once (not every minute); put the threshold back to 10 |
| P7-26 | Platform overview | The panels Services and To do (alerts, a failed backup, trials ending within a week, plugin updates) with links |
| P7-27 | Italian, dark mode, phone width | Every new page translated («Monitoraggio», «Backup e ripristino», «Manutenzione», «Archivia o elimina»); charts and badges readable in dark mode; the wizard usable on a phone |

## Phase 8 — Sign-in through the identity provider of a tenant (OIDC)

**Test identity provider.** In a second terminal, from the `mosaikit` folder:
`cargo run -p mosaikit-server --bin mosaikit-fake-idp` (it prints `test identity provider:
http://127.0.0.1:5556`). Client id `mosaikit`, client secret `fake-secret`. Its people, without
passwords (a button each):

| Person | Username | Groups |
|---|---|---|
| Anna Rossi | `anna.rossi` | `mosaikit-managers`, `staff` |
| Bruno Neri | `bruno.neri` | `mosaikit-users`, `staff` |
| Carla Bassi | `carla.bassi` | none |

Use a tenant made for the test (P8-01), not *Comune di Roma*: with the provider on, its local accounts
cannot sign in. At the end put it back to local accounts (P8-14).

| Id | Check | Expected |
|---|---|---|
| P8-01 | As Administrator: Tenants › New tenant `prova-oidc` «Prova OIDC», then its page › tab **Sign-in** | Two choices, Local accounts (chosen) and Identity provider (OIDC); Accounts: 1 local account |
| P8-02 | Choose Identity provider (OIDC); issuer `http://127.0.0.1:5556`, client id `mosaikit`, client secret `fake-secret`, text of the button «Test provider» | The addresses to register appear (return, back-channel logout, after the sign-out) with a copy button |
| P8-03 | **Check the configuration** | Every line green: discovery document, PKCE (S256), signing keys, sign-out at the provider, back-channel logout |
| P8-04 | Same check with issuer `http://127.0.0.1:1` | A red line with the reason, no raw code |
| P8-05 | Where roles come from: Groups of the identity provider; Tenant Managers `mosaikit-managers`, Users `mosaikit-users`; Save | A confirmation says the local account can no longer sign in; then «Sign-in saved»; the secret shows only its last four characters |
| P8-06 | Sign out; open `#/login/prova-oidc` | A button «Sign in with Test provider», no username and password |
| P8-07 | Click it, then «Sign in as Anna Rossi» on the page of the provider | Back in Mosaikit, in *Prova OIDC*, as Tenant Manager (Manage in the sidebar) |
| P8-08 | Account › Sign-in and security | «Identity provider of the tenant (OIDC)», no Change password |
| P8-09 | Manage › People | No «New user»; in the menu of a person no password link nor password reset |
| P8-10 | Sign out | The browser passes through the provider and comes back to the sign-in page |
| P8-11 | Sign in as Bruno Neri | User (no Manage) |
| P8-12 | Sign in as Carla Bassi | Back on the sign-in page: «Your account of the provider is not in a group allowed in this tenant» |
| P8-13 | Back-channel logout: with Anna signed in, run in a terminal `curl -X POST http://127.0.0.1:5556/_admin/backchannel -H "content-type: application/json" -d "{\"url\": \"<back-channel logout address of P8-02>\", \"sub\": \"anna.rossi\"}"` | The answer says 1 session or more; Anna's next action in Mosaikit asks to sign in again |
| P8-14 | As Administrator: tab Sign-in › Local accounts › Save | `#/login/prova-oidc` shows username and password again |
| P8-15 | As the Tenant Manager of a tenant with the provider: Tenant settings › Managed by the platform | Sign-in method «Identity provider of the tenant (OIDC)» with the padlock |
| P8-16 | Italian, and dark mode, on the Sign-in tab and on the sign-in page | Everything translated and readable |

## Phase 9 — Search, help and themes

| Id | Check | Expected |
|---|---|---|
| P9-01 | As `e.ricci`: Notes › a new note «Quarterly inspection» with the text «The pump of the north well needs a new seal» | Saved |
| P9-02 | Home, press `/` (not in a field) and type `north well` | The search opens; a pill **Notes 1** next to All, Pages, Apps; the note with a piece of its text around «north well» |
| P9-03 | Type `insp` | The note is found by the beginning of a word of its title |
| P9-04 | Arrows down to the note, Enter | The note opens in Notes |
| P9-05 | Ctrl K again, with the field empty | «Recent searches» lists `north well` (searches are remembered when one of their results was opened); choosing it searches again |
| P9-06 | As `s.greco` (same tenant): search `north well` | «No results»: the note of Elena is not shared with Sara |
| P9-07 | As `e.ricci`: share the note with Sara (read); as `s.greco` search again | Now found |
| P9-08 | As `e.ricci`: delete the note, search it | Not found (it is in the trash); restore it from the Trash: found again |
| P9-09 | As Administrator: search `roma`, then the name of one of its people (e.g. `greco`) | Pill Tenant: *Comune di Roma*; with the name, pill People: the person; a result opens the tenant or the person |
| P9-10 | As Administrator: System › Identity and appearance › Top bar: search off | No search box, `/` and Ctrl K do nothing; put it back on |
| P9-11 | As `s.greco`, on the Home: the help button (?) | A small dot: a guided tour of this page is waiting |
| P9-12 | Help › Guided tour of this page | The page darkens around the sidebar, a card «Step 1 of 5»; Next, Back, Skip the tour; Esc works, the arrow keys once the focus is in the card |
| P9-13 | Go to the end (Done), reload the page, sign in again from another browser | The dot is gone everywhere (the tour is remembered with the person) |
| P9-14 | As `e.ricci`: Manage, Plugins, Tenant settings; as Administrator: System | Manage and Plugins have their tour; System too (Administrator); Tenant settings has none (the item is greyed) |
| P9-15 | Help › Guide of Mosaikit | A dialog with the short guide; as Administrator, Identity and texts › Guide = an address: the item opens that address in a new tab (put it back empty) |
| P9-16 | Help › What is new in version 1.0.0 | The notes of version 1.0.0 (from `CHANGELOG.md`), in groups |
| P9-17 | Press `?` | Keyboard shortcuts: Ctrl K, `/`, `?`, `G H`, `G N`, `G A`, `G T` |
| P9-18 | Press `g` then `n`; `g` then `h`; `g` then `t` | Notifications, Home, Trash |
| P9-19 | Account › Appearance and language › High contrast on | Darker secondary texts and borders, thick focus ring, links underlined; the same from the mode menu (sun/moon) of the top bar |
| P9-20 | Reload, sign in from another browser | High contrast stays on; open an app: the plugin follows it; put it off |
| P9-21 | As Administrator: System › Identity and appearance › Theme and mode › **New theme**: name «Lagoon», main colour `#8fd8c8` | Two previews (light, dark); «Does it read?» lists the checks with their ratios, some in red; **Save the theme** is off |
| P9-22 | Fix it for me | «Everything reads»; Save the theme; the card «Lagoon» appears |
| P9-23 | Choose Lagoon as theme of the platform | The whole platform in the new colours, also the sign-in page in a private window |
| P9-24 | Put Mosaikit back; «Themes tenants may use»: Every theme off, Lagoon unticked | — |
| P9-25 | As `e.ricci`: Tenant settings › Identity and appearance › Theme and mode | Lagoon is not offered; **New theme** makes a theme of the tenant («made for this tenant»), editable and deletable |
| P9-26 | Choose the theme of the tenant, then delete it | The tenant uses it; after the delete it goes back to the theme of the platform |
| P9-27 | Italian and dark mode on the search, the help dialogs, the tour and the theme editor | Everything translated and readable |


## Phase 10 — Layouts and style

| Id | Check | Expected |
|---|---|---|
| P10-01 | As Administrator: System › Identity and appearance › Layout | Six cards: Teams, Console (built in), Workspace, Suite, Project, Tabs (plugins), each with a thumbnail |
| P10-02 | Choose **Console**, Save | The whole platform changes at once: sidebar as a card, breadcrumb in the band, tenant switcher in the navigation |
| P10-03 | Press Tab once on any page, then Enter | «Skip to the content» shows first; Enter moves the focus to the content |
| P10-04 | Repeat P10-02 and P10-03 with Workspace, Suite, Project and Tabs | Each arranges the frame as its card shows; the skip link, header, navigation and content are always there |
| P10-05 | In Suite open the grid button in the band | «All apps and pages» lists every app and page; a tile opens it |
| P10-06 | Narrow the window to a phone (400 px) in each layout | A menu button opens a drawer with the full tree (the grid in Suite); no horizontal scroll |
| P10-07 | Light, dark and High contrast in each layout | Everything reads |
| P10-08 | As `e.ricci`: in the navigation, Notes shows its pages (All notes, Mine, Shared, Tags › Personal, Work, Urgent) | A page opens the app on it; the breadcrumb shows app and page; a person without the permission of a page does not see it |
| P10-09 | With the rail closed (Teams) use the small arrow next to Notes | A flyout lists its pages |
| P10-10 | System › Layout: tick only Console and Teams under «Layouts the tenants may choose» | Tenant Managers are offered only those two |
| P10-11 | As Tenant Manager: Tenant settings › Layout | Inherited; **Customize**, choose another layout, Save: only that tenant changes; **Restore** goes back |
| P10-12 | Look for a layout choice in Account or the person menu | There is none: the layout is not personal |
| P10-13 | System › Style: set Corners Round, Density Compact, Font Humanist, Tabs Pill, Buttons Outline | The page previews each change before Save; after Save the whole shell and the sign-in page follow |
| P10-14 | Tenant settings › Style: customize Corners | Only the tenant changes; the other styles stay inherited |
| P10-15 | Style › Band image: upload a dark PNG | It shows under the band, texts readable |
| P10-16 | Upload a very bright PNG | Refused with the message about the contrast (WCAG 4.5:1) when even the strongest darkening cannot make the band texts read; with the light texts of the default theme the band darkens any image and it is accepted |
| P10-17 | Upload a medium bright PNG | Accepted, the band darkens it as needed |
| P10-18 | In Project (image from the package) set a band image in Style | The image of the Style wins; remove it: the one of the layout returns |
| P10-19 | Plugins › Layouts › open Tabs › What it contains | Arrangement of the slots, the package contents, what a layout may not do |
| P10-20 | Uninstall Tabs while it is the layout of the platform | The platform goes back to Teams |
| P10-21 | Plugins › Install from file with the Tabs package | Installed; it can be chosen again |
| P10-22 | Install a layout whose CSS has `position: fixed` or `url(https://…)` | Refused with the reason |
| P10-23 | Look for layout plugins in the plugin list of a tenant | They do not appear: the tenant chooses them in Layout |
| P10-24 | Italian and dark mode on the Layout and Style pages | Everything translated and readable |

## Follow-ups A — Docker backups, errors in the plugins, OIDC logout and groups

The OIDC checks use the test identity provider and a tenant set up as in Phase 8 (P8-01 … P8-05).

| Id | Check | Expected |
|---|---|---|
| FU-A-01 | (Release, with Docker) `cargo xtask release docker`, start the compose, System › Backup and restore › Run now | The backup is «complete»: the zip has `database/mosaikit.pgdump` (the image has the PostgreSQL 17 client) |
| FU-A-02 | As `s.greco`, Notes, with the Tenant Manager having removed «create» from Sara's profile (P3): create a note | The message in the app is the translated one («Your permission profile does not allow it»), in Italian too; never a code |
| FU-A-03 | Contacts: save a contact with the email `x` | The message of the plugin itself («invalid email: x»), not «Invalid request» |
| FU-A-04 | As Administrator, the OIDC tenant › Sign-in | The addresses include **Front-channel logout address** (`…/frontchannel-logout`); Check the configuration has a green line «Front-channel logout» |
| FU-A-05 | Sign in as Anna Rossi through the provider; in another tab open `http://127.0.0.1:5556/logout` | The page of the provider «Signed out» shows a small frame «Signed out of Mosaikit.»; back on the Mosaikit tab, a reload shows the sign-in page |
| FU-A-06 | Sign-in tab › **Groups of the provider in Mosaikit** on, «Only the groups starting with» empty, Save | Saved |
| FU-A-07 | Sign in as Bruno Neri, then as Anna Rossi; Manage › Groups | `staff`, `mosaikit-managers`, `mosaikit-users` marked «From the identity provider»; `staff` has Anna and Bruno; no Add, no delete, no × on the members |
| FU-A-08 | Open `staff`: its page | The badge «From the identity provider»; no «Add a member», no «Delete the group», no Remove |
| FU-A-09 | As Anna: a note in Notes › Share… › search `staff` › Share | Shared with `staff`; as Bruno (through the provider) the note is in Notes |
| FU-A-10 | Prefix `mosaikit-`, Save, sign in again as Bruno | Bruno leaves `staff` (it stays, with its shares, and Anna until her next sign-in); he stays in `mosaikit-users` |
| FU-A-11 | In another OIDC tenant: as its Tenant Manager create a Mosaikit group `staff` first, then turn the mirror on and sign in as Bruno | The group of the provider is «staff (identity provider)»; the group of Mosaikit stays as it was |
| FU-A-12 | Italian and dark mode on the Sign-in tab and on Manage › Groups | Translated and readable |

## Follow-ups B — Tabs of an extension, one item from a backup

The sample extension *Note review* (`com.mosaikit.note-review`) adds a **Review** tab to the notes.

| Id | Check | Expected |
|---|---|---|
| FU-B-01 | As `e.ricci`: the sidebar and the Home | *Note review* is not an app: not in the sidebar nor among the apps of the Home |
| FU-B-02 | Notes: open a note | Above the detail two tabs: **Detail** and **Review**; the columns and the fieldset of Note review as before |
| FU-B-03 | Review | The page of the extension inside the detail: «Review of «title»», «Not reviewed yet», a comment field, **Mark as reviewed**, the history |
| FU-B-04 | Write a comment, Mark as reviewed | «Reviewed by Elena Ricci», the comment in the history with the date; the column *Reviewed* of the note shows ✓ at once |
| FU-B-05 | Scroll the page of Notes, make the window narrower, reload | The tab stays in its place over the detail and grows with its content; nothing overflows the page |
| FU-B-06 | Arrows left and right on the tabs; Detail | The tabs move with the keyboard; on Detail the tab closes and the fields come back |
| FU-B-07 | Share the note with `s.greco` read only; as `s.greco` open it, Review | The history is there; no comment field and no button: «only who can edit the note reviews it» |
| FU-B-08 | Italian, dark mode, high contrast on the tab | Translated («Revisione», «Segna come revisionata»), readable, the colours of the shell |
| FU-B-09 | As Administrator: System › Backup and restore › Run now; when it is listed, as `e.ricci` delete the reviewed note and empty the Trash | — |
| FU-B-10 | As Administrator: **Restore an item** on that backup; tenant *Comune di Roma*, title of the note, Search | The note, its owner, «No longer in the tenant» |
| FU-B-11 | Restore, then Restore | ««title» restored»; the state becomes «In the tenant»; `e.ricci` gets a notification and finds the note with its review history |
| FU-B-12 | Restore it again | It is still in the tenant: choose **As a copy** (a second note next to the current one) or **In place of the current one** (red button: the current version is deleted for good) |
| FU-B-13 | A folder of Documents restored the same way | The folder comes back with the files in it, contents included; a file whose folder no longer exists comes back at the top |
| FU-B-14 | With «Also its shares…» ticked | The shares come back for the people and groups that still exist; public links never come back |


## Security follow-ups

The open items of the security review (docs/reports/security-review.md). SEC-08 to SEC-10 need a second
start of the development server with a wildcard `plugin_url` (below); the others work as usual.

| Id | Check | Expected |
|---|---|---|
| SEC-01 | As Administrator: System › Identity and appearance › Identity and texts: upload an SVG logo with `<script>`, with `onload=`, with `<image href="https://…">` or with `<style>` | Refused: «SVG with scripts or external references: not accepted»; a plain drawing (shapes, paths, text, gradients) is accepted |
| SEC-02 | Make a public link to a note and open `…/p/<token>/api` | Only the fields the plugin shows; fields a plugin declares `hidden = true` never appear (no official plugin has one on its own resources: covered by an automated test) |
| SEC-03 | As Administrator: in `xtask/mosaikit.dev.toml` set `[archives] max_entries = 5`, restart, import the export of a tenant | Refused: «the archive unpacks to more than the limits of the installation»; remove the setting afterwards |
| SEC-04 | Upload a static site whose zip has a file `con.txt`, `nul`, `a.` or `name ` | Refused: unsafe path |
| SEC-05 | As `e.ricci`: a password link for `s.greco` (Manage › People › Sara Greco › Sign-in); open it in two tabs and send both | One sets the password, the other says the link is not valid any more |
| SEC-06 | Look at the permissions of `<data_dir>/secret.key` (Windows: `icacls`; Linux/macOS: `ls -l`) on a new data folder | Only the owner (and SYSTEM on Windows), no inherited entries; mode `-rw-------` on Unix |
| SEC-07 | With the test identity provider (Phase 8): sign in to an OIDC tenant, sign out | The provider's logout page receives `id_token_hint` (visible in its address) and signs the person out |
| SEC-08 | Start a second server with `MOSAIKIT_PLUGIN_URL=http://*.localhost:47081/mosaikit cargo xtask dev` (or the same line in `xtask/mosaikit.dev.toml`); open Notes | The frame of Notes comes from `http://com-mosaikit-notes.localhost:47081/…`; the plugin works as usual |
| SEC-09 | In the browser, open `http://com-mosaikit-notes.localhost:47081/mosaikit/ui/com.mosaikit.tasks/` | 404: the UI of Tasks is served only on its own host |
| SEC-10 | Make a public link | Its address starts with `http://public.localhost:47081/…` and opens there |

## UX follow-ups — labels, keys of the plugins, own profile, guides

| Id | Check | Expected |
|---|---|---|
| UX-01 | As Administrator, the sidebar and the list of the tenants | The entry and the page title say **Tenants** (plural); the tabs of a tenant are **Details**, **People**, **Sign-in**, **Plugins** |
| UX-02 | Share an item, then open an access request and the **Permissions** tab of a person | The levels are named the same everywhere: **View**, **Edit**, **Manage** (Italian: Visualizzazione, Modifica, Gestione) |
| UX-03 | As `s.greco`, person menu | **Access requests** opens *Requests to see or edit your items* |
| UX-04 | As `e.ricci`, Manage › People | **Invite people** is the main action (and **New user** next to it in a tenant with local accounts); **Pending** has **Invite people** too |
| UX-05 | As Administrator, System › Retention | Trash, log **and notifications** kept, in days; System › Notifications no longer has the retention |
| UX-06 | As Administrator, System › Keys of outside services | Only the services the installed plugins declare (in development: *Translation service*, used by Notes); each says **Used by …**; a key stored for a service no plugin declares (if any) says *Not used by any installed plugin* and can only be removed |
| UX-07 | Add a platform key for *Translation service*, share it; as `s.greco` Account › Keys | *In use: the key of the platform*; add a personal key: *In use: your key*, masked |
| UX-08 | As `s.greco`, Account › Profile: change **Display name**, **Save** | The name changes in the band at once; as `e.ricci`, Manage › People shows the new name |
| UX-09 | Account › Profile: **Add a picture** (PNG or SVG under 512 KB), then a text file | The picture shows in Profile and in the band; the text file is refused with a clear message |
| UX-10 | As `e.ricci`, the page of `s.greco` | The picture shows on the **Profile** tab; as `l.verdi` (other tenant) it does not |
| UX-11 | **Remove the picture** | The initials come back |
| UX-12 | In an OIDC tenant (Phase 8, fake provider), Account › Profile | The name is read-only (it comes from the provider); the picture can be changed |
| UX-13 | Help › **What is new**, in English and in Italian | The notes of the version in the language of the interface |
| UX-14 | Help › **Guide of Mosaikit** as User, as Tenant Manager, as Administrator | A wide dialog with the guide of the role, tabs for the other two, in the language of the interface; links to another guide switch tab |
| UX-15 | System › Identity and texts › **Guide** set to an address | Help › Guide of Mosaikit opens that address instead |
## Performance follow-ups — Paging, KPI snapshot, Log search, SQLite writers

Needs many rows: the data of the load test (`cargo xtask perf --scale probe`, then the server of
`.dev/perf`), or create a few hundred notes and people with the API. Pages of 50 rows in the shell,
100 in the plugin lists.

| Id | Check | Expected |
|---|---|---|
| PERF-01 | As Administrator: People, with more than 50 people | 50 rows, «50 of N» and **Load more** under the list; Load more adds the next 50 without repeating rows; the counts of the filters (all, in several tenants, administrators) are those of everyone, not of the page |
| PERF-02 | People: type part of a username in the search, then a tenant or role filter | The list is searched on the server (people not loaded yet are found); clearing the search brings back the first page |
| PERF-03 | People: tick the box of the header (every shown row) | «Select all N» appears; click it: «N selected»; a bulk action (e.g. Disable, then Reactivate) applies to all N, the system administrators excluded; changing the search clears the selection |
| PERF-04 | Administrator: Tenants, with more than 50 tenants | First 50 by name, Load more, the search and the status filters on the server |
| PERF-05 | Administrator: Overview | The totals (items, space, active people) and below them «Figures of every tenant as of <time>» with **Refresh**; Refresh updates the time (on a small installation the time is always now: the figures are computed live) |
| PERF-06 | Administrator: KPIs page | The same time and the same totals as the Overview |
| PERF-07 | As Tenant Manager: Manage › People, with more than 50 members | Paged like PERF-01, searched on the server; the count of the tab is the number of every member; «Select all N» and a bulk role change apply to all; **Remove** a member still offers every member as the new owner of their items |
| PERF-08 | Manage › Groups, with more than 50 groups | Search box above the cards; the groups are searched on the server and paged with Load more; editing the members of a group still lists every member |
| PERF-09 | Manage › Shares (shared, public, all items) | Paged with Load more; the counts of the three views are those of the whole tenant; «Select all N» then Revoke removes the shares of all N items |
| PERF-10 | Notes (any plugin list of `mountCrud`), with more than 100 rows | «100 of N items» and **Load more**; the filter box searches on the server a moment after typing (rows not loaded yet are found); creating or editing a row reloads the first page |
| PERF-11 | Manage › Log: search a word of the details, an IP, a username | The matches as before (substring, any case); on PostgreSQL with `pg_trgm` the search answers in milliseconds on a large Log |
| PERF-12 | Desktop (SQLite): two windows of the same person saving notes at the same time, while a third lists them | Every save succeeds (no «database is locked»), the list keeps answering while the others write |
| PERF-13 | Share a folder with a group read only; as a member of the group: the notes of the folder, open one, try to edit it | Listed and readable, the edit refused (read access through the set rule, write checked per row); the same in the trash: not listed |

## QA follow-ups — what the QA walkthrough found, and the gaps of the mockup

| Id | Check | Expected |
|---|---|---|
| QA-01 | As Tenant Manager suspend a person who belongs to no other tenant; try to sign in as them | Refused with «Your access to this tenant is suspended: ask its Tenant Manager»; no shell, no raw server error. A person who is also a guest of another tenant signs in and lands there. Reactivate them afterwards |
| QA-02 | `anna` open in a second window, then suspend her; reload that window | A page «Your access to the tenant is suspended» with Sign out |
| QA-03 | Dark mode, Account (or any page with a list of sections at the left) | The selected section reads clearly (contrast at least 4.5:1) in every theme |
| QA-04 | As `s.greco` search for a word of a note she cannot see: no results. As the owner share the note with her; search the same word again in her window | The note is found now, without reloading; the pill «Tenants» is not offered to a User |
| QA-05 | System › Email, set a port where nobody listens, **Send a test** | A readable message in the page language («The mail server refuses the connection (host:port)»), shown on the page and in a toast; «Ready» is not red |
| QA-06 | Monitoring › Status, click **Emails**, then **Search index** | A side panel with state, version, response time and details (queue, last delivery, items waiting); the mail row is «down» while the port is closed |
| QA-07 | Plugins › *Note review* › ⋯ › Uninstall | The confirmation counts its values and the tenants where it is on, and says that installing it again brings back the choices. Install it again: it is on and off in the tenants as before |
| QA-08 | While a window is open as a user, turn on maintenance (System › Maintenance); act in that window | The sign-in page with the maintenance notice, not a bare sign-in |
| QA-09 | Home as `s.greco` | Greeting by hour; «Pick up where you left off» (items she created or changed), «Due soon» (tasks with a due date within 7 days, late ones in red; done ones are not listed), «For you» (latest notifications, link to all) |
| QA-10 | Manage › People › **Import from CSV**: a file with a header `username,name,email,role,profile,groups` and one wrong row | A preview shows the problem of the wrong row; only the good rows are created, each with a link to choose a password (emailed if there is an address); the report says «N done, M not done» |
| QA-11 | Manage › People › **Invite several people**: `username@tenant` per line, one wrong | One outcome per line; the right ones become invitations |
| QA-12 | System › Tenants › a tenant › Details | Contact person, email, phone and registration data, with the save bar only after a change |
| QA-13 | Tenant Manager › Plugins › **Ask for a plugin**; the State filter | The Administrators get a notification with the text; the filter shows On or Off plugins |
| QA-14 | Log: suspend and reactivate a person | «On what» names the person; the Activity tab of that person lists those events |
| QA-15 | Tenant › Plugins: an extension | No «Open» button; its «Use» permission says «Use the extension» |
| QA-16 | Tab through System › Identity and texts › the logos | One tab stop per action (Upload, Remove), names tell the images apart |
| QA-17 | Start the tour of a page; press the arrow keys without clicking the card | They move between the steps |

## Review round 1 - lists

| Id | Check | Expected |
|---|---|---|
| R1-L-01 | Administrator › Tenants (or People) with more than one page; scroll down | The page header (title, selection bar, actions) and the filter column stay in sight under the top bar |
| R1-L-02 | Any page with a scrolling area | Scrollbars are thin |
| R1-L-03 | Sidebar with more entries than fit | Its scrollbar shows only while the mouse is over the sidebar |
| R1-L-04 | Look at the first and at the last icon of the sidebar | No extra empty space above the first and below the last |
| R1-L-05 | Close the sidebar to icons | A visible gap separates the groups (Apps, Management…) |
| R1-L-06 | Administrator › Tenants: use the filter column (search, Status, Reset) | The list follows the filters; Reset brings back all; the button of the header hides or shows the column |
| R1-L-07 | Tenants: tick one row, then the box of the header | «1 selected» and the actions (Suspend, Reactivate) appear in the header; the header box selects every loaded row |
| R1-L-08 | Administrator › System: the list of sections | The sections under a heading are indented |
| R1-L-09 | A list with more than 50 rows (Tenants, People, Shares): scroll to the end | The next rows load by themselves; the count reads «N of N» at the end; Load more still works with the keyboard |
| R1-L-10 | Manage › People: click on a row (not on the checkbox, the name link or the menu) | The person opens |
| R1-L-11 | Tenant › Plugins | The button of the permissions says «Permissions» |
| R1-L-12 | Tenants list | Every tenant has its logo, or its initials on the accent colour when it has none |
| R1-L-13 | Administrator › People and Manage › People | Every person has an avatar (their picture, or the initials) |
| R1-L-14 | Administrator › a tenant | The logo (or the initials) is next to the name in the header |
| R1-L-15 | Language Italian, then English, as Administrator | Italian says «Organizzazione» / «Organizzazioni» (the role stays «Tenant Manager»); English says «Tenants» |
| R1-L-16 | Sidebar of an app with pages (Notes › Mine), open, then closed to icons | Open: the pages are indented under the app. Closed: the small arrow on the icon opens a menu with the pages and their sub-pages |
| R1-L-17 | Mockup `docs/mockup`, Home of the User, Overview of the Tenant Manager and of the Administrator | The overview is a set of widgets: fast figures, notifications, recent activity, due dates and problems, a trend; the apps are a compact strip (verified: built, see Review round 1 - overview) |

---

## Review round 1 - overview

Automated twin of every check: the test «Review round 1, overview» of `tests/e2e/specs/12-review-round1-platform.spec.ts` (the steps carry the ids). The figures come from cheap sources: counters of the overview, the snapshot of the platform figures, pages of five rows.

| Id | Check | Expected |
|---|---|---|
| R1-O-01 | Home of a User | The apps are chips in a strip under the title; then fast figures (items, unread notifications, shared by me, shared with me), «Pick up where you left off», «Due soon», «For you», «My recent activity» and «Shared by me» |
| R1-O-02 | Overview of a Tenant Manager | Chips of the apps; figures of the tenant; «Waiting for you» (access requests, invitations, public links, each with its button), «Active people» with a trend, «Recent activity» (five events of the Log), «For you», usage; then «Your space» with the personal lists |
| R1-O-03 | Platform overview (Administrator) | Figures, Services, To do, «Tenants by storage used» (top five, from the snapshot), «Requests» with a trend, «For you», «Recent errors»; the time of the figures and Refresh are still there |
| R1-O-04 | The three overviews at phone width (390 px) | One column, no horizontal scroll |
| R1-O-05 | Italian | Every widget title is translated (for example «Errori recenti», «Organizzazioni per spazio usato», «In attesa di te») |
| R1-O-06 | The three overviews in light, dark and high contrast | No serious accessibility problem (axe) |
| R1-O-07 | Tenant Manager › Manage | The sections (People, Groups, Permission profiles, Pending) are the «Show» group of the filter column; People has the search in the column and, with a row ticked, «1 selected» and the actions in the header |
| R1-O-08 | Tenant Manager › Shares and Trash | Filter column (Show, Apps, search) and selection bar in the header (Revoke shares and links; Restore, Delete for good) |
| R1-O-09 | Trash, Shared by me (Home) and Invitations (Manage › Pending) with more than one page | The next rows load while scrolling; the server answers a page (`?limit=`) with the total and the cursor |

## Review round 1 - tenant and people

Automated twin of every check: the test «Review round 1, tenant and people» of `tests/e2e/specs/12-review-round1-platform.spec.ts`.

| Id | Check | Expected |
|---|---|---|
| R1-T-01 | Administrator › Tenants › a tenant | Tabs Details, People, Sign-in, Plugins and **Quotas**; Details no longer holds the quotas; the Quotas tab has them (Customize, Restore, Used) |
| R1-T-02 | Details of a tenant: change **Name** and **Identifier**, Save, reload; put them back | The new values stay after the reload and appear in the list and in the sign-in page; an identifier already taken or with capitals and spaces is refused with a readable message |
| R1-T-03 | Quotas tab, and System › Quotas | Under **Items** a sentence says what is counted (what the people create in the apps: notes, tasks, files, maps, sites; one note, one item); Storage and People have theirs too |
| R1-T-04 | Tenant › Plugins | Every row has a pill in the last column: *active*, or why not (*not available*, *turned off*, *off in the platform*), also for a plugin not available to the tenant |
| R1-T-05 | Same page | After the sentence on availability the link **Go to the Plugins page** opens the list of the plugins |
| R1-T-06 | Plugins › *Notes* | A brochure: gallery of pictures (click the thumbnails; click the picture to enlarge it), a description in paragraphs, **Publisher** with **Author** and **Licence**; a plugin without these fields says *not declared*; in Italian the description is in Italian; the technical details are in their own card (see FC-04 for the whole page) |
| R1-T-07 | Monitoring | A line says the figures are real, collected every minute and kept for 8 days, and **Last update** with the time; after a minute the time changes by itself |
| R1-T-08 | System › Email | A paragraph says that Mosaikit needs an SMTP server and mentions the optional Mailpit container for local tests; **Send a test** is there (FC-05 for the page with no server set) |
| R1-T-09 | System › Keys of outside services (and the same page in Tenant settings and Account) | A paragraph says that the plugins declare which keys exist; with no plugin that uses keys the page says so |
| R1-T-10 | System › Administrators, menu of your row, then of another Administrator's row | **Edit name and email** is in both menus; the new name shows in the list (and in the person menu for your own; your own email is changed in Account, FC-01); the other actions (password, second factor, disable) stay absent on your own row |
| R1-T-11 | Tenant Manager › Manage › Permission profiles | A clear description of what a profile is; each card says «Access to N of M plugins» and lists them with plugin names and permission names in your language (never a plugin id like `com.mosaikit.notes`); **Rename** changes name and description; **Edit the permissions** is one compact row per plugin, with a filter when there are more than 6 |

## Feedback C - accounts, brochure, email, translation

Automated twin of every check: `tests/manual/checks/fc.ts` (and the test «14-feedback-c» of `tests/e2e/specs/14-feedback-c.spec.ts`).

| Id | Check | Expected |
|---|---|---|
| FC-01 | As Administrator: Account › Profile | The email shows (`admin@example.test` in development); **Change email** opens a dialog asking the new address, the current password and, with the second factor on, a code of the app; a wrong password is refused with a readable message; with the right password and a fresh code the new address shows |
| FC-02 | System › Administrators › **New Administrator** (name, **Email**, password), then the menu of the new row › **Edit name and email** | The email is required; one already used by another account is refused («already used by another account»); another Administrator's name and email change and the list shows them; the form does not send an empty email; in the menu of your own row the dialog has the name only and says the email is changed in Account |
| FC-03 | Account of a Tenant Manager | The text under **Details** says that the Tenant Manager of the home tenant changes the email; no **Change email** button |
| FC-04 | Plugins › each official plugin (Notes, Tasks, Maps, Apps, Documents, Contacts, Note review, the four layouts, Spanish) | A brochure: a header with icon, name, version and licence; a gallery with a picture that loads; the text under **About**; **Permissions and requirements**; **Publisher** with author, licence, version, signature and link. A click on the picture opens it large, the arrows or ← → show the next one, Esc closes. At 390 px wide nothing scrolls sideways; light and dark are both readable |
| FC-05 | System › Email with no server saved | A card **Set up email** says what is missing («the SMTP server, the sender»); **Set up** puts the cursor in **SMTP server**; **Fill in for a local test server** fills `localhost`, port 1025, security None and a sender, with the line that starts Mailpit; **Send a test** is off with «Available once the mail server is saved.»; after saving the card is gone and the badge says *Ready* |
| FC-06 | As a Tenant Manager: Notes › a note › **Translate note**; then, as Administrator, set the keys **Translation service** and **Translation service address** (shared) in System › Keys of outside services and try again | Without a key: «No translation key is set. Ask your Administrator…», nothing sent. With both: the translated title and text appear under the button; the service received the key as a bearer token; the key is never in the page. (A translation service of the test answers; no real service is called) |
| FC-07 | The development accounts of the table in Setup | Every account has an email address (`<username>@example.test`) |

---

Every phase of the plan has its section. New work adds its checks here when it is committed.

## Review round 1 - Docker

Run from `deploy/` with Docker (the build agent could not run Docker, so these are manual).
Use a copy of `.env` with new passwords. Never run them against a stack that holds data you need:
`docker compose -p mosaikit-r1 ...` uses its own project and volumes; remove them at the end with
`docker compose -p mosaikit-r1 down -v`. The static part (files, variables, realm, templates) runs in
`cargo test -p xtask deploy_check`.

| Id | Steps | Expected |
|---|---|---|
| R1-G-01 | `docker compose -p mosaikit-r1 -f compose.yml up -d`; `docker compose -p mosaikit-r1 ps` | `db` and `app` healthy; no keycloak, mail or proxy container; port 5432 not published on the host |
| R1-G-02 | `docker compose -p mosaikit-r1 exec db psql -U postgres -c "\du"` and `\l` | Role `mosaikit_app` (CREATEROLE, no superuser) and database `mosaikit` owned by it |
| R1-G-03 | Change `POSTGRES_PASSWORD`, `up -d` again without removing volumes | Database password does not change (documented: used at volume creation); app still healthy |
| R1-G-04 | Backup: `exec db sh -c 'pg_dump -U postgres -Fc mosaikit > /backups/t.dump'`, then `cp db:/backups ./b` | `./b/t.dump` exists and is not empty; `pg_restore -l` lists the tables |
| R1-G-05 | Restore the dump with the README command into an emptied database | Restore ends without errors; the app lists the same tenants |
| R1-G-06 | `--profile mail up -d`; in the app System › Email host `mail`, port 1025, no TLS; send the test message | Message appears in Mailpit `http://localhost:8025`; no mail leaves the computer |
| R1-G-07 | `--profile keycloak up -d`; open `http://localhost:8180`, sign in to the console | Realm `mosaikit` exists with client `mosaikit` (PKCE S256), groups, 3 users; Realm settings › Login: user registration off |
| R1-G-08 | Open `http://localhost:8180/realms/mosaikit/account` signed out | Login page with the Mosaikit look (card, logo, blue button), no "Register" link |
| R1-G-09 | Tenant › Sign-in with the table of the README; *Check the configuration* | Check passes (issuer reachable from the app, PKCE S256 reported) |
| R1-G-10 | Sign in to the tenant as `anna.manager` / `change-me`, then sign out, then `bruno.user`, then `carla.noaccess` | anna is a Tenant Manager, bruno a User; carla is refused (`oidc_no_role`); signing out ends the Keycloak session |
| R1-G-11 | `--profile proxy up -d` with `MOSAIKIT_URL=http://localhost`, `MOSAIKIT_PLUGIN_URL=http://plugins.localhost`, `MOSAIKIT_TRUST_PROXY=true`; open `http://localhost` | App loads through nginx; plugin UIs load from `plugins.localhost`; `docker compose logs proxy` shows no errors |
| R1-G-12 | Through the proxy upload a file of about 200 MB and run an export that lasts over a minute | Both complete (no 413, no 504) |
| R1-G-13 | Base path: `NGINX_BASE_PATH=/mosaikit`, `MOSAIKIT_URL=http://localhost/mosaikit`; recreate; open `http://localhost/mosaikit/` | App works under the path |
| R1-G-14 | Wildcard: `MOSAIKIT_PLUGIN_URL=http://*.plugins.localhost`; open a plugin UI | Its URL is `http://<plugin>.plugins.localhost/...`; each plugin on its own host |
| R1-G-15 | TLS: self-signed certificates in `nginx/certs`, enable `20-https.conf.template`, recreate; `curl -kI https://localhost` | 200 with `Strict-Transport-Security`; session cookie is `Secure` with https URLs; Notifications live update still works (websocket/stream) |
| R1-G-16 | Upgrade drill: back up, change `MOSAIKIT_VERSION` to a newer image, `up -d` | Migrations apply (`logs app`), data intact; `docker compose down -v` of the test project cleans up |

## Development tooling

Run from any checkout of the kernel. The pure logic (names, ports, slots, staleness) runs in `cargo test -p xtask`.
Use a throwaway name such as `devcheck`; never run these where a worktree with that name holds work.

| Id | Steps | Expected |
|---|---|---|
| DEV-01 | `cargo xtask worktree add devcheck`, then `cargo xtask worktree list` | `mosaikit-temp\devcheck\mosaikit` and `mosaikit-plugins` exist, branches `work-devcheck` and `devcheck-plugins`; `.worktree.env` has a port from 18200 and `MOSAIKIT_DB_SUFFIX=wt_devcheck`; the list shows them |
| DEV-02 | `cmd /c dir /AL mosaikit-temp\devcheck\mosaikit` and the same for `mosaikit-plugins` | `node_modules` (root, `ui\host`, `ui\plugin-api`, `e2e` where the main checkout has them) are `<JUNCTION>` to the main checkout |
| DEV-03 | Add a second worktree `devcheck2` | Another port, another suffix |
| DEV-04 | In `devcheck`: `cargo xtask e2e -- tests/auth.spec.ts` (any one file; add `-g "text"` for one test) | Only that file runs, on that worktree's port, in database `mosaikit_e2e_wt_devcheck` (`cargo xtask db url` + `psql -l`); `tests/results` untouched |
| DEV-05 | Start `cargo xtask e2e` in `devcheck`; start another in `devcheck2` | The second prints `waiting for a heavy-run slot 'e2e' (1 at once); held by: xtask e2e (pid ..., ...)` and starts when the first ends |
| DEV-06 | Kill the first run's `xtask.exe` from Task Manager while a second waits | The second prints `removing stale lock` and starts |
| DEV-07 | `MOSAIKIT_HEAVY_SLOTS=e2e=2` with two runs | Both run at once |
| DEV-08 | `cargo xtask clean-temp` | Sizes of every folder of `mosaikit-temp` and its `target` folders; nothing deleted |
| DEV-09 | `cargo xtask clean-temp --days 0` while a run holds a slot | The `target` of the running worktree says `in use`, others `would delete`; nothing deleted. With `--yes` they are deleted, the worktrees stay |
| DEV-10 | `cargo xtask worktree remove devcheck` and `devcheck2` | Folders gone, `git worktree list` and `git branch` do not show them (unmerged branches are reported and kept), main `node_modules` still full, database `mosaikit_e2e_wt_devcheck` gone |

## Plugin host additions

Groups in the context of the logic and the host operation `notify`. Automated twins: `cargo test -p
mosaikit-kernel --test host_ops` (PostgreSQL, and SQLite with `MOSAIKIT_TEST_BACKEND=sqlite`) and the
tests of `crates/plugin-sdk`. By hand you need a plugin that uses them (a development plugin whose
manifest has `[permissions] notify = true` and whose command calls `ctx.notify` and reads `ctx.groups`).

| Id | Steps | Expected |
|---|---|---|
| HOST-01 | As a person who is in the groups Field and Office, run a command that returns `ctx.groups` | `[{"id":…,"name":"Field"},{"id":…,"name":"Office"}]`, by name |
| HOST-02 | The same as a person in no group; then take someone out of a group and run it again | `[]`; the change shows at the next call |
| HOST-03 | Run a command that notifies the caller (title, text, place `items/1`) | One notification in the bell, from the plugin; its link opens the plugin at that place; nobody else gets one |
| HOST-04 | Share an item with Bruno (read) and not with Carla; the owner runs the command with that item | Bruno gets it, Carla and the owner do not |
| HOST-05 | Bruno (read only) runs the same command | The command succeeds; no notification is sent |
| HOST-06 | Remove `notify = true` from the manifest and run again | The command fails saying the plugin does not declare `notify` |
| HOST-07 | Notify with a place such as `<script>` or an empty title | Refused with a clear message; nothing is sent |
| HOST-08 | Notify 31 times in a minute | The 31st fails with «too many notifications» |
| HOST-09 | As a person of another tenant, name the id of an item of the first tenant | Nothing is sent to anyone, in either tenant |
## Review round 1 - auth and plugins

Sign-in, accounts, sites by address and languages (items C3, C4, D9, H1, H2, I1 and I2 of the
[review round 1](ui-plan.md)). Each check has an automated twin: the ones of the type *e2e* are in
`tests/e2e/specs/13-review1-auth-plugins.spec.ts` (same id), the ones of the type *Rust* in `crates/kernel/tests/review1.rs`.

| Id | Check | Expected | Twin |
|---|---|---|---|
| R1-A-01 | `cargo xtask dev`, open the app as **http://localhost:5173** (not 127.0.0.1) and sign in; open Files, Maps, Static sites, Tasks and Notes | Every app opens in its frame: no «refused to connect». Before the fix the browser blocked the frame of every plugin when the app was opened by a name other than the one in `url` | e2e |
| R1-A-02 | As Tenant Manager, Manage › **New user**: leave **Email** empty; then fill it. Do the same in **New person** (Administrator › People), in **New tenant** (step Tenant Manager), in **New Tenant Manager** (tenant page) and with a CSV without the `email` column | The **Email** field is marked required in every form; the CSV preview says «Email required» for those rows; the server answers `email_required` if the form is bypassed. In a person without an email (made before the rule) a red note says «Email missing…» and nothing is saved until one is given | e2e + Rust |
| R1-A-03 | Sign-in page, pick the tenant, **Forgot your password?**, write `manager` (then `nobody-here`), **Send the link** — with no mail server in System › Email | The same message for both: «This installation cannot send email. Ask the Tenant Manager…». In a tenant with an identity provider the link is replaced by a note that the password is managed by the provider | e2e |
| R1-A-04 | Apps › **New app** › *Web address*: a site that allows framing (e.g. `https://example.org`), then one that forbids it (e.g. `https://github.com`) | The first is shown inside Mosaikit and never downloaded; the second is created with a note and, when opened, opens in a new tab (the page offers a button if the browser blocked the tab). Cards are the default view, each with a thumbnail (the og:image or first image of the site); **List** shows a thumbnail column; **Edit** › **Thumbnail** uploads your own, which wins | e2e |
| R1-A-05 | Apps › **New app** with a zip that has an `index.html` | It works as before; its card has a placeholder (initial on a colour) as thumbnail until you upload one; **Open** shows the site | e2e |
| R1-A-06 | Install the plugin **Spanish** (`com.mosaikit.lang-es`) from Plugins; open the sign-in page in a private window; open the language menu | **Español** is listed with English and Italian; choosing it translates the sign-in page (the texts the plugin does not have stay in English); the choice is kept after reload. Turn the plugin off: the language disappears from the menu and a person who had chosen it goes back to English | e2e + Rust |
| R1-A-07 | With a mail server set (System › Email; in Docker `--profile mail` and Mailpit), **Forgot your password?** for `anna` (by username, then by her email address); open the message; use the link; try the same link again | One message per request with a link; the link opens **Choose a new password** and works once (then «the link is not valid any more»); a newer request cancels the older link; more than 3 requests in 15 minutes for the same person send nothing more, with the same answer on screen | Rust |
| R1-A-08 | New install (empty data folder), desktop or server with `initial_tenant`: sign in to the work tenant | The account is called **user** (not `utente`); an install made before keeps its `utente`. The account has no email: it is flagged as in R1-A-02 | Rust |
| R1-A-09 | Apps › New app › Web address with `http://127.0.0.1:8080`, `http://localhost`, `http://169.254.169.254/` or `http://10.0.0.1` | Refused: «This address is not allowed (only sites on the public Internet can be looked at)» (this installation does not allow private addresses; only the tests do) | Rust |

## Review round 2 - overviews and lists

Dense overviews, app cards with charts, pinned headers, the sidebar scrollbar and paging of every list. Each check has an automated twin in `tests/manual/checks/r2.ts` (same id).

| Id | Check | Expected | Twin |
|---|---|---|---|
| R2-01 | As Administrator open the **Platform overview** at 1440, 820 and 390 px wide, in light and dark | The counters, the services, the to-do list and the widgets share one dense grid (four columns, two, one): no big empty gaps, the widgets of a row have the same height. **Apps, in every tenant** shows one card per app (Maps, Notes, Static sites, Tasks…) with items, space, bars by kind and the figures of the plugin; **Space by app** is a donut with a legend. Nothing scrolls sideways on the phone | Playwright |
| R2-02 | As Tenant Manager and as a User open the Overview / Home at the same widths | Waiting for you, active people, recent activity, notifications, usage, pick up, due soon, my activity and shared by me fill the grid side by side; no widget leaves a hole beside it | Playwright |
| R2-03 | Open a page whose main part is a list (Tenants, People, Groups, Trash, Log, Plugins, Manage) at 1440 and 390 px; scroll the list; open the Overview and scroll | The page itself does not scroll: the header, the filters and the selection bar stay, the list fills the rest of the height beside the sidebar and scrolls inside, the header row of the table stays on top of it, and the next rows load as the end of the list comes into view. Pages that are not list-first (Overview, Account, settings) scroll as a whole | Playwright |
| R2-04 | Make the window short so that the sidebar does not fit, then move the mouse over the sidebar and away from it; scroll with the wheel and with Tab; open the app on a touch screen | The sidebar (open or closed to icons) scrolls: its scrollbar shows only while the mouse is over it (or the focus is inside, or on a touch screen) and is hidden otherwise; the wheel and the keyboard scroll it | Playwright |
| R2-05 | Open Maps, Static sites, Files and Notes (a list made by the plugin API) and compare their header with the one of a page of Mosaikit (Manage); scroll the list of each | The header of the plugin page looks the same as the Mosaikit one (height, spacing, type, border; title and line at the left, actions at the right, filters in a bar under it) and never scrolls; only the list scrolls, with the header row of its table in sight; Notes loads more rows as the end of the list comes into view | Playwright |

## Review round 2 - layout of Contacts, Tasks and Notes

The three apps follow the rules of the shell: header and filters pinned, the list scrolls inside the page, a detail panel next to it (over the list on a phone). Each check has an automated twin in `tests/manual/checks/pui.ts` (same id) and the scenario is also in e2e `15-plugin-layouts.spec.ts`.

| Id | Check | Expected | Twin |
|---|---|---|---|
| PUI-01 | Open **Contacts**, add a contact with an email and a kind of company; click its card, then **Edit**, then **Cancel** | Cards with the initials of each person in a coloured circle, the kind as a chip; the reading panel shows the name, the address as a link and **Edit**; Edit shows the form, Cancel goes back to reading; the header stays at the top while the cards scroll | Playwright |
| PUI-02 | Open **Tasks**, add an overdue task with high priority and one due next week; switch **List** / **Board**; tick the box of the overdue one | Status chips (priority), due dates (the overdue one in red); the board has Overdue, Open and Done; the ticked task moves to Done, struck through, without opening it; the view you chose is kept after a reload | Playwright |
| PUI-03 | Open **Notes**, add a note with a tag and a text of several lines; open it, **Edit**, change the title, **Save**; try **Share…** | Note cards with the tag chip and the first lines; the open note is read in the panel before editing; Save shows it again; Share and the actions of the extensions still work | Playwright |
| PUI-04 | At 390 px wide (phone), in light and in dark, open each of the three apps, then an item, then press Escape | Nothing scrolls sideways; the list alone, the detail covers it when an item is open, Escape (or Close) goes back to the list with the focus on the item; the colours follow the mode | Playwright |

## Spanish coverage

The language plugin `com.mosaikit.lang-es` translates the whole shell (same keys as the Italian locale) and the manifests of the shipped plugins; the keys are compared by `ui/host/src/app/langpack.test.ts` and `crates/kernel/tests/lang_es_coverage.rs`. Texts inside the iframe of a plugin are not covered.

| Id | Steps | Expected | Twin |
|---|---|---|---|
| LANG-01 | Choose **Español** in Account › Appearance and language, as Administrator and as Tenant Manager; visit Home, Overview, Manage, Plugins, Shares, Usage, Log, Settings, Account and, as Administrator, System | No English text is left in the shell (apart from names, brands and technical terms); the plugin names and the labels of the fields come in Spanish; the texts inside the iframe of a plugin may stay in English | e2e `14-lang-es-coverage.spec.ts` + manual |
| R2-06 | Open System and Monitoring as Administrator, and Settings, Usage, Account and Manage as Tenant Manager, at 2000 and 390 px; pick another subsection of each | The header shows the page and the selected subsection, «System › Administrators» (the page in a lighter weight, the subsection in bold, on one line, pinned like the rest of the header; the description line follows); picking another subsection changes the second part and the list at the left agrees. On the phone the page part shortens first and the subsection stays readable. A plugin page with a sub-navigation does the same through `pageHead({ section })` of plugin-api | Playwright (e2e `14-layout-apply`, and the check) |
| R2-07 | As Administrator open System › Identity and appearance at 1440 and 390 px, in light and dark, and go through its tabs (Identity, Theme, Layout, Style, Languages, Top bar); scroll the page; choose another layout and **Save** (and the same as a Tenant Manager in Settings) | Nothing overflows, overlaps or is cut at either width or in either theme; the tabs stay under the header while the page scrolls; after **Save** the shell is drawn with the new layout at once, without reloading the page | Playwright (e2e `14-layout-apply`) |
| R2-08 | Open System (or Settings, Account) with a short window and scroll the page; hover the list of sections | The list of sections stays where it is, does not scroll with the page, and has its own scrollbar when it does not fit, shown only under the mouse; the wheel scrolls it | Playwright (e2e `14-layout-apply`) |
| R2-09 | As Tenant Manager open Log, People, Groups, Trash, Shares and Plugins in a very large window (2000 x 1194) and on a phone | The header sits right under the top bar (no empty band), the filters under it are fully visible and pinned, the page has no scrollbar of its own: only the table scrolls, with its header row pinned | Playwright (e2e `14-layout-apply`, and the check) |

## Tables

Every list of the host and of the plugins is drawn as the same table: the page does not scroll, the header row stays where it is and only the rows scroll, with their scrollbar under the header row; a filter box in the header of the page searches every visible field; the titles of the columns sort (first click ascending, second descending, third the order of the server); more rows load as the end of the rows comes into view (the button **Load more** stays for the keyboard). The installed plugins also have a card view, the default.

| Id | Check | Expected | Twin |
|---|---|---|---|
| TBL-01 | As Administrator open Tenants and People at 1440x900, 1280x600 and 390x844; scroll the rows; click a column title twice | The page does not scroll; the header row stays; the scrollbar of the rows starts under it; nothing of the rows shows above the header row; the first click sorts ascending, the second descending; on a phone the columns scroll sideways inside the table, never the page | Playwright (e2e `15-layout-contract` R-11 and R-12, and the check) |
| TBL-02 | As Tenant Manager open Files, then Maps and Static sites (table layout) | The same table: fixed header row, rows scrolling under it, filter in the header, sortable titles | Playwright (the check) |
| TBL-03 | As Administrator open Plugins; use the switch next to the filter (grid / list); reload; filter; pick a sort in the menu of the cards; tick a card | The cards are shown first and look like the Overview of a plugin (picture, name, kind and version, description, author, signature, status); the choice of view is remembered; the filter, the sort menu (keys of the columns plus a direction) and the selection bar work in both views; a click on a card opens the plugin; Updates and Catalog have the same two views | Playwright (e2e `07-plugins`, and the check) |
| TBL-04 | Open Tenants with many tenants; scroll to the end of the rows | Only the first page of rows is loaded; the next page loads when the end comes into view, not before | Playwright (e2e `15-layout-contract` R-11, and the check) |
| TBL-05 | Open the Log, scroll it past the first page and wait a few seconds | The rows and the scroll position stay as they are (the list is not reset by the clock) | Playwright (e2e `12-review-round1-platform`, and the check) |
| TBL-06 | Open a page or app with nothing in it (Plugins › Updates, a fresh tenant's Documents, Maps, Apps, Contacts, Tasks, Notes, Trash, Shares); then type something that matches nothing in the filter of a list | An illustration of soft tiles with a title, a short grey line and the buttons of what to do (the primary action of the page is repeated), centred in the content area, without a scrollbar; with a filter that matches nothing only a small message and **Clear filters** | Playwright (e2e `15-layout-contract` R-10, and the check) |
