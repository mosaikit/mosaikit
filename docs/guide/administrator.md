# Mosaikit — Guide for the Administrator

The Administrator runs the platform: tenants, the people of the installation, plugins, system settings,
backups, maintenance and monitoring. Administrators are accounts of the platform, separate from the people
of the tenants: they do not work inside a tenant, and never see the contents of the items. What the Tenant
Manager does is in [tenant-manager.md](tenant-manager.md); the work of everybody in [user.md](user.md).

## First start and signing in

At the first start Mosaikit creates the Administrator `admin`. Its password is the one given to the server
(`MOSAIKIT_ADMIN_PASSWORD`) or, if none was given, a generated one written in the file
`credenziali-iniziali.txt` of the data folder (the desktop version may also create a first work tenant and
its Tenant Manager `user`, listed in the same file; installs made before this change keep their account
`utente`). Change the password at the first sign-in and delete the file.

To sign in: on the sign-in page **Administrator access** (or the address of Mosaikit followed by `#/admin`).

1. **Username** and **Password**.
2. **Second step**: the code of your authenticator app. The first time, **Register the app**: scan the QR
   code with Google or Microsoft Authenticator, FreeOTP or similar (or type the key by hand), enter the
   **Code shown by the app** → **Turn on and sign in**.
3. **Recovery codes**: ten codes, each works once if you lose the phone. **Copy the codes**, keep them
   safe → **I saved the codes: continue**. They are not shown again.

Administrators always sign in with their local password and the second factor, whatever the tenants use.

**Administrators** are managed in **System › Administrators**: **New Administrator** (they register the
second factor at their first sign-in), **Reset the password**, **Reset the second factor** (they register the
app again), **Disable** / **Reactivate**. **Edit name and email** is in the menu of every row, yours too:
any Administrator may change their own data and those of the other Administrators. At least one
Administrator always stays active.

While you work, the band shows **Platform**: you are on the platform, not inside a tenant.

## Your sidebar

**Platform overview**, **Tenants**, **People**, **Plugins**, **Monitoring**, **Log**, and **System** at the
bottom. The overview has the figures of the platform, **Services** (their state) and **To do** (alerts, a
failed backup, trials ending within a week, plugin updates), with links.

Search (`Ctrl K`) finds tenants and people besides the pages.

## Tenants

### Creating a tenant

**Tenants › New tenant** opens a dialog in four steps:

1. **Tenant**: **Name** and **Identifier** (lowercase letters, digits and hyphens: it goes in the address and
   does not change); optional **Trial period** with its **End of the trial**.
2. **Sign-in**: **Local accounts** or **Identity provider (OIDC)** (issuer, client id, client secret; roles,
   groups and the check are then on the **Sign-in** tab of the tenant).
3. **Tenant Manager**: the first Tenant Manager, a local account with an **Email** (required) and an **Initial password**; they invite the
   others and choose the settings of the tenant.
4. **Summary**: what the platform prepares by itself (the *Standard* permission profile, the plugins
   available by default, the settings of the platform, its place in backups and Monitoring) → **Create the
   tenant**.

### The page of a tenant

Tabs **Details**, **People**, **Sign-in**, **Plugins**, **Quotas**; the status badge (active, on trial,
suspended, archived) next to the name; **⋯** with **Suspend the tenant** / **Reactivate the tenant**.

- **Details**: **Name** and **Identifier** (both editable: the identifier is what people choose at sign-in and
  it appears in addresses, so changing it changes those), the contact and registration data, the **Trial period** (**Update the trial**,
  **Remove the trial**), the **Logo of the tenant** (read only: its Tenant Manager chooses it), **Export**
  and the area **Archive or delete**.
- **People**: users and roles, never the contents — to appoint or replace a Tenant Manager (**New
  Tenant Manager**, change a **Role**) and to unlock a sign-in (**Reset the password**).
- **Sign-in**: see *Sign-in of a tenant* below.
- **Plugins**: which plugins are available and on in the tenant (read only; availability is decided on the
  page of each plugin, and the link **Go to the Plugins page** is next to the sentence that says so). Every
  row has a pill: *active*, or why it is not (*not available*, *turned off*, *off in the platform*…).
- **Quotas**: the quotas of the tenant (**Customize**, **Restore**). **Items** are everything the people
  create in the apps (notes, tasks, files, maps, sites): one note or one file is one item.

### Trial, suspend, archive, delete

