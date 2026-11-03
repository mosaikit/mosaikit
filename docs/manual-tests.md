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
| P1b-01 | As `s.greco`, English | Sidebar and pages of the apps in English (Notes, Tasks, Contacts, Documents, Maps, Sites) |
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
| SEC-11 | As Administrator open Plugins › Notes › What it asks; then fetch the UI of Notes (`…/mosaikit/ui/com.mosaikit.notes/`) and look at its `Content-Security-Policy`. With a test plugin that declares `[permissions] script_eval = true`, open its What it asks and fetch its UI | Notes shows «Runs code compiled at run time: nothing» and its CSP has no `unsafe-eval` or `wasm-unsafe-eval`; the test plugin shows the permission in bold (sensitive) and only its own CSP has `'unsafe-eval' 'wasm-unsafe-eval'` in `script-src` and `worker-src`; the host page and the other plugins keep the strict policy |

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
| R1-L-05 | Close the sidebar to icons | One uniform step separates every icon, also between the groups (Apps, Management…), with no separator line; the entries of the footer (Settings for the Tenant Manager, System for the Administrator) are anchored at the bottom of the bar |
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
| FC-04 | Plugins › each official plugin (Notes, Tasks, Maps, Sites, Documents, Contacts, Note review, the four layouts, Spanish) | A brochure: a header with icon, name, version and licence; a gallery with a picture that loads; the text under **About**; **Permissions and requirements**; **Publisher** with author, licence, version, signature and link. A click on the picture opens it large, the arrows or ← → show the next one, Esc closes. At 390 px wide nothing scrolls sideways; light and dark are both readable |
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
| R1-A-01 | `cargo xtask dev`, open the app as **http://localhost:5173** (not 127.0.0.1) and sign in; open Files, Maps, Sites, Tasks and Notes | Every app opens in its frame: no «refused to connect». Before the fix the browser blocked the frame of every plugin when the app was opened by a name other than the one in `url` | e2e |
| R1-A-02 | As Tenant Manager, Manage › **New user**: leave **Email** empty; then fill it. Do the same in **New person** (Administrator › People), in **New tenant** (step Tenant Manager), in **New Tenant Manager** (tenant page) and with a CSV without the `email` column | The **Email** field is marked required in every form; the CSV preview says «Email required» for those rows; the server answers `email_required` if the form is bypassed. In a person without an email (made before the rule) a red note says «Email missing…» and nothing is saved until one is given | e2e + Rust |
| R1-A-03 | Sign-in page, pick the tenant, **Forgot your password?**, write `manager` (then `nobody-here`), **Send the link** — with no mail server in System › Email | The same message for both: «This installation cannot send email. Ask the Tenant Manager…». In a tenant with an identity provider the link is replaced by a note that the password is managed by the provider | e2e |
| R1-A-04 | Sites › **New site** › *Web address*: a site that allows framing (e.g. `https://example.org`), then one that forbids it (e.g. `https://github.com`) | The first is shown inside Mosaikit and never downloaded; the second is created with a note and, when opened, opens in a new tab (the page offers a button if the browser blocked the tab). Cards are the default view, each with a thumbnail (the og:image or first image of the site); **List** shows a thumbnail column; **Edit** › **Thumbnail** uploads your own, which wins | e2e |
| R1-A-05 | Sites › **New site** with a zip that has an `index.html` | It works as before; its card has a placeholder (initial on a colour) as thumbnail until you upload one; **Open** shows the site | e2e |
| R1-A-06 | Install the plugin **Spanish** (`com.mosaikit.lang-es`) from Plugins; open the sign-in page in a private window; open the language menu | **Español** is listed with English and Italian; choosing it translates the sign-in page (the texts the plugin does not have stay in English); the choice is kept after reload. Turn the plugin off: the language disappears from the menu and a person who had chosen it goes back to English | e2e + Rust |
| R1-A-07 | With a mail server set (System › Email; in Docker `--profile mail` and Mailpit), **Forgot your password?** for `anna` (by username, then by her email address); open the message; use the link; try the same link again | One message per request with a link; the link opens **Choose a new password** and works once (then «the link is not valid any more»); a newer request cancels the older link; more than 3 requests in 15 minutes for the same person send nothing more, with the same answer on screen | Rust |
| R1-A-08 | New install (empty data folder), desktop or server with `initial_tenant`: sign in to the work tenant | The account is called **user** (not `utente`); an install made before keeps its `utente`. The account has no email: it is flagged as in R1-A-02 | Rust |
| R1-A-09 | Sites › New site › Web address with `http://127.0.0.1:8080`, `http://localhost`, `http://169.254.169.254/` or `http://10.0.0.1` | Refused: «This address is not allowed (only sites on the public Internet can be looked at)» (this installation does not allow private addresses; only the tests do); an exact `host:port` listed by the deployer in `allow_private_fetch_hosts` (e.g. `http://10.100.208.140:8301`) is accepted, the same host on another port is still refused | Rust (`the_page_probe_accepts_only_the_hosts_the_deployer_listed`) |

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
| PUI-03 | Open **Notes**, add a note (it starts with the tag personal) and a text of several lines; open it, **Edit**, change the title, **Save**; try **Share…** | Post-its with the tag chip and the first lines; the open note is read in the panel before editing; Save shows it again; Share and the actions of the extensions still work | Playwright |
| PUI-04 | At 390 px wide (phone), in light and in dark, open each of the three apps, then an item, then press Escape | Nothing scrolls sideways; the list alone, the detail covers it when an item is open, Escape (or Close) goes back to the list with the focus on the item; the colours follow the mode | Playwright |

## Notes as post-its

Notes are coloured, slightly turned post-its with a soft shadow and a folded corner (the corner is the grip to resize). Each tag has its own colour. Twins in `tests/manual/checks/npi.ts` (and `tests/e2e/specs/17-notes-postits.spec.ts`).

