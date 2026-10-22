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

---

Phases 3 to 9 add their sections here when they are committed.
