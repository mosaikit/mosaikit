# Mosaikit — Manual tests

Manual checks of what each phase of [ui-plan.md](ui-plan.md) delivers, to run by hand in the development
environment at the end of a phase. The automated tests (Rust, vitest, Playwright e2e) cover the same flows;
these checks are for a person looking at the product: what it looks like, how it reads, whether it does
what the mockup ([docs/mockup](mockup/README.md)) promises.

The document grows with the plan: every phase adds its section when it is committed.

## Setup

1. From the `mosaikit` folder: `cargo xtask dev` (development PostgreSQL, plugins, server, Vite). Wait for
   the line `app: http://127.0.0.1:5173`.
2. Open **http://127.0.0.1:5173** in Edge or Chrome. A private window starts from a clean browser
   (no remembered language, theme or tenant).
3. After a change in `crates/**` the server is rebuilt and restarted: for a few seconds the page says
   that the server is not responding and retries by itself.

### Accounts of the development environment

| Who | Sign-in | Password | Role |
|---|---|---|---|
| Administrator | `#/admin`, user `admin` | `admin-sviluppo` | platform administrator (second factor at the first sign-in) |
| Elena Ricci | tenant *Comune di Roma*, `e.ricci` | `password-prova-1` | Tenant Manager |
| Marco Esposito | *Comune di Roma*, `m.esposito` | `password-prova-1` | Tenant Manager |
| Sara Greco | *Comune di Roma*, `s.greco` | `password-prova-1` | User |
| Luca Bianchi | *Comune di Roma*, `l.bianchi` | `password-prova-1` | User |
| Davide Conti | *Comune di Roma*, `d.conti` | `password-prova-1` | User, guest in *Regione Lazio* |
| Luca Verdi | *Regione Lazio*, `l.verdi` | `password-prova-1` | Tenant Manager |

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
| P0-05 | Person menu | Account, Notifications, Sign out (Trash is not there yet) |
| P0-06 | Open an app (e.g. Notes) from the sidebar | The app opens inside the shell; create an item |
| P0-07 | On that item: **Share** | Share dialog: people and groups with a level, public link, transfer of ownership |
| P0-08 | Create a public link, open it in a private window | The item read-only, without signing in |
| P0-09 | Help menu (?) | Guided tour of this page, Guide, What is new, Keyboard shortcuts, version; the items say they come later |
| P0-10 | Sign out, sign in as `e.ricci` | Sidebar with Tenant overview, the apps, Tenant management (Manage, Plugins, Shares, Usage) and Tenant settings at the bottom |
| P0-11 | Manage › People: tick a person | The action bar appears only with a selection |
| P0-12 | Manage › People › a person › Remove from the tenant | Asks who gets the items of the person (new owner), then removes |
| P0-13 | Shares | All the shared items of the tenant, filter by owner, app and title; Public filter; Revoke a public link |
| P0-14 | Usage | Figures of the tenant and the KPIs of the plugins |
| P0-15 | Sign in at `#/admin` as `admin` (second factor) | Platform overview with the KPIs; a stable "Platform" badge in the band |
| P0-16 | Sidebar of the Administrator | Platform overview, Tenants, Plugins, System |
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
| P1-07 | Passwords and sessions: minimum length 12 | As `s.greco`, Account › Sign-in and security › Change password: the hint says 12, a 10-character password is refused |
| P1-08 | Tenants may customize it: turn off for the theme | As `e.ricci`, Tenant settings: the theme row is locked ("Managed by the Administrator") |
| P1-09 | Put the minimum back to 10 | — |
| P1-10 | As `e.ricci`: Tenant settings › Identity and appearance › Theme: choose Tessera (with the switch of P1-08 on again) | Marked **Customized**, the whole tenant in Tessera; **Restore** goes back to the platform theme (**Inherited**) |
| P1-11 | As `e.ricci`: Passwords and sessions | Values with "Platform minimum: N"; a value below the platform minimum is refused, a stricter one is accepted |
| P1-12 | As `e.ricci`: Managed by the platform | Sign-in method and the other platform rules shown read-only with a padlock |
| P1-13 | As `e.ricci`: Identity and texts: tenant name and logo | They show in the band (tenant switcher) and on `#/login/comune-roma` |
| P1-14 | As Administrator: Keys of outside services: add a key, mark it shared with tenants | After saving only the last four characters show; Replace and Remove work |
| P1-15 | As `s.greco`: Account › Keys: add a personal key | Saved and masked; the Administrator has no Keys section in Account |
| P1-16 | As Administrator: Embedding: add a site | Accepted; as `e.ricci` the tenant can choose only among the platform's sites |

## Step 1b — Plugins in English and Italian

| Id | Check | Expected |
|---|---|---|
| P1b-01 | As `s.greco`, English | Sidebar and pages of the apps in English (Notes, Tasks, Contacts, Files, Maps, Static sites) |
| P1b-02 | Switch to Italiano | Names in the sidebar ("Note", "Attività"…), fields and choice values ("personale", "lavoro") in Italian, without signing in again |
| P1b-03 | Notes: create a note with a tag, switch language | The same note, the tag shown in the language of the moment |