| Id | Check | Expected | Twin |
|---|---|---|---|
| NPI-01 | Open **Notes**, **New note**, write a title and a text, pick a colour, add a tag, **Save**; then open the round button of the post-it and pick another colour | Post-it in the chosen colour with the title, the first lines and the tag chip in the colour of the tag; the quick menu changes the colour at once and the choice is still there after a reload; the post-it is straight under the pointer and when it has the focus | Playwright |
| NPI-02 | Drag the folded corner of a post-it; focus another post-it and press Alt and the arrow keys (Shift for bigger steps); reload the page | The post-it follows the pointer and the keys, never goes below or above the limits (160 x 120 and 480 x 480 pixels), the new size is there after the reload, the others wrap around it, nothing scrolls sideways | Playwright |
| NPI-03 | Press **Tags**: add a tag with a colour, rename a tag, change its colour, delete a tag and confirm | The tag appears in the editor of the notes with its own colour (not the colour of the note); renaming and colour show in all the notes at once; deleting asks first and removes the tag from every note; the filter by tag lists the tags that exist | Playwright |
| NPI-04 | In light and in dark mode, and at 390 px wide, look at the post-its of every colour; switch **Post-its** / **List** | Text readable on every colour in both modes (contrast of at least 4.5 to 1), the list view shows the same notes with their tags, the layout wraps on a phone | Playwright |

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
| TBL-01 | As Administrator open Tenants and People at 1440x900, 1280x600 and 390x844; scroll the rows; click a column title twice | The page does not scroll; the header row stays; the scrollbar of the rows starts under it; nothing of the rows shows above the header row; the first click sorts ascending, the second descending, and on a list of several pages (Tenants) the sort acts on the WHOLE list: the first row is the first (or, descending, the last) of all the tenants, not of the rows already loaded, and a column of counts is plain text, not a button; on a phone the columns scroll sideways inside the table, never the page. Then open System › Quotas (the capacity grid) and a Profiles page: the matrix has the same header style and border, its header row and first column stay in sight when it scrolls, and its scrollbars show only when it does not fit | Playwright (e2e `15-layout-contract` R-11 and R-12, and the check) |
| TBL-02 | As Tenant Manager open Files, then Maps and Static sites (table layout); as Administrator open a plugin's Extensions tab, then Manage › People › Import from CSV with a file of some rows, and Monitoring › Show as a table under a chart | The same table: fixed header row, rows scrolling under it, filter in the header, sortable titles; inside a card or a dialog it is as high as its rows up to a limit and then scrolls, with its own filter box above it and no scroll of the page | Playwright (the check) |
| TBL-03 | As Administrator open Plugins; use the switch next to the filter (grid / list); reload; filter; pick a sort in the menu of the cards; tick a card | The cards are shown first and look like the Overview of a plugin (picture, name, kind and version, description, author, signature, status); the choice of view is remembered; the filter, the sort menu (keys of the columns plus a direction) and the selection bar work in both views; a click on a card opens the plugin; Updates and Catalog have the same two views | Playwright (e2e `07-plugins`, and the check) |
| TBL-04 | Open Tenants with many tenants; scroll to the end of the rows | Only the first page of rows is loaded; the next page loads when the end comes into view, not before; after sorting by a column the list restarts from its first page (scrolled to the top) and the next page continues the same order | Playwright (e2e `15-layout-contract` R-11, and the check) |
| TBL-05 | Open the Log, scroll it past the first page and wait a few seconds | The rows and the scroll position stay as they are (the list is not reset by the clock) | Playwright (e2e `12-review-round1-platform`, and the check) |
| TBL-06 | Open a page or app with nothing in it (Plugins › Installed, Updates and Catalog, Tenants, a fresh tenant's Documents, Maps, Sites, Contacts, Tasks, Notes, Groups, Access requests, Trash, Shares, Notifications; also Manage › Pending, a group without members); then type something that matches nothing in the filter of a list | An illustration of soft tiles with a title, a short grey line and the buttons of what to do (the primary action of the page is repeated), centred in the content area, without a scrollbar (in Manage › Pending each list keeps its heading and shows a small version of the illustration with its title, one line and **Invite people**); with a filter that matches nothing only a small message and **Clear filters** | Playwright (e2e `15-layout-contract` R-10, and the check) |
| TBL-07 | Open Notes, Tasks and Contacts with some items; look at the page; click a card (or row); click another; press **Cancel** or Escape; press **New**; resize to a phone | The list takes the whole width while nothing is open; the panel appears only for a new item or the selected one (with its name read by screen readers, the focus inside it and, when it closes, back on the item); another item switches the panel; on a phone the panel is a sheet over the list; saving closes the panel for Tasks (Notes and Contacts show the saved item for reading) | Playwright (e2e `15-plugin-layouts`, layout contract R-3, and the check) |
| TBL-08 | Open Documents (as `s.greco`), upload an image, a PDF and a text file; click each in turn; click **Open** in the panel; select one file and look at the bar; hover a button of the bar | The panel shows the picture, the text and the first page of the PDF (drawn by the app, not a blank frame); **Open** shows the whole PDF page by page; the bar has only the icons (a tooltip with the name on hover or focus) next to «1 item selected»; list and panel are one flat block with one border and no gap; the panel never scrolls sideways (**Open in tab** fits); the scrollbar of the table appears only with many files | Playwright (e2e `17-documents-preview`, and the check) |
| TBL-09 | Open Documents (as `e.ricci`) in a folder with more than 100 files (upload 120 small files); look at the list, scroll to the end, press Ctrl+A, switch to the grid | Only the first 100 rows are drawn and the foot says «100 of N items» with **Load more**; scrolling to the end draws the rest and the foot reads «N of N items» without a button; Ctrl+A selects all N files (also those not drawn yet) and the bar says «N items selected»; the arrow keys move on past the drawn rows; the grid view also draws 100 cards at a time; a folder of 5000 files opens at once | Playwright (e2e `17-documents-preview`, the check, and the unit test of the file manager) |

## Sidecars of a distribution

`[[sidecars]]` in `distribution.toml` (architecture §14): extra processes or services a distribution ships next to the kernel. The desktop launcher starts them before the kernel and stops them after it; the Docker and Kubernetes releases generate a service per entry. A sidecar with a `port` is added to `MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS` (`127.0.0.1:<port>` on the desktop, `<name>:<port>` in containers).

| Id | Steps | Expected | Twin |
|---|---|---|---|
| SC-01 | Write a distribution with two sidecars (one depends on the other) and run `cargo xtask --dist <folder> sidecars`; then break it in turn: duplicate name, unknown `depends_on`, a cycle, a port out of range or used twice, a `health` that is neither `tcp` nor a path, an entry with neither `command` nor `image` | The valid file prints the sidecars and the two address lists; every broken file is refused with a message that names the sidecar and the problem | Playwright (the check, runs xtask) |
| SC-02 | Look at the generated `compose.sidecars.yml` (`cargo xtask --dist <folder> sidecars` prints it, `release docker` writes it with `COMPOSE_FILE` in `.env`) and at `sidecars.yaml` of `release k8s` | One service (Deployment and Service on Kubernetes) per sidecar with image, env (`env:NAME` as `${NAME}` or a secret key), volumes, healthcheck or probes; the app service depends on them and gets the allowed hosts | Playwright (the check; the Docker run itself is not exercised) |
| SC-03 | Build the desktop release of a distribution with a sidecar and start the app; then rename the sidecar executable and start again; then make its health fail | Splash window: «Starting <name> (1/1)», then «Waiting for <name>»; the app opens after the sidecar is healthy; its output is in `data\logs\sidecar-<name>.log`; a killed sidecar restarts according to `restart`; Quit stops the kernel first and then the sidecars; a missing executable or a health timeout stops the start with a message that names the sidecar and the log | Playwright (the check runs the launcher tests with a fake sidecar; the splash window is not driven) |
| SC-04 | Write a distribution with a `kind = "oneshot"` sidecar (no port) and a service that `depends_on` it; run `cargo xtask --dist <folder> sidecars`; then give the oneshot a `port` or a `health` | The valid file is accepted: the oneshot is not in the address lists; the Compose output has `restart: "no"` for it and `condition: service_completed_successfully` in `app` and in the dependant; a oneshot with `port` or `health` is refused with a message that names the sidecar | Playwright (the check, runs xtask) |
| SC-05 | Add `files = [{ source, target }]` to a sidecar: first valid, then break it in turn: a missing source, a source with `..`, a duplicate target, a bad `mode` | The Compose output has a read-only bind mount per file from `sidecar-files/<name>/`; every broken file is refused with a message that names the sidecar and the file | Playwright (the check, runs xtask) |
| SC-06 | Start the desktop app of a distribution whose oneshot sidecar fails (exit code other than 0), then one whose oneshot exceeds `start_timeout_secs`, then a working one with a dependant and a `files` overlay | Splash: «Running <name> (1/2)»; a failing or too slow oneshot stops the start with a message that names the sidecar and shows the last lines of `data\logs\sidecar-<name>.log`; the dependant starts only after the oneshot succeeded; the overlay files are in `sidecars/<name>/` and are replaced at each start; the Kubernetes output (Job, initContainer that waits, ConfigMap, 512 KiB limit) is covered by the xtask unit tests | Playwright (the check runs the launcher and xtask unit tests; the splash window is not driven) |

## Deployer allow-list and seeded settings

A deployer can let plugins reach an internal service (`allow_private_fetch_hosts`) and a distribution can seed plugin settings and platform keys (`[[plugin_settings]]`, `[[service_key_values]]`, read from `plugin_settings_file`). The twins need a server started with the fixture `tests/fixtures/seed-check.toml` (`MOSAIKIT_PLUGIN_SETTINGS_FILE`, and `SEED_CHECK_TOKEN=seed-check-1234` in the environment); with a plain run they report NOT VERIFIABLE.

| Id | Check | Expected | Twin |
|---|---|---|---|
| SEED-01 | Start the server with `MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS=127.0.0.1:9` and a plugin that lists `http://127.0.0.1:9` in its network permission and one that lists `http://127.0.0.1:10`; let each call its origin; also try `MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS=10.0.0.0/8:80` | The first plugin passes the guard (the connection is attempted); the second, the same host on another port, is refused with «this address is not allowed»; a plugin that does not list the origin is refused by the permission check; a malformed entry stops the start with a message naming `allow_private_fetch_hosts` | Playwright (NOT VERIFIABLE: the harness server runs with `allow_private_fetch`; the cases are covered by the kernel test `deployer_allow_list_of_private_destinations`) |
| SEED-02 | Start the server with `plugin_settings_file` pointing at the fixture, `SEED_CHECK_TOKEN` set and a plugin that declares the service `translate`; as Administrator open System › Keys of outside services | The platform key of «translate» shows as set (only its last four characters), it was not typed by anyone; the page and the API answers never contain the whole value | Playwright (the check, with the fixture) |
| SEED-03 | As Administrator replace the seeded key of «translate» with another, then remove it; restart the server with the same fixture | After the restart the key is still the Administrator choice (replaced, then absent): the seed is never applied a second time and never overwrites | Playwright (the check cannot restart the server: it checks the replace and the removal; the restart is the kernel test `a_deployment_seeds_settings_and_keys_without_overwriting_the_administrator`) |
| SEED-04 | Put in the seed file an unknown plugin, an unknown setting key and a reference `env:NOT_SET_ANYWHERE`; start the server | The server starts; the log has one warning per entry naming the plugin, key or variable and never a value; the Administrator sees nothing changed | Playwright (NOT VERIFIABLE: needs a restart with a changed file; kernel test `a_seed_never_overwrites_a_value_set_before_it`) |
| SEED-05 | Add a `[[plugin_settings]]` with an unknown field, or `value = "env:"`, to `distribution.toml` and run `cargo xtask ci` (or any xtask command) | The command fails before doing anything, naming the file and the entry | Playwright (NOT VERIFIABLE: it is an xtask check, covered by `dist::tests`) |

## Plugin API 1

Phase 1 of [plugin-devkit-plan.md](plugin-devkit-plan.md): the manifest declares the versions of Mosaikit and the plugin API a plugin works with (`[requires] mosaikit`, `api`), the shell and the plugin UI agree on the API when a page opens, and an error of the logic keeps its own code up to the plugin UI (architecture §8.2 and §8.11).

| Id | Check | Expected | Twin |
|---|---|---|---|
| API-01 | As Administrator open Plugins › Installed and the brochure of a plugin (Overview tab, Permissions and requirements); then read `GET /api/admin/plugins` | Every plugin tells the range of Mosaikit it accepts and the plugin API it was built for (1); the brochure shows «Needs Mosaikit …» only for a plugin that names a range; the old `min_kernel` is gone | Playwright (`tests/manual/checks/api.ts`) |
| API-02 | As Administrator open Plugins › Updates with a catalog whose newest version of a plugin asks for another version of Mosaikit (a registry index whose entry has `"mosaikit": ">=99, <100"`) | The row shows, in the language of the interface, why it cannot be installed («Works with Mosaikit >=99, <100; this is …») and its Update button is off | Playwright (same file, the catalog answer is replaced in the page) |
| API-03 | Open an app (Contacts) and watch what the page does when it opens: the plugin sends its API in `hello`, the shell answers with its own; then, from the console of the plugin frame, send `hello` with an API newer than the shell speaks | The shell answers with API 1; a plugin that announces nothing is still served; one built for a newer API is refused with the code `incompatible_api` and a message tells the person to ask the Administrator to update Mosaikit | Playwright (same file) |
| API-04 | In Contacts try to save a contact with an invalid email; open a contact that does not exist | The logic's refusal reaches the plugin UI with its own code (`email_invalid`) and its message; the missing item keeps the code of the platform (`not_found`) | Playwright (same file) |
| API-05 | Install from a file a package whose `[requires] mosaikit` excludes this version, then one with `[requires] api = 2`, then one that still uses `abi` and `min_kernel`; load a plugin folder that uses the old keys in development | The first two are refused with one message that names the range (or the API) and the version of Mosaikit, the same in every language; the third installs; the folder logs a deprecation warning for each old key | Not automated by the browser: needs signed packages and a folder in development; kernel test `range_and_api_of_the_plugin_are_checked` and the manifest tests |
| API-06 | Install a plugin whose logic reads files (`[permissions] files_read = true`); as Administrator open its «What it asks» and its brochure; then with a plugin that does not declare it, make the logic call `files.list` | The permission shows as «Reads the files of the person who uses it» (sensitive, red) and as the chip «Reads the files you can see»; the plugin without it is refused with the code `permission_denied` | Not automated by the browser: needs a signed package with logic; kernel tests `files_ops_need_the_permission_in_the_manifest`, `files_ops_follow_the_visibility_of_the_caller`, `files_read_is_capped_and_leaks_no_path` |
| API-07 | As Anna upload a file in Documents and share it with Bruno (read); Carla gets nothing. Use a plugin with `files_read` that lists, describes and reads files | The logic sees for Anna her files, for Bruno only the shared one (level read), for Carla nothing; a file she cannot see answers `not_found`; a read of a big file is cut (`truncated`) and no answer shows a path on disk | Not automated by the browser (same kernel tests as API-06) |

## Plugin dev kit: the command-line tool

Phase 2 of [plugin-devkit-plan.md](plugin-devkit-plan.md): `mosaikit-plugin` (crate `mosaikit-plugin-cli`) does the whole loop of a plugin developer without `xtask` and without the `mosaikit` repository: `new`, `build`, `pack`, `test`, `sign`, `keygen`, `validate`, `install --server`, `doctor`. The checks run the executable in a temporary folder. Phase 3 adds the standalone templates, the six variants and the three examples (DK-08..11). Phase 4 adds the developer profile of the server, `mosaikit-plugin dev`, the developer tools of the shell and the Docker kit (DK-12..16). Phase 5 adds the conformance suite `validate --strict`, the recipes of `MockHost` and the package `@mosaikit/plugin-testing` (DK-17..20).

| Id | Check | Expected | Twin |
|---|---|---|---|
| DK-01 | In an empty folder run `mosaikit-plugin new demo --id com.test.demo --no-logic --no-ui`, `mosaikit-plugin keygen --out k.key`, then in `demo`: `validate`, `pack --no-build --key ../k.key`, and `validate dist/com.test.demo-0.1.0.mskp` | The folder is made; the new plugin validates with 0 errors and 0 warnings; the package `dist/com.test.demo-0.1.0.mskp` is made and its sha256 printed; the package validates and says its signature is valid | Playwright (`tests/manual/checks/dk.ts`, runs the executable) |
| DK-02 | Run `mosaikit-plugin doctor` | It lists the tool and plugin API version, `rustc`, `cargo`, the `wasm32` target, `node` and `npm`, each as ok, warn or FAIL with what to do; it exits with 1 only if a required one fails (Node is only a warning) | Playwright (same file) |
| DK-03 | In the plugin of DK-01 add `migrations/002_bad.sql` with `drop table core.users;` and run `validate`, then `pack --no-build`; remove it and replace the `[requires]` block of `plugin.toml` with `min_kernel = "1.0.0"` | The bad migration is an error that names its file and `validate` exits with 1; `pack` stops and makes no package; the old key and the missing `[requires]` are warnings, not errors | Playwright (same file) |
| DK-04 | Make two keys (`keygen --out a.key`, `keygen --out b.key`), run `keygen --out a.key` again, pack with `a.key`, then `sign <package> --key b.key` and `validate` it | `keygen` refuses to overwrite a key; after `sign` the package has the publisher key of `b.key` and still validates | Playwright (same file) |
| DK-05 | Pack a plugin and run `mosaikit-plugin install <package> --server <url> --user admin --password ... [--totp code]` against a running instance; run it again without `--user` | The package is installed as an Administrator would from Plugins › Install from a file, or the server's own refusal (for instance a key it does not trust) is shown with its status; without an Administrator nothing is sent | Playwright (same file, against the instance of the run) |
| DK-06 | Run `mosaikit-plugin dev` where no server executable can be found (no `--server`, no `MOSAIKIT_SERVER_BIN`, none next to the tool), then with `--server` pointing at a file that does not exist | It builds nothing and exits with 1; the message says where the server comes from (`--server <path>`, `MOSAIKIT_SERVER_BIN`, or next to the tool); a wrong path is named | Playwright (same file) |
| DK-07 | With a Rust that has no `wasm32` target, run `mosaikit-plugin new weather --no-ui --sdk-path <sdk>`, then `build --release`, `pack --release --no-build` and `test` in `weather` | `build` installs the `wasm32-unknown-unknown` target by itself, builds `logic.wasm`; the package validates; the tests of the logic pass | Not automated by the browser: it needs a toolchain without the target; the crate test `new_build_pack_validate_with_logic` runs the same flow and the toolchain tests cover `doctor` |
| DK-08 | Run `mosaikit-plugin new <name> --variant <v>` for `app`, `ui`, `service`, `extension`, `language` (name `lang-fr`, or `--lang fr`) and `layout`; run `validate` in the last three; run it for `language` without a code | Each makes a standalone folder (own `.gitignore`, no `Cargo.lock` yet) with the files of its kind: `app` has `Cargo.toml`, `src/lib.rs`, `ui/src/i18n.ts` with its test, `.oxlintrc.json`, the CI file and a README; `ui` has no crate; `service` has no UI; `extension`, `language` and `layout` validate with 0 errors and 0 warnings; the `ui` build tools are `typescript ~7.0.2` and `vite ^8.3.4`, the versions of this repository; a language without a code is refused | Playwright (`tests/manual/checks/dk.ts`) |
| DK-09 | Run `mosaikit-plugin new <name> --example todo`, then `--example insights`, then `--example note-priority`, and `validate` in each; read the `WALKTHROUGH.md` of each beside its files | Each example comes with a walkthrough that names the steps of the files; they validate; their manifests have the Italian and Spanish texts; an unknown example is refused | Playwright (same file) |
| DK-10 | Run `new` with `--kit <folder>`, without it, and with `--kit` and `--sdk-path` together | With the kit, `Cargo.toml` takes the SDK from `<kit>/sdk` and `ui/package.json` the UI package from `<kit>/plugin-api` (`file:`); without it the published versions (`mosaikit-plugin-sdk = "1"`, `^1.0.0`) are asked for; an explicit path wins over the kit; the fonts of the UI package are among the dependencies of the plugin (npm does not install the dependencies of a linked package) | Playwright (same file) |
| DK-11 | With the kit unpacked (the SDK as the crate of `cargo package`, `@mosaikit/plugin-api` as the tarball of `npm pack`), make the two examples with logic, the `ui` and `service` variants, the example extension, the plain extension, a language and a layout with `new --kit`, then `test` and `pack --release` in the four that build, `validate` and `pack --no-build` in the rest, and `validate` every package | All build with no checkout of Mosaikit beside them: the logic compiles to `wasm32`, the tests of the logic and of the UI (`vitest`) pass, the type check and the lint are clean, the UI is built, and every package validates and is signed | Not automated by the browser (about two minutes): the crate test `every_variant_builds_and_packs_from_the_kit` in `crates/plugin-cli/tests/cli.rs` |
| DK-12 | In a plugin folder run `mosaikit-plugin dev` (the server of the kit next to the tool, or `--server`) | The server starts in the developer profile on the loopback, on a free pair of ports; the tool prints the address of the app, the one of the plugins (`*.localhost`), the four test users with their password and the address of the plugin, and opens the browser on it; `/api/health` says `developer: true`; the plugin of the folder is loaded from it; Ctrl+C stops tool and server | Playwright (`tests/manual/checks/dk.ts`, `dev --no-open --no-build`) |
| DK-13 | Start the server with `developer_profile = true` and `listen = "0.0.0.0:..."`; with a `database.url` on another host; with `trust_proxy = true`; then with `developer_profile_allow_remote = true`; then without the profile | The first three refuse to start and say why; with the flag it starts and logs `DEVELOPER PROFILE ON`; without the profile nothing mentions it | Playwright (same file) |
| DK-14 | Open the app of DK-12. Before signing in read the banner; sign in as `alice` (tenant `dev`, password `mosaikit-dev`); open the plugin; open Developer tools and go through Manifest, Host calls, Permissions, Test users and Data; switch to `bob`; sign in as `manager` and open the tools with no plugin open | The banner is there at every page, before and after signing in, and lists the users before; the manifest is the one the server reads; the host calls of the plugin show with their time and their errors; the permissions are those of Alice; the four test users are listed and the switch signs in as Bob without a password; with no plugin open the panel says «Open a plugin» as an empty state; the notifications of Alice hold the welcome message of the profile | Not automated by the manual suite (it needs its own server in the profile): the e2e test `tests/e2e/specs/18-developer-profile.spec.ts` |
| DK-15 | With the page of the plugin open change `ui/dist/index.html`; change the `label` in `plugin.toml`; change a migration that already ran; use «Reset the data of this plugin» and answer No, then Yes | The frame reloads by itself with the new page; the manifest in the tools shows the new label; the changed migration is refused and the shell asks whether to delete the data of the plugin and run its migrations again, and does it only after a yes; the reset also asks first, and a No changes nothing | Not automated by the manual suite: the same e2e test |
| DK-16 | Run `cargo xtask release devkit-docker --no-build`, then `docker compose config` in the folder it writes; with the image built (`cargo xtask release devkit-docker`) run `docker compose up -d` with `PLUGIN_DIR` on a plugin folder | The folder `dist/mosaikit-dev-<version>-docker` has `compose.yml`, `.env`, `README.md`, `initdb/` and an empty `plugin/`; the compose file turns the developer profile on and publishes the ports on `127.0.0.1` only; with the image, the app answers on `http://localhost:8080` with the banner, the test users sign in and the plugin migrations run on PostgreSQL | Playwright (same file) for the folder and `docker compose config`; the real run (image build and `docker compose up`) is by hand: not automated, and not run on every machine |
| DK-17 | Run `mosaikit-plugin validate --strict` in the good fixture of `crates/plugin-cli/tests/fixtures/good`, and in every official plugin of `mosaikit-plugins` (and `mosaikit-plugin test` in a plugin made by `new`) | Each passes with 0 errors; the report says what was checked (the permissions against the calls of the logic, migrations for PostgreSQL and SQLite, the UI, i18n, the layout contract of the `mountCrud` pages); the plain `validate` does not run the suite | Playwright (`tests/manual/checks/dk.ts`) and the crate tests `the_good_fixture_passes_the_strict_suite`, `the_official_plugins_pass_the_strict_suite` |
| DK-18 | Lay each folder of `crates/plugin-cli/tests/fixtures/broken/<case>` over a copy of the good fixture and run `validate --strict`: a permission the logic uses and the manifest lacks (`notify`), one asked for and unused (`files_read`), a hook with no code, a migration that drops a table, a gap in the numbering, `create table core.x`, a UI with an outside script and an inline script, an incomplete `[i18n.it]`, a `mountCrud` page of an undeclared resource with no style import, a manifest with no description | Each exits with 1 and the message names the cause (the permission, the migration file, the page of the UI, the missing keys) | Playwright (same file) and the crate test `the_broken_fixtures_fail_the_strict_suite` |
| DK-19 | In a plugin with logic write tests with `MockHost`: `db.query` with its SQL and parameters, `notify` (the notifications it got and a refusal), `call_plugin` (`with_plugin_command`), the permissions of the caller (`with_perms`), a refused operation (`deny`) and the Files area (`with_files`: `files.list`, `files.describe`, `files.read`) | The logic runs natively against the answers; an operation with no answer fails with `MockHost: no answer for <op>`; the recipes are in the documentation of `mosaikit_plugin_sdk::testing` | Not automated by the browser: the native tests of the SDK (`cargo test -p mosaikit-plugin-sdk testing`) |
| DK-20 | In a plugin folder with `mosaikit-plugin dev` running, write a Playwright test with `@mosaikit/plugin-testing`: `attachDevServer()`, `signIn(page, url, 'alice')`, `openPlugin`, `createItem(frame, { title })`, `expectAccessible(page)`; run the unit tests of the package | The test signs in as the test user, opens the plugin and creates the item; attaching to a server that is not in the developer profile is refused; `expectAccessible` lists the serious and critical violations of axe, or passes; the package has README, CHANGELOG, version 1.0.0, explicit exports, and its unit tests pass with no server | The unit tests and the files of the package by Playwright (same file); the run against a server is by hand: not automated |
| DK-21 | On a machine with the signing key in `MOSAIKIT_SIGNING_KEY`, run `cargo xtask release devkit` (and the `release` workflow on a tag, on Windows, Linux and macOS). Unpack the archive of your platform | `dist/devkit` holds `mosaikit-devkit-<version>-<platform>.zip` (Windows) or `.tar.gz`, its `.sig`, `SHA256SUMS`, `SHA256SUMS.sig` and `RELEASE-NOTES.md`; the archive holds `bin/mosaikit-plugin` (and `bin/mosaikit-server` on Windows only), `sdk/` (the unpacked `.crate`), `plugin-api/` (the unpacked `npm pack`), `docs/devkit`, `examples/`, `docker/`, `LICENSE`, `THIRD-PARTY-NOTICES.md`, `COMPATIBILITY.md`, `trusted_key.txt`; without a key the command refuses, and says to use `--allow-dev-key` for a trial | Playwright (`tests/manual/checks/dk.ts`) for the workflow wiring, and for the archive when `target/release/mosaikit-plugin` exists (`--skip-build --allow-dev-key`); the full build on each platform and the GitHub Release are by hand: not automated |
| DK-22 | Make a folder with a release (archive, `SHA256SUMS`, `SHA256SUMS.sig`, `RELEASE-NOTES.md`) signed with a key; run `mosaikit-plugin self-update --from-dir <folder> --trusted-key <public key> --check`, then without `--check`, then with `--yes`; then with sums signed by another key, with a changed archive, and with a release whose «Breaking changes» says None | `--check` prints the version and the breaking changes and installs nothing; a release with breaking changes (or a new major version) is refused without `--yes`; with `--yes` `bin/`, `sdk/`, ... are replaced and `VERSION` is the new one; another key or a changed archive is refused (`signature`, `hash does not match`) and the kit is untouched; a patch with no breaking changes updates without `--yes` | Playwright (same file, a kit made on the spot) and the crate tests of `update.rs`; the download from GitHub is by hand: not automated |
| DK-23 | Follow `docs/devkit/signing.md`: `mosaikit-plugin keygen --out publisher.key` twice; add the public key to `trusted_keys` of a server and install a package signed with it and one signed with another key; remove the key and try again | The first run writes the key and prints the public one, the second refuses to overwrite; the package of the trusted key installs, the other is refused with `publisher key not trusted`; after the key is removed a new install is refused and the installed plugin stays until uninstalled | Playwright (same file) for `keygen` and the document (with its Italian version); the server steps are by hand: not automated here (the trust check itself is in P6) |
| DK-24 | Run `cargo xtask release devkit-notes --out <folder>` | `RELEASE-NOTES.md` starts with the version of the workspace, has «Breaking changes» (the text of the `### Breaking changes` of the changelogs, or «None.») and «Changes»; `COMPATIBILITY.md` lists platform, plugin API, SDK, UI package, `.mskp` format and, for every example and official plugin, its `[requires]` and whether it works with this kit | Playwright (same file) and the tests of `xtask/src/devkit.rs` |
| DK-25 | Run `cargo xtask release devkit-notices --out <folder>` (with `cargo-deny` installed) | `THIRD-PARTY-NOTICES.md` lists every Rust crate of the CLI and the server with its licence, and the npm packages of the UI package with the text of their licence; `cargo deny check licenses` passes (a licence outside `deny.toml` stops the command); no GPL licence appears | Playwright (same file); the `cargo deny` step runs only where `cargo-deny` is installed |
| DK-26 | `cargo metadata --no-deps`, and `cargo package -p mosaikit-mskp --list` (also `mosaikit-sql-guard`) | `mosaikit-mskp`, `mosaikit-sql-guard`, `mosaikit-plugin-sdk` and `mosaikit-plugin-cli` have version, licence, description, repository and readme and are publishable; the other crates are `publish = false`; the packages list README, CHANGELOG and the sources | Playwright (same file); `cargo install` from a registry is by hand: nothing is published |

## Public link pages: settings and commands

Public settings and public commands of a plugin ([architecture 8.13](architecture.md)): the page of a public link may read the settings its plugin marks `public = true` and run the commands it lists in `[[public_commands]]`, read only, on the shared item. The Administrator reviews them at install, and a tenant must turn on the policy «Public commands» (off by default). Checks that need a plugin with public commands use a signed test package with logic.

| Id | Check | Expected | Twin |
|---|---|---|---|
| PL-01 | As Tenant Manager open Manage › Settings › Sharing: read «Public commands», turn it on and save, then off again; as Administrator open Plugins › Installed, a plugin of the repository, «What it asks» | The switch is off by default and keeps what is saved (Italian: «Comandi pubblici»); «Commands open to public links» says «nothing» for the official plugins | Playwright (`tests/manual/checks/pl.ts`) |
| PL-02 | As Sara make a public link on a note; open `<link>config` and send `POST <link>call/anything` (JSON body) and a form post; then revoke the link and repeat | `config` answers `{}` (the plugin has no public setting); the command is refused with 403 `command_not_public`; the form post is refused (400); after the revocation both answer 404 | Playwright (`tests/manual/checks/pl.ts`) |
| PL-03 | Install a signed package whose manifest marks one setting `public = true`, one `secret` and one plain setting, with the Administrator having set all three; open a public link of its item and read `<link>config` and `msk.publicConfig()` in the page | Only the public setting is there, with the Administrator's value; neither the secret nor the plain one; a package that marks a secret `public` is refused at install | Not automated by the browser: kernel test `secrets_never_reach_a_public_page_or_command`, `a_secret_setting_cannot_be_declared_public`, server test `public_settings_and_commands_over_http` |
| PL-04 | With the package of PL-03 declaring `[[public_commands]]`: as Administrator open «What it asks» of the plugin; as Tenant Manager leave «Public commands» off and call a command from a public link, then turn it on and call it again | The Administrator sees the commands, in red, with their description; the first call is refused (`public_commands_off`), the second runs | Not automated by the browser: kernel test `the_tenant_switch_is_off_by_default`, server test `public_settings_and_commands_over_http` |
| PL-05 | Call a public command that tries to read another item of the owner, to write (`db.exec`, an `insert ... returning`, `resource.create`, `notify`, `plugin.call`, files), and to use an id sent in its arguments; call it from a revoked, an expired and a password-locked link | It sees only the item of the link; every write and every other operation is refused and nothing changes; the three links run nothing (404 or the password page) | Not automated by the browser: kernel tests `a_public_command_sees_only_the_item_of_the_link`, `a_public_command_cannot_write_or_reach_other_operations`, `a_revoked_or_expired_link_runs_nothing`, server test `public_settings_and_commands_over_http` |
| PL-06 | Call a public command more than 30 times in a minute on one link; set a personal key, then a tenant key that is not shared, then a shared one, for a service the plugin declares, and ask for the key from a public command; read the Log | The 31st call is refused (429 `public_rate_limited`) and another link still works; a personal key and a not shared tenant key are never used, the shared tenant key, else the platform's, is; the Log has one `link.call` a minute for a link, with the command name and no arguments | Not automated by the browser: kernel tests `a_link_has_a_rate_limit`, `a_public_command_never_uses_a_personal_key`, `a_public_call_leaves_one_event_per_minute_and_no_arguments` |
| PL-07 | As Sara make a public link on a note and read the `Content-Security-Policy` header of `<link>` as an anonymous visitor; then, as Administrator, open Settings › Embedding and read the help text | `frame-ancestors` lists `'self'`, the app origin and the plugin origin (the static sites of the installation may embed the page), never `'none'` and no unrelated origin; the help text says the static sites of the installation always may | Playwright (`tests/manual/checks/pl.ts`); server tests `public_pages_are_embeddable_by_the_sites_of_the_installation_by_default`, `remember_me_and_embedding_of_public_pages` |

## Run tickets: a plugin called on behalf of a background run

Run tickets ([architecture 8.14](architecture.md)): a service of a distribution runs a process in the background and calls a plugin as the person who started it, with a ticket the person minted. A plugin lists the commands a run may call in `permissions.run_commands`; the Administrator reviews them at install. Checks that need a plugin with run commands use a signed test package with logic.

| Id | Check | Expected | Twin |
|---|---|---|---|
| RT-01 | As Administrator list the plugins; as Sara ask for a ticket (`POST /api/t/<tenant>/run-tickets`) for Notes; without a session ask for one; send a made-up ticket to `POST /api/run/<ticket>/call/<plugin>/<command>` as JSON and as a form | The official plugins declare no run commands; the ticket for Notes is refused (400 `no_run_commands`); without a session 401; the made-up ticket 401 `run_ticket_invalid`; the form post 400 | Playwright (`tests/manual/checks/rt.ts`) |
| RT-02 | With a signed package declaring `run_commands = ["step"]`: as Sara mint a ticket for `step` with a run reference, redeem it with a JSON body, read the Log | The command runs as Sara and sees `ctx.on_behalf` with the run reference (the arguments cannot set it); the Log has `run_ticket.mint` and `run_ticket.call` with the run reference and no token | Not automated by the browser: kernel tests `a_call_runs_as_the_starter_and_knows_the_run`, `mint_call_and_revoke_leave_audit_rows_with_the_run`, server test `run_tickets_over_http` |
| RT-03 | Redeem a ticket after its expiry, after its last use, after Sara revoked it, after a Tenant Manager revoked it and after the service ended the run (`DELETE /api/run/<ticket>`) | Every case answers 401 `run_ticket_invalid` and runs nothing; a person other than the starter cannot revoke it (404) | Not automated by the browser: kernel tests `an_expired_ticket_does_nothing`, `a_ticket_cannot_be_used_beyond_its_uses`, `a_revoked_ticket_does_nothing` |
| RT-04 | Redeem a ticket for another plugin, for a command Sara did not name at mint, for a command the manifest does not declare, and after an update of the plugin that drops the declaration; mint for a command the manifest does not declare | 403 `run_wrong_plugin`, `run_wrong_command`, `command_not_declared`; the mint is refused (403 `command_not_declared`); refused calls spend no use | Not automated by the browser: kernel tests `a_ticket_is_for_its_plugin_and_its_commands`, `an_update_that_drops_the_declaration_stops_the_tickets` |
| RT-05 | Mint a ticket limited to one item of Sara and call a command that reads every item, tries to change the others and to create an item at the top; try a ticket for an item of another tenant | The command sees only that item (and what is inside it) and the writes touch nothing: the database enforces it; the other tenant's item cannot be named (404); a ticket without a list sees all of Sara's items and none of another tenant's | Not automated by the browser: kernel tests `the_resource_scope_is_enforced_by_the_database`, `the_ticket_of_one_tenant_never_reaches_another`, database test `run_ticket_scope_caps_the_level` (PostgreSQL and SQLite) |
| RT-06 | After minting, take back a share, suspend Sara in the tenant, disable her account, remove her from the tenant and turn the plugin off, redeeming after each | The rights are the ones of the moment of the call: the item whose share was taken back is gone, the other cases are refused | Not automated by the browser: kernel tests `the_rights_of_the_person_are_the_ones_of_the_call`, `a_suspended_removed_or_turned_off_person_gets_no_call` |
| RT-07 | Redeem a ticket with a changed character, a short, a long and a non-hex token; look for the token in the database and the Log; mint with a lifetime over 60 minutes, more than 1000 uses, a long reference, over 64 resources; send arguments over 256 KiB; mint more than 30 tickets and make more than 120 calls with one ticket in a minute; call `plugin.call` from a run command | Every forged token 401; only a hash is stored, never the token; the limits answer 400 `args_too_large` or 400, then 429 `run_rate_limited` (a refused call spends no use); `plugin.call` is refused | Not automated by the browser: kernel tests `a_forged_or_tampered_token_is_refused`, `the_raw_token_is_not_kept_anywhere`, `limits_on_size_lifetime_and_number`, `minting_and_calling_are_rate_limited`, `a_call_on_behalf_cannot_call_other_plugins_or_mint` |
| RT-08 | Install the package of RT-02 as Administrator and open «What it asks» of the plugin; open the plugin's brochure | A row «Commands a background run may call» lists the commands in red as sensitive (Italian: «Comandi che un run in background può chiamare»), and the brochure has the chip «Runs commands for background runs» | Not automated by the browser: needs the package of RT-02; manifest test `run_commands`, validate test `run_commands_need_a_mosaikit_that_knows_them` |
## Schedules: the worker that runs the jobs

Schedules ([architecture 8.17](architecture.md)): a person puts a job of a plugin on a timetable and a worker of the kernel runs it as that person, through a service of the distribution. Checks that need a plugin with `[[schedules]]` and a service use a signed test package with logic and a fake service on the loopback; their automated twin is `crates/kernel/tests/schedule_worker.rs` (PostgreSQL and SQLite) and `schedule_runs_over_http` in `crates/server/tests/http.rs`.

| Id | Check | Expected | Twin |
|---|---|---|---|
| SD-01 | As Administrator list the plugins; as Sara register a schedule of Notes (`POST /api/t/<tenant>/schedules`), run one now, take one over and read its runs (`/run`, `/take-over`, `/runs`) with a made-up id, and without a session | The official plugins declare no schedules; Notes is refused (400 `schedule_not_declared`); a made-up id answers 404 on `run`, `take-over` and `runs`; without a session 401 | Playwright (`tests/manual/checks/sd.ts`) |
| SD-02 | With a package that declares a schedule whose target is a service on the loopback: register it, make it due (set `next_run_at` in the past) and wait for the worker (30 seconds) | The service receives one `POST` with the shared key as `Authorization: Bearer` and the tenant, the author, the schedule and the ticket in the body; it answers 202 with a run id; the run shows `running` with that id; the schedule is not run again while it runs; when the service answers `succeeded` the run is `succeeded` and the ticket stops working | Automated (`a_due_schedule_is_pushed_with_a_ticket_and_its_result_is_read`) |
| SD-03 | Before the run is due: suspend Sara in the tenant by other means, then turn the plugin off for the tenant in another case | Nothing is sent and no ticket is made; the schedule is paused (`author_inactive`, then `plugin_off`), the Log has `schedule.skipped`, the Tenant Managers get a notification when it is the author; reactivating Sara resumes nothing | Automated (`the_rights_of_the_author_are_checked_when_the_run_is_due`, `a_plugin_that_is_off_pauses_the_schedule_with_its_own_reason`) |
| SD-04 | Make the service answer 500 five runs in a row; then let a run last past its limit | The next run is brought forward to a retry (5, 10, 20, 40 minutes); at the fifth failure the schedule is paused (`failures`) and its author is notified; a run past `max_runtime_minutes` (at most 60) is `timed_out` and its ticket stops working; the service key is nowhere in the Log | Automated (`five_failures_in_a_row_pause_the_schedule_and_tell_the_author`, `a_run_past_its_deadline_is_timed_out`) |
| SD-05 | Register a schedule with the time zone `Europe/Rome` and one with `Mars/Base`; read the next run of a `30 2 * * *` schedule for the night the clocks go forward and the night they go back; stop the kernel for 3 hours across a fire time of two schedules, one with `catch_up_once` | The unknown zone is refused (400 `bad_time_zone`); in Rome the fire times follow the local clock; the missing 02:30 runs once just after the gap and the doubled one runs once, the first time; after the downtime the schedule without the flag skips the run (`missed`), the one with it runs once | Automated (`crates/kernel/src/cron.rs` unit tests, `the_time_zone_of_a_schedule_is_validated_and_used`, `a_late_schedule_skips_its_missed_runs_unless_it_catches_up_once`) |
| SD-06 | As a Tenant Manager take over a schedule whose author was removed; as Sara (not a manager) and as Bruno (another member) try the same; then run it now twice | The manager now owns it, it is active and runs as the manager (the ticket is theirs); the Log has `schedule.takeover`; Sara gets 403 `manager_only` and Bruno 404; run-now answers the run, and the second one 409 `already_running`; a paused schedule answers 409 `schedule_paused` | Automated (`a_tenant_manager_takes_a_schedule_over_and_it_runs_as_them`, `run_now_goes_through_the_same_gate_and_never_overlaps`, `schedule_runs_over_http`) |
| SD-07 | Start two kernels on one PostgreSQL with three due schedules (or call the claim twice at once) | Each schedule is claimed by one worker only and runs once; a lease that ended (a worker that died) lets another worker claim the schedule again | Automated (`two_workers_never_claim_the_same_schedule`) |

## Grouped sidebar navigation

A distribution can group the apps of the sidebar (`[[nav_groups]]` of its `distribution.toml`, [architecture 14.3](architecture.md)). The twins that need groups use the fixture `tests/fixtures/nav-groups-check.toml` (`MOSAIKIT_PLUGIN_SETTINGS_FILE`, `NAV_FIXTURE=1` in the run); the interaction is driven by `tests/e2e/specs/19-nav-groups.spec.ts`.

| Id | Check | Expected | Twin |
|---|---|---|---|
| NAV-01 | Start the server with the fixture; sign in as Tenant Manager, open the sidebar (button in the top bar), look at the apps; collapse «Work», reload the page; switch the language to Italian | Instead of the flat list of apps the sidebar shows the headings «Work» and «Data», each with its apps (icon and name) in the order of the file; an app listed in two groups is in the first one only; apps listed nowhere stay flat at the bottom under «Other apps»; the collapsed state of «Work» is still there after the reload; the heading reads «Lavoro» in Italian; the light and the dark mode both read well | Playwright (the check reads what the server sends, with the fixture; the sidebar is driven by the e2e spec) |
| NAV-02 | Close the sidebar to icons; click the icon of «Work», then close it and leave the pointer resting on the icon, then pass quickly over the icons; use the arrow keys, Enter and Escape; open the sidebar again and move among the entries with the arrow keys; repeat at 400 px wide | The closed sidebar shows one icon and a short name per group, all at the same distance from each other (inside a group, between groups, before Settings); the click opens a menu with the apps and, indented, the pages of an app; the arrow keys move in the menu, Enter opens the page, Escape closes it and the focus goes back to the icon (when it was opened with the keyboard); the pointer on the icon opens the menu at once, it closes shortly after the pointer leaves the icon and the menu, a click on the icon of an open menu keeps it open; while typing in a field of the page with the pointer resting on an icon, the menu opens and the typing goes on in the field; icons with a menu show no tooltip, icons without one do; in the open sidebar Up, Down, Home and End move among the heading and the apps; on the phone the drawer shows the groups open | Playwright (NOT VERIFIABLE in the manual run: covered by the e2e spec) |
| NAV-03 | In the file list a plugin that is not installed, the same plugin in two groups, a group without plugins, two groups with the same id, an icon name the shell does not know; start the server | The server starts; the log has one warning per problem; the unknown plugin is not shown, the plugin stays in the first group, the empty group is hidden, the first of the two same-id groups wins, the group with the unknown icon uses the default folder icon | Playwright (NOT VERIFIABLE: needs a restart with a faulty file; covered by `navgroups::tests`, `dist::tests` and `navgroups.test.ts`) |
| NAV-04 | Start the server without `nav_groups` and sign in | The sidebar lists the apps flat under «Apps», as before; the other layouts (Console, Workspace, Project, tabs, and the ones of a `layout.toml`) show the flat list in every case | Playwright (the check, without the fixture) |
| NAV-05 | Start the server with the fixture; sign in, open the sidebar, select an app with pages; close the sidebar to icons and open the menu of a group; repeat in the dark mode | No separator line between groups or items and no blue line above, below or beside the selected entry (open sidebar and rail); the selected entry has a soft background with the accent colour on icon and label, readable in both modes; in the open sidebar the apps are indented under the group heading and the pages of an app one level deeper; «Overview» and «Settings» keep their short name in the open sidebar (full name as tooltip); the menus show the icon of each entry before its name, also on «Open ...» | Playwright (NOT VERIFIABLE in the manual run: visual, covered by the e2e spec) |
| NAV-06 | Close the sidebar; open Account › Appearance and language and switch off «Names under the icons»; switch it on again; reload with it off | Closed: Settings (Tenant Manager) or System (Administrator) sit at the bottom of the bar, whatever the number of apps; with the switch off the icons stay with no name below them and a little lower, the name shows as a tooltip and is still read by a screen reader, the entries stay at the bottom; the choice is kept in the browser and follows at once; the open sidebar always shows the names | Playwright (NOT VERIFIABLE in the manual run: covered by the e2e spec) |


## Directory search for plugins

A plugin with `permissions.directory` can search the people and groups of the current tenant ([architecture 8.15](architecture.md)): only a Tenant Manager or a person who may share in the plugin, id, username and name only, active members only. Checks that need a plugin with the permission use a signed test package with logic.

| Id | Check | Expected | Twin |
|---|---|---|---|
| DIR-01 | As Administrator list the plugins; as Sara search the directory through Notes (`POST /api/t/<tenant>/p/com.mosaikit.notes/directory/search`); without a session do the same | The official plugins do not declare `directory`; Sara is refused (403 `permission_denied`); without a session 401 | Playwright (`tests/manual/checks/dir.ts`) |
| DIR-02 | With a signed package declaring `directory = true`: search as the Tenant Manager, as a person with the share right, as a person whose profile has no share right, and through a copy of the package without the permission | The first two get rows; the third and the copy get `permission_denied` | Not automated by the browser: kernel tests `a_member_with_the_share_right_and_the_manager_find_people`, `only_who_may_manage_or_share_can_search`, `the_logic_asks_through_the_host` |
| DIR-03 | Search for a name that exists in this tenant, in another tenant, for a disabled person and for a person whose membership is suspended; read the answer | Only the active members of this tenant; a row has `id`, `username`, `name` and nothing else (no email); groups have `id` and `name` | Not automated by the browser: kernel tests `only_the_tenant_of_the_caller_is_searched`, `disabled_and_suspended_people_are_hidden` |
| DIR-04 | Search with an unknown kind, no text, a blank text, 65 characters, a control character, a limit of 0, -3 and "5", then with limits 3 and 1000 and none, over a tenant with more than 50 matches | Invalid ones are refused (400 `invalid_argument`); 3 rows, 50 rows and 20 rows; always the same order | Not automated by the browser: kernel tests `the_arguments_are_checked`, `the_limit_has_a_default_and_a_cap` |
| DIR-05 | Search from a public command of a public link and from a command called with a run ticket | Both refused (`permission_denied`); nothing is returned | Not automated by the browser: kernel tests `it_is_refused_in_a_public_link`, `it_is_refused_in_a_call_on_behalf_of_a_run` |
| DIR-06 | Search 31 times in a minute as one person; read the Log | The 31st is refused (429 `directory_rate_limited`) and another person is not held back; the Log has one `directory.search` event for the person and plugin in that minute, with the kind only: no text, no rows | Not automated by the browser: kernel tests `searches_are_rate_limited`, `the_audit_log_has_one_event_a_minute_and_no_query` |
| DIR-07 | Install the package of DIR-02 as Administrator and open «What it asks» of the plugin; open its brochure | A row «Searches the people and groups» in red as sensitive (Italian: «Cerca tra le persone e i gruppi») and the chip «Searches the people of the tenant» | Not automated by the browser: needs the package of DIR-02; manifest test `directory_permission`, validate test `directory_needs_a_mosaikit_that_knows_it` |

## Contextual top band for a resource on the full page

A plugin that shows a resource on the full page can change the top band of the shell ([architecture 8.16](architecture.md), `msk.band` of the dev kit): no search, the tenant, a View | Edit switch, the people connected, a comments button. No official plugin uses it yet, so these checks use a test page of a plugin that calls `msk.band.set`; the logic of the state and the controls are covered by vitest (`ui/host/src/app/contextband.test.ts`, `ContextBand.test.tsx`, `ui/plugin-api/src/band.test.ts`). Not run in the browser by the author.

| Id | Check | Expected | Twin |
|---|---|---|---|
| BAND-01 | Open a page that calls `msk.band.set({ search: false, mode: { value: 'view', canEdit: true }, presence: [...], comments: { open: false, count: 2 } })`, as a person with more than one tenant, then with a single tenant | The search box is gone; the tenant (with the selector only for more than one tenant) stays at the left; the View \| Edit switch is in the middle; the avatars and the comments button with the badge «2» come before the language, mode, help, bell and person menu, which are unchanged | Playwright (NOT VERIFIABLE: needs a test page of a plugin; the state is covered by `contextband.test.ts` and `ContextBand.test.tsx`) |
| BAND-02 | With `canEdit: true` flip the switch with the mouse and with Space and Enter; make the page answer with `band.set` and the new value; then set `canEdit: false` | `onChange` of the page is called with `edit` and `view`; the switch moves only when the page sets the new value; with `canEdit: false` the switch is replaced by the label «Read only» and an `edit` value is shown as view | Playwright (NOT VERIFIABLE: needs a test page; covered by `ContextBand.test.tsx`, `contextband.test.ts` and `band.test.ts`) |
| BAND-03 | Set 2, 3, 4 and 60 people (one with a name of 200 characters, one with markup in the name); hover and tab over the avatars | Up to three avatars with initials (derived from the name when missing), then «+N» (50 people at most); the name in the tooltip and read by a screen reader, «+N» announced with the names it stands for; the markup is shown as text; below 640 px wide the avatars are hidden and the rest stays | Playwright (NOT VERIFIABLE: needs a test page; covered by `contextband.test.ts` and `ContextBand.test.tsx`) |
| BAND-04 | Press the comments button with the mouse and with the keyboard; make the page set `open: true` and `count: 12`, then `count: 0`, `count: 100000` and `count: 1.5` | `onToggle` of the page is called; the button is pressed (`aria-expanded` true) while `open` is true; the badge shows 12, nothing for 0 and 9999 for 100000; 1.5 is refused and the band is unchanged; the button has no `aria-controls` until a panel with the id `msk-comments-panel` exists | Playwright (NOT VERIFIABLE: needs a test page; covered by `ContextBand.test.tsx` and `contextband.test.ts`) |
| BAND-05 | With the band set: go back to the list of the plugin, open another plugin, open another route of the shell, reload the page; also let a page of the plugin call `msk.band.reset()` | The band is the normal one after each; a second frame (a tab of an extension) cannot reset or set it | Playwright (NOT VERIFIABLE: needs a test page; the owner and reset rules are covered by `contextband.test.ts`) |
| BAND-06 | From the test page send `band.set` with wrong values: `search: "no"`, `mode: "edit"`, `presence: "x"`, `comments: { open: "y" }`; try to pass HTML, a class name, a URL and the names of the language, bell or person controls | Each wrong call fails with «invalid band ...» and the band stays as it was; nothing but plain text is shown; tenant, language, mode, help, bell and person menu cannot be hidden or changed | Playwright (NOT VERIFIABLE: needs a test page; covered by `contextband.test.ts`) |
| BAND-07 | Look at the band in light, dark and the high contrast mode, in a theme with a dark and one with a light band, with a band image; read the controls with the keyboard only and with a screen reader; use 400 px wide | Texts and icons stay readable (at least 4.5:1); the switch is announced as a switch named «Edit mode», avatars by name, the comments button as «Comments» with the number and its state; every control takes the focus in a visible order; at 400 px nothing overflows | Playwright (NOT VERIFIABLE: the contrast of every band colour is computed by `contextband.test.ts`; the rest needs a test page and a screen reader) |
| BAND-08 | Switch the language to Italian and, with the Spanish language plugin on, to Spanish | The texts of the band (View, Edit, Read only, Edit mode, Comments, the people and the tooltips) are translated | Playwright (NOT VERIFIABLE: needs a test page; the keys are checked by `langpack.test.ts`) |
| BAND-09 | From a test page call `msk.band.set({ back: { label: 'Back to the list', onClick } })`; look at the band; press the button with the mouse and with the keyboard; send a label with markup, one of 200 characters and an empty one; open another route | An arrow-left icon button sits on the left right after the tenant, named and with a tooltip «Back to the list» (read as text, never HTML, cut to 80 characters); pressing it calls `onClick` once; an empty or non-text label makes the call fail with `invalid band back label`; the button is gone after the route changes | Playwright (NOT VERIFIABLE: needs a test page; the checks and the event are covered by `contextband.test.ts` and `band.test.ts`) |