| Action | What happens |
|---|---|
| **Trial period** | A week and a day before the end the Tenant Managers and the Administrators are told; at the end the tenant is suspended; the data stay. |
| **Suspend the tenant** | Its people can no longer sign in; nothing is deleted. **Reactivate the tenant** brings it back. |
| **Archive the tenant** | Nobody signs in, nothing is deleted; **Reactivate** brings it back. The confirmation lists what it holds. |
| **Delete the tenant** | Everything goes, for good: the people whose home is the tenant, guests lose access, items and contents, groups, settings and log. Items its people own in other tenants pass to the Tenant Managers there. Type the identifier to confirm. Export it first if you may need it. The tenant *System* cannot be deleted. |

### Export and import

- **Export the tenant** (Details): a zip with the data of the tenant, the rows of its plugins and its
  contents.
- **Tenants › ⋯ › Import a tenant** with that zip: the tenant comes back with its people, items and contents.
  If the tenant exists, Mosaikit asks before replacing it (everything it holds now is deleted). People of
  other tenants that no longer exist are left out.
- An export comes back only on the same kind of database (PostgreSQL or SQLite), and its encrypted secrets
  only with the same secret key of the server.

## Languages

English and Italian are built in. A **language plugin** (Plugins › kind **Language**, for example
*Spanish*) adds a language: once installed and on, it is offered in every language menu (sign-in page,
person menu) next to the built-in ones, for the whole platform (unless **Languages offered** in
Settings leaves a built-in language out: then only the languages listed are offered); turn the plugin off
or uninstall it to withdraw the language (the people who chose it go back to English). It brings the texts of the shell and
the names and labels of other plugins; the texts inside the screens of a plugin stay those of that plugin.
Plugin authors: see the README of `mosaikit-plugins` (folder `lang/`).

## Sign-in of a tenant

Tenant page › **Sign-in**. One method per tenant, never both:

- **Local accounts**: username and password kept by Mosaikit; the Tenant Manager creates the people.
- **Identity provider (OIDC)**: the password is asked by the provider of the tenant; people are created at
  their first sign-in.

For the identity provider:

1. Register Mosaikit in the provider as a confidential client with the addresses shown: **Return address
   (redirect URI)**, **Back-channel logout address**, **Front-channel logout address**, **Address after the
   sign-out** (each with a copy button).
2. Fill **Address of the provider (issuer)**, **Client id**, **Client secret** (stored encrypted, then only its
   last characters show), **Scopes**, **Text of the button** (the sign-in page shows «Sign in with …»).
3. **Check the configuration**: one line per check (discovery document, PKCE, signing keys, sign-out,
   back-channel and front-channel logout), green, warning or red with the reason.
4. **Where roles come from**:
   - **Managed in Mosaikit**: the provider only says who the person is; the Tenant Manager gives roles.
   - **Groups of the identity provider**: the role is read from the groups of the token at every sign-in
     (**Groups of the Tenant Managers**, **Groups of the Users**; empty: everybody the provider lets in is a
     User). A person in no allowed group is refused.
5. **Groups of the provider in Mosaikit** (optional, with **Only the groups starting with**): the groups of
   the token become read-only groups of the tenant, to share items with. A group the provider no longer
   sends empties, it is never deleted.
6. **Claims of the token**: which claims give username, full name, email and groups. A person is recognized
   by the issuer and the subject of the token, never by the email.
7. **Save**. With the identity provider the local accounts of the tenant can no longer sign in (Mosaikit asks
   for confirmation); guests of other tenants keep signing in from their tenant.

When the provider signs a person out (back-channel or front-channel logout), their Mosaikit sessions close.

Tip: with **Managed in Mosaikit**, after the first sign-in of the future Tenant Manager through the provider,
give them the role in **People**: the first local Tenant Manager cannot sign in any more.

## People of the installation

**People** lists every person (Administrators too), with pills **All**, **In several tenants**,
**Administrators**, filters by tenant, role and status, search.

- **New person**: a local account with its **Home tenant**, role and profile; **Initial password
  (optional)** — empty: you get a link the person uses to choose it.
- Select people for **Disable**, **Reactivate**, **Add to a tenant**, **Send the password link** (one link per
  person, **Copy all**).
- The page of a person: **Profile**, **Tenants** (role and profile in each tenant, suspend or remove — not the
  home —, **Add to a tenant**, **Move the home tenant**), **Sign-in** (password link, sessions), **Activity**
  (their events in every tenant).