## Phase 2 — Notifications

| Id | Check | Expected |
|---|---|---|
| P2-01 | As `l.verdi` (*Regione Lazio*): invite `s.greco` of *Comune di Roma* (Manage › Invite a person of another tenant) | — |
| P2-02 | In another window signed in as `s.greco` (no reload) | The bell gets a badge by itself |
| P2-03 | Open the bell panel | The invitation with Accept and Decline, "Mark all as read", a gear, "See all" |
| P2-04 | Accept | `s.greco` can switch to *Regione Lazio* from the tenant switcher; `l.verdi` gets a notification of the answer |
| P2-05 | Share an item with another person | That person gets a notification with a link that opens the item |
| P2-06 | Create a public link on your item while someone else owns it, or vice versa | The owner is notified |
| P2-07 | See all | The Notifications page: filters (Unread, kind, period, search), selection with mark read / delete |
| P2-08 | Mark all as read | The badge disappears |
| P2-09 | Gear (or Account › Notifications) | For each kind: in-app, email off / immediately / daily digest; saved after reload |
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
| P3-09 | As `s.greco`, open Notes and try to create a note | Refused: «your permission profile does not allow «Create items» in Notes» (inside the apps the messages of the server are in English for now) |
| P3-10 | As `e.ricci`, Plugins › Notes › Access and permissions › Add a group or person › Sara Greco, tick Create items, Save | As `s.greco` creating a note works again; her Permissions tab shows Create items from «Personal» |
| P3-11 | People: tick two people, «Change profile», «Add to a group», «Suspend» | The action bar appears only with a selection; each action applies to all of them |
| P3-12 | A suspended person (e.g. `l.bianchi`) signs in | The tenant is not offered to them any more; reactivate from their page («⋯» › Reactivate in the tenant) |
| P3-13 | Groups: click a group | Group page: Members (add, remove), Shared items, Plugins (what the group adds) |
| P3-14 | As `e.ricci`, create a note in Notes and copy its address; take the identifier after the last `/` | — |
| P3-15 | As `s.greco` open `#/t/comune-roma/item/<identifier>` | «You cannot see this item» with Access (See, Edit) and a message; Send the request; «Request sent» |
| P3-16 | As `e.ricci`: the bell | «Sara Greco asks to see «…»»; Manage › Pending lists it under Access requests with Approve, Refuse, Forward to the owner |
| P3-17 | Approve | `s.greco` gets «… gave you access to …»; the same address now opens the note in Notes |
| P3-18 | Sara's page › Permissions › «Why can't they see an item?» with an identifier | The steps (account, membership, use of the app, owner, shared) with ✓ or — |
| P3-19 | Sara's page › Sign-in | Send the password link: a dialog with the link to copy (valid until …); her open sessions, Close and Close every session |
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
| P4-05 | What it asks | Logic on the server, hooks, files, network, other plugins, database; the permissions it brings |
| P4-06 | Extensions tab | *Note review* (installed); a link opens its page, whose What it asks lists the field «Reviewed» and the action «Mark as reviewed» |
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
| P4-20 | Uninstall *Note review* (⋯ › Uninstall) | The confirmation says how many items and tenants are touched; the extension disappears, Notes keeps working; reinstall it from Catalog |
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
| P5-14 | In the Files app: delete a folder with files, then Trash | One row for the folder (its size counts the files); Restore brings back the folder and its files |
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
| P6-11 | As Administrator: Storage quota 0.001 GB (about 1 MB) for Comune di Roma | As `s.greco`: upload a file of a few MB in Files → refused; a smaller file replaces a bigger one without problems |
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
| P7-02 | Step 1: Name *Test Town* | The identifier fills in by itself (`test-town`); Trial period on with a date 10 days ahead |
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
| P9-05 | Ctrl K again, with the field empty | «Recent searches» lists `north well`; choosing it searches again |
| P9-06 | As `s.greco` (same tenant): search `north well` | «No results»: the note of Elena is not shared with Sara |
| P9-07 | As `e.ricci`: share the note with Sara (read); as `s.greco` search again | Now found |
| P9-08 | As `e.ricci`: delete the note, search it | Not found (it is in the trash); restore it from the Trash: found again |
| P9-09 | As Administrator: search `roma` | Pills Tenant and People: *Comune di Roma* and its people; a result opens the tenant or the person |
| P9-10 | As Administrator: System › Identity and appearance › Top bar: search off | No search box, `/` and Ctrl K do nothing; put it back on |
| P9-11 | As `s.greco`, on the Home: the help button (?) | A small dot: a guided tour of this page is waiting |
| P9-12 | Help › Guided tour of this page | The page darkens around the sidebar, a card «Step 1 of 5»; Next, Back, Skip the tour; arrows and Esc work |
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

---

Every phase of the plan has its section. New work adds its checks here when it is committed.