- **Disable the account** / **Reactivate the account**: a disabled account cannot sign in anywhere.
- People change their own name and picture in Account › Profile; their email is changed here.

In tenants with an identity provider the password actions are not offered: the provider manages passwords.

## Plugins

**Plugins** has **Installed**, **Updates** and **Catalog**, a filter by kind (**Apps**, **Services**,
**Extensions**) and **Install from file** (a signed `.mskp` package).

- Select plugins for **Update**, **Turn off** (in every tenant) or **Uninstall** (their items are removed from
  every tenant; the confirmation says how many items, tenants and extensions are touched).
- **Updates** lists newer versions with their release notes; **Catalog** what the trusted registries offer.
- The page of a plugin, tabs:
  - **Overview**: the plugin as a brochure: a gallery of pictures, its description, the **Author**, the
    **Licence** and a link for more information, then the technical details (version, signature, status)
    and what the update brings. A plugin declares author, licence, link, a longer text and its pictures in
    its manifest; what it does not declare shows as *not declared*.
  - **What it asks**: logic on the server, hooks, files, network, other plugins, database, and the
    **Permissions it brings** (besides use, create, delete and share).
  - **Tenants**: **Available to every tenant** (the default for new tenants and the ones without a choice of
    their own), and one row per tenant with **Available** and whether the tenant turned it on; **Restore**
    goes back to the default.
  - **Configuration**: the settings the plugin declares, for the whole platform; secrets are encrypted and
    never shown again.
  - **Extensions**: the extensions that add fields, actions or tabs to it.
- **Available** is your decision; turning it **On** is the Tenant Manager's. Tenant Managers are notified
  when availability changes. An extension works in a tenant only where its plugin is on.

## System

**System** groups the settings of the platform, for every tenant. Settings that tenants may customize have a
switch **Tenants may customize it**: turned off, tenants see the value with a padlock. Rules with a limit
(passwords, sessions) are minimums: tenants may only make them stricter. **Save** appears only after a
change.

| Section | What it holds |
|---|---|
| **Administrators** | Accounts of the platform (see *First start*). |
| **Email** | **Mail server** (**SMTP server**, **Port**, **Security**, **User**, **Password** stored encrypted), **Sender** and **Footer** with a preview, **Send a test**. Mosaikit sends no email by itself: it needs an SMTP server (the one of your organization or a mail service). Without a server nothing is sent. To try it locally the Docker setup has an optional Mailpit container that catches every message (SMTP `localhost:1025`, security **None**, no user). |
| **Notifications** | The defaults of the emails (**Never**, **At once**, **One summary a day**) and the hour of the daily summary. |
| **Retention** | How long the trash (default 30 days), the log (default 365 days) and the notifications (default 90 days) keep their content. |
| **Passwords and sessions** | Minimum length of the password (never below 10), attempts before the lock, length of the lock, length of the session, «Remember me» in days (0: the option does not show). |
| **Quotas** | **Quotas of new tenants** (storage, people, items; empty: no limit), **Capacity of the platform** with what is given to and used by the tenants (a warning when more is given than the platform has), the tenants with their quotas. A tenant's own quotas are on its page (Details › Quotas: **Customize**, **Restore**). |
| **Keys of outside services** | Keys the platform pays for, for the services the installed plugins declare (each says which plugins use it; no plugin, no service: the plugins decide which keys exist, and none can be added by hand). A shared key is used by every tenant without one of its own. Only the last four characters show after saving. A key of a service no installed plugin uses any more is marked as not used: remove it. |
| **Embedding** | Sites that may show the public pages (public links) inside their own pages. Without sites, nobody may. |
| **Backup and restore** | See *Backups* below. |
| **Maintenance** | See *Maintenance* below. |
| **Identity and appearance** | **Identity and texts**, **Theme and mode**, **Languages and formats**, **Top bar** (below). |

### Identity and appearance

- **Identity and texts**: **Name** (top bar, sign-in page, title of the browser), **Welcome text**, **Footer**,
  **Privacy notice**, **Legal notes**, **Guide** (an address opened by Help › Guide of Mosaikit instead of the
  guides built into the shell, in the language of the person), logos for
  light and dark backgrounds and **Browser icon** (SVG, PNG or WebP, at most 512 KB). Tenants inherit the texts.
- **Theme and mode**: **Default theme** (for the platform, the sign-in page and the tenants that do not
  choose one), **New theme** (the theme editor: main colour, top band, greys, contrast checks, **Fix it for
  me**; **Save the theme** stays off while something does not read), **Themes tenants may use**, **Tenants
  may choose their theme**, the default mode.
- **Layout**: where navigation, band, tenant switcher and actions sit, for everybody (there is no personal
  choice). Built in: **Teams** (rail of icons, the default) and **Console**; more from layout plugins
  (Workspace, Suite, Project, Tabs, in **Plugins** › Layouts). **Layouts the tenants may choose** limits what
  Tenant Managers are offered (none ticked: all; the layout of the platform is always allowed). Every layout
  keeps the landmarks, the «Skip to the content» link and the keyboard order. A layout plugin that is turned
  off or removed: the platform goes back to Teams.
- **Style**: **Corners**, **Density**, **Font**, **Tabs**, **Main buttons** and **Band image**, with every
  layout and theme; no value means the default of the layout. The page previews the change before **Save**.
  The band image is a PNG of at most 512 KB; the band colour darkens it as much as needed so the texts read
  at 4.5:1, and an image too bright even then is refused. Tenants may customize the style too.
- **Languages and formats**: **Languages offered** (with one language only, the language menu disappears),
  **Default language**, **Format of dates and numbers**.
- **Top bar**, the same for every tenant, with a preview: **Logo and name of the application**, **Search**,
  **Language**, **Help**, **Mode (light, dark, automatic)**. Turned off: the sidebar button takes the place of
  the logo; search and `Ctrl K` disappear; the language is chosen in Account; tour, guide and what is new move
  to the person menu; the default mode applies. Bell, person menu and tenant switcher always stay.

### Backups

**System › Backup and restore**.

- **Backups**: the database, the contents, the plugins and every tenant, in a zip in the data folder, with a
  `README.txt`. The key of the secrets is not inside: keep it apart. **Run now**; each backup shows when it
  started, its **Result** (**complete**, **tenants only** with the reason, **failed**), size and tenants;
  **Download**, **Delete the backup**.
- **Schedule**: **Scheduled backups** once a day at the **Hour (UTC)**, **Backups kept** (the older ones are
  deleted).
- **Restore a tenant**: from a backup, a tenant comes back as it was then (asks before replacing one that
  exists).
- **Restore an item**: choose the tenant, search by **Title**, **App** or **Owner**; the **State** says whether
  the item is still in the tenant. It comes back with what is in it and its files; tick **Also its shares
  with the people and groups that still exist** if you want them; public links never come back. If the item
  still exists, choose **As a copy** (a new item next to the current one) or **In place of the current one**
  (the current version is deleted for good). The owner gets a notification.
- **Restoring everything** is done with the server stopped: the `README.txt` inside each backup explains how.
- A backup is *tenants only* when no usable `pg_dump` matches the database version (PostgreSQL); the Docker
  image includes the client tools. A failed backup notifies every Administrator.

### Maintenance

**System › Maintenance**.

- **Maintenance mode** on: everybody sees the **Notice for everybody**, only the Administrators sign in and
  work, public links are closed. A yellow band reminds you that it is on.
- **Planned maintenance**: a **Start** and a **Notice in advance**, shown to everybody beforehand; at the time
  the maintenance mode turns on by itself. **Cancel the planned maintenance** removes it.

## Monitoring

**Monitoring**, sections:

The figures are real measures of the server: collected every minute and kept for 8 days. The page says
when it was last updated and refreshes by itself every minute.

| Section | What |
|---|---|
| **Status** | Each service (database, storage of the contents, emails, background work, plugin runtime, backups, the identity providers of OIDC tenants) with its state, version and response. |
| **Performance** | Requests and errors, response time (p50, p95, p99), sessions and emails waiting over **1 hour**, **12 hours**, **7 days**; **Show as a table**. |
| **Errors** | Server errors and error rate; the latest refused operations with **See in the log**. |
| **Tenants** | Requests, people, items, space and the **Nearest quota** of each tenant. |
| **Capacity** | Disk of the data, memory of the server, database, contents, memory of Mosaikit. |
| **Alerts** | **Alerts now** and the **Conditions**: free disk under a percentage, server errors over a percentage, emails failed in an hour, a backup failed, a service does not answer; **Who receives them** (nobody chosen: every Administrator). A crossing is notified once, until the condition clears. |

## Log

**Log**: the events of every tenant, with the column **Tenant** and its filter, the same filters, side pane
and CSV export as the log of the Tenant Manager. The **Activity** of a person shows them everywhere.
