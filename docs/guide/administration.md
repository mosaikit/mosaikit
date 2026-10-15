# Administration

Platform administrators (role `platform-admin`, the `admin` account created at the first start)
manage organizations and extensions. Today this is done through the REST API; the examples use
`curl`, which asks for the password of `admin`. The whole API is described at `/q/openapi`.

## Roles

| Role | Who | Can |
|---|---|---|
| `platform-admin` | the administrators of the installation | manage organizations, their identity settings and the extensions |
| `organization-admin` | the managers of an organization | manage their organization (in its realm) |
| `organization-user` | the people of an organization | use the apps of the installation |
| `organization-guest` | people of another organization, added to a team | see the teams where they were added and what is shared with them, nothing else of the organization |
| `service` | service identities (MK-124), not people | call the APIs of extensions and the endpoints of the kernel they were given, nothing else |

## Organizations

An organization is identified by a *slug* (lowercase letters, digits and inner hyphens, 2 to 63
characters), which is also its sub-domain when `mosaikit.identity.domain` is set.

```bash
# People sign in with a Mosaikit password; self-registration allowed
curl -u admin -X POST https://mosaikit.example.org/api/v1/organizations \
  -H 'Content-Type: application/json' \
  -d '{"slug": "acme", "name": "Acme", "selfRegistration": true}'

curl -u admin https://mosaikit.example.org/api/v1/organizations        # list
curl -u admin https://mosaikit.example.org/api/v1/organizations/acme   # one
```

In the console, **Organizations** lists them for platform administrators.

### Deleting an organization

A platform administrator deletes an organization in **Organizations**, with **Delete** and then its
slug written again to confirm, or through the API, where `confirmation` names it too (MK-130):

```bash
curl -u admin -X DELETE 'https://mosaikit.example.org/api/v1/organizations/acme?confirmation=acme'
# {"id": "...", "slug": "acme", "name": "Acme", "deletedAt": "...", "removableFrom": "...", "members": 12}
```

What happens, in order:

- **At once**, the organization appears nowhere: not in the lists of the platform, not among the
  organizations of its people, not on the sign-in page, not in the
  [published views](#published-views-for-external-services). Nobody signs in to it any more, with a
  password, a personal access key, a service identity or its realm: the sessions of its people that
  act on it end at once, as when a person is removed from it, and their access keys in it are
  revoked. The links to its content made before, signed links to files and sharing links, answer
  not found, as an unknown link, even if they have not expired. A person who belongs to other
  organizations keeps them. Its email domains are released,
  so another organization may take them; its slug stays taken until it is removed. When several
  kernels serve the installation, the others refuse its sessions within
  `mosaikit.accounts.session-cache` (5 seconds) and forget it within `mosaikit.identity.cache-ttl`
  (30 seconds).
- **At once, too**, the kernel tells the extensions that subscribe to the event `organization.deleted`
  (see [events on the server](../development/extensions/events.md#events-on-the-server)), so that
  they release what they keep outside the installation for it, such as a workspace on a map server or
  scheduled work.
- **Its data stay** — the data of the kernel (members, teams, apps, resources, permissions,
  credentials, quotas), those of its extensions in the database and its files — for the retention of
  the installation, `mosaikit.organizations.removal-retention` (30 days unless set, one day at least),
  so that a mistake can be undone from the database and audits can still be answered.
- **Then a job of the kernel removes them**, every hour, only for organizations deleted whose
  `removableFrom` is past: the rows of the organization in the tables of the kernel and of every
  extension, also of extensions no longer installed, and its events. The content of its files is
  queued, as when a file is deleted, and leaves the store at the next
  [clean-up](#removing-the-content-of-files-whose-record-is-gone).

The audit log records the deletion (`organization.deleted`, with `removableFrom`, the number of
people who lost access and the email domains released) and the removal (`organization.removed`,
channel `JOB`, with the rows removed from the tables of extensions and the files queued); its entries
of the organization stay, under their own retention, and stay readable by the identifier of the
organization (`GET /api/v1/audit-events?organization=<id>`). The realm of an organization
that signs in through Keycloak is not deleted: delete it in the administration console of Keycloak
when it is no longer needed.

There is no undo in the console or the API yet: until the organization is removed, its data are in
the database, and an operator of the database restores it by clearing `deleted_at`, `deleted_by`
and `removable_from` of its row in `organization` (its email domains are to be set again).

## Sign-in through Keycloak

An organization can sign in through its own Keycloak realm: its people are recognised by the
domain of their email address and sent to the realm (single sign-on, the policies of the realm,
and later SPID and CIE).

With a Keycloak service account configured ([configuration](configuration.md#identity)), the
kernel creates the realm together with the organization:

```bash
curl -u admin -X POST https://mosaikit.example.org/api/v1/organizations \
  -H 'Content-Type: application/json' \
  -d '{"slug": "acme", "name": "Acme",
       "federation": {"emailDomains": ["acme.com"],
                      "administrator": {"email": "ada@acme.com", "firstName": "Ada", "lastName": "Lovelace"}}}'
```

The answer contains `initialAdministrator` with the temporary password of the first manager,
shown only once: give it to that person, who changes it at the first sign-in. If Keycloak is
unreachable (`503`) or already has a realm with that name (`409`), the organization is not
created.

Without a service account, create the realm by hand from the template and tell Mosaikit about it
(see [distribution/keycloak](../../distribution/keycloak/README.md)):

```bash
curl -u admin -X PUT https://mosaikit.example.org/api/v1/organizations/acme/identity \
  -H 'Content-Type: application/json' \
  -d '{"realm": "acme", "emailDomains": ["acme.com"]}'
```

An email domain belongs to one organization only. Changes of identity settings take effect within
`mosaikit.identity.cache-ttl` (30 seconds by default).

## Members

A person has one account, identified by the email address, and can belong to several
organizations, with roles in each (MK-017). People who register or sign in through the realm of an
organization become members of it by themselves; to add a person to another organization, or to
change their roles (platform administrators; the administrators of the organization, signed in to
it, list the members and give profile and teams to those who already are: see
[Permissions](#permissions-of-an-organization)):

```bash
curl -u admin https://mosaikit.example.org/api/v1/organizations/globex/members          # list
curl -u admin -X PUT https://mosaikit.example.org/api/v1/organizations/globex/members/ada@acme.com \
  -H 'Content-Type: application/json' -d '{"roles": ["organization-user"]}'
curl -u admin -X DELETE https://mosaikit.example.org/api/v1/organizations/globex/members/ada@acme.com
```

A person without an account gets one without password: they sign in through the realm of the
organization, which links the account at the first sign-in (if the realm verified the address).
A realm can link an existing account only when that account is a member of its organization.

Removing a person from an organization ends at once their sessions in it (MK-125): a browser left
open, a copy of its cookie or a gateway that checks the session with the kernel are refused at the
next request. Their personal access keys for that organization are revoked too (MK-060).

## Personal access keys

People create personal access keys in their settings for scripts and other clients (MK-060). A key
acts for its person in one organization, with the roles and permissions the person has there at
the time of each call; it never carries the roles of the platform, so platform administration
needs a password. A key without the write switch only reads. Keys cannot sign in to the shell,
open sessions or manage keys.

- How long a key may last is set by `mosaikit.accounts.access-key-max-validity` (365 days by
  default); people choose a shorter expiry.
- The kernel keeps only a digest of each key; nobody, administrators included, can read a key
  again after its creation.
- A revoked key is refused at once on the kernel that revoked it, and on the other kernels of the
  installation within `mosaikit.accounts.session-cache` (5 seconds by default).
- Suspending a person revokes all their keys; removing them from an organization revokes their keys
  for it. Reactivated or added again, the person creates new keys.
- The audit log records, through the channel `API_KEY`, every request refused because of its key
  (`account.access-key.refused`, with the reason: `revoked`, `expired`, `suspended`,
  `not-a-member`, `read-only`, `not-with-a-key`) and the first use of a key in each hour
  (`account.access-key.used`, with the method and the path), not every request: a script that
  polls does not fill the log. `account.access-key.created` and `account.access-key.revoked`
  record the creations and the revocations, with the reason (`person`, `suspended`, `removed`).
  Whatever else is recorded during a request made with a key, such as a change of the apps of an
  organization, also has the channel `API_KEY`. The subject of the events of keys is the prefix that
  people see in their list.
- A key without the write switch cannot use the MCP server (`/mcp`): every MCP call is a `POST`.
- A service that receives keys from its callers, such as a gateway, checks one with `GET
  /api/v1/access-keys/current`, called with that key, or, with a service identity, with `POST
  /api/v1/services/check` (see below and the [API](../development/api.md)).

## Service identities

Some callers of the APIs of extensions are not people: a gateway in front of a map server that asks
whether a request may pass, or a map server whose key filter asks an extension which person a key
belongs to. Give each one a service identity (MK-124) rather than an account of a fake person: as a
platform administrator, open **Service identities** in the administration of the shell, or call
`POST /api/v1/platform/service-identities`.

- Name the identity after the service (`gateway`, `map-server`), describe it, and give it the APIs
  of extensions it calls: the names in `/api/v1/ext/<api>/`, such as `catalog`. Give it the endpoint
  `check-session` or `check-key` when it checks the sessions or the access keys of people (below).
- The secret of its key, which starts with `mks_`, is shown once: put it in the configuration of the
  service, which sends it as `Authorization: Bearer mks_...`. The kernel keeps only a digest.
- The identity has no organization and no password: it never opens the shell, and every other API
  answers 403. An extension sees a caller with the role `service` and the name
  `service:<name>`; a call acts on an organization only when the service names one with the
  `X-Mosaikit-Organization` header among those the identity was allowed.
- To rotate a key, create a new one (**New key**), put it in the service, then revoke the old one:
  an identity has at most two live keys. A revoked key is refused at once on the kernel that revoked
  it, and on the other kernels of the installation within `mosaikit.accounts.session-cache`; so
  are the APIs taken away from an identity.
- The audit log records, through the channel `SERVICE`, every refused call (`service.refused`, with
  the reason: `revoked`, `not-granted`, `organization`) and the first call of each identity to each
  API in an hour on each kernel (`service.used`, with the method and the path), with the actor
  `service:<name>` and the prefix of the key as subject. `service.identity.created`,
  `service.identity.changed`, `service.key.created` and `service.key.revoked` record what platform
  administrators did.

### Checking people at a gateway

A gateway in front of another server lets a request pass when the person who sent it is signed in.
Give its identity `check-session` and `check-key`; for each request it calls `POST
/api/v1/services/check` with the value of the `mosaikit-session` cookie it received (and the
organization the shell named, from `X-Mosaikit-Organization`), or with the personal access key of
the `Authorization` header. The kernel answers the person, the organization and the roles, or 401
when the session ended or the key was revoked, with the same rules as when the person calls the
kernel. Cache the answer for a few seconds at most, so that an ended session closes the gateway too.

## Suspending a person

A platform administrator suspends an account, for example when a person leaves or a device is
lost, and reinstates it later (MK-125). In the console, **Accounts** finds an account by its email
address and shows whether it is suspended, since when, by whom and why; **Suspend** asks for the
reason, and the list of suspended accounts has a **Reinstate** button for each. The same through
the API:

```bash
curl -u admin -X PUT -H 'Content-Type: application/json' -d '{"reason": "Laptop reported stolen"}'   https://mosaikit.example.org/api/v1/platform/accounts/ada@acme.com/suspension
curl -u admin https://mosaikit.example.org/api/v1/platform/accounts/ada@acme.com/suspension
curl -u admin https://mosaikit.example.org/api/v1/platform/accounts/suspended
curl -u admin -X DELETE https://mosaikit.example.org/api/v1/platform/accounts/ada@acme.com/suspension
```

The reason, at most 500 characters, is shown to the other platform administrators until the account
is reinstated, and stays in the audit log with the suspension; an account already suspended keeps
its first reason.

A suspended person signs in by no means: not with the password, not with **Remember me**, not
through the realm of an organization. All their sessions end at once, on every browser, and their
"remember me" tokens are revoked; the list of members shows `"suspended": true`. Reactivated, the
person signs in again; the sessions ended by the suspension stay ended, and their personal access
keys (MK-060) stay revoked. You cannot suspend your own
account. Both actions are in the audit log (`account.suspended`, with the reason, and
`account.reactivated`).

A kernel ends a session at once; when several kernels serve the installation, the others refuse it
within `mosaikit.accounts.session-cache` (5 seconds by default). People also see and end their own
sessions in their settings. With Keycloak, the kernel ends its own side of the realm session (the
tokens of that session are refused); to end the session in Keycloak too, use its administration
console.

The real-time connection of a page (MK-031) lives as long as the session it was opened with. When the
session ends, in any of the ways above (signing out, ending it in the settings, a suspension or the
removal from the organization), the kernel sends that page no more events and closes its connection
with the code `4401` ("The session ended"); the shell does not connect again with it. The kernel
that ended the session closes it at once, the other kernels of the installation within 5 seconds. A
suspension also closes the connections the person opened without a session, such as with an access
key.

## How members sign in

Each organization has a sign-in policy, `signIn`:

| Policy | Members act on the data of the organization |
|---|---|
| `password` | with their Mosaikit password (the default without a realm) |
| `realm` | only after signing in through its realm (the default for organizations created with `federation`) |
| `password-or-realm` | either way (the default when a realm is set on an organization that used passwords) |

Set it with the identity settings:

```bash
curl -u admin -X PUT https://mosaikit.example.org/api/v1/organizations/globex/identity \
  -H 'Content-Type: application/json' \
  -d '{"realm": "globex", "emailDomains": ["globex.com"], "signIn": "realm"}'
```

With a password, a person works in one organization at a time: the one of the sub-domain, the one
chosen in the selector of the top bar, or their only organization that accepts passwords. The
roles of the platform (`platform-admin`) count only with a password, never through a realm.

## Self-registration

People can create their own local account on the sign-in page (**Create an account**) in the
organizations created with `selfRegistration`, which sign in with a password. They receive a mail
with a link: until they open it the account does not sign in. The link works once, for
`mosaikit.accounts.confirmation-valid-for` (24 hours), and they can ask for a new one.

- Turn self-registration off and on in **Settings** (platform administrators): the change is
  recorded in the audit log, and with it off the sign-in page offers no registration.
- The mails need a mail server: set `quarkus.mailer.host`, `port`, `username`, `password` and
  `quarkus.mailer.from` in `config/application.properties`, and `mosaikit.public-url` so that the
  links point to the address people use (see [Sending mail](#sending-mail)). Without a mail server,
  administrators create the accounts instead ([Accounts created by an
  administrator](#accounts-created-by-an-administrator)).
- The kernel gives the mail server `mosaikit.accounts.mail-timeout` (15 seconds) in all, in two
  attempts of half each: when the first one times out, it sends the mail once more on another
  connection (a person may then receive the same link twice; either works). When the mail server
  does not take the mail in time, or refuses it, the person sees that the mail could not be sent; the account is created all the
  same, and they ask for the link again from the sign-in page once the mail server works. The
  kernel never keeps a database transaction open while it talks to the mail server.
- The mails of the kernel are written in English or Italian: in the language the person chose in
  their settings; else, for a mail they ask for themselves (registration, a new confirmation link),
  in the language of their browser; else in the language of the installation, `mosaikit.language`
  (`en` unless set). The mail that sets the password of an account an administrator created is in
  the language of the person or of the installation, never in that of the administrator.

## Accounts created by an administrator

An administrator can create a local account for a person, who then chooses the password: this works
with or without a mail server (MK-048). The administrators of an organization, signed in to it,
create accounts in their organization; platform administrators in any organization that signs in
with a password.

In **Permissions**, tab **People**, **Create an account** asks for the name of the person, the email
address and the role in the organization (member or administrator). The account cannot sign in
until the person chooses a password with a link that works once, for
`mosaikit.accounts.set-password-valid-for` (7 days):

- When the installation sends mail (a mail server is set, see below), the link goes to the person
  by mail and is never shown to the administrator.
- When it sends no mail, the link is shown this once, with **Copy the link**: give it to the person
  through a channel you trust. The kernel keeps only a digest of it, so nobody can show it again.

The person opens the link, chooses a password (at least 12 characters, as for registration) and
signs in with the email address and that password. A used or expired link does not work; for a
person who has not chosen a password yet, **New link to set the password** in their page issues
another one, and the previous one stops working. An administrator of the organization issues it
only for people who belong to no other organization; a platform administrator for anyone. Creating
the account, issuing a link and using it are recorded in the audit log of the organization
(`organization.account.created`, `account.password-link.issued`, `account.password-link.used`),
never with the link.

The same through the API (`link` is `null` when the link was mailed, and `mailed` says so):

```bash
curl -u admin -X POST https://mosaikit.example.org/api/v1/organizations/acme/accounts   -H 'Content-Type: application/json'   -d '{"email": "ada@acme.com", "displayName": "Ada Lovelace", "roles": ["organization-user"]}'
# {"member": {...}, "mailed": false, "link": "https://mosaikit.example.org/?set-password=...", "expiresAt": "..."}
curl -u admin -X POST https://mosaikit.example.org/api/v1/organizations/acme/accounts/ada@acme.com/password-link
```

### Sending mail

The kernel sends mail (registration links and the links of created accounts) when
`quarkus.mailer.host` names a mail server, in `config/application.properties` or as the environment
variable `QUARKUS_MAILER_HOST`. Without it, the installation sends no mail: created accounts get a
link to copy, and self-registration needs `mosaikit.accounts.confirm-email=false` (or stays off).
A mail server on the same machine is named too, `quarkus.mailer.host=localhost`.

```properties
quarkus.mailer.host=smtp.example.org
quarkus.mailer.port=587
quarkus.mailer.start-tls=REQUIRED
quarkus.mailer.username=mosaikit@example.org
quarkus.mailer.password=change-me
quarkus.mailer.from=Mosaikit <mosaikit@example.org>
mosaikit.public-url=https://mosaikit.example.org
```

`mosaikit.public-url` makes the links point to the address people use. Each distribution sets them
its own way: see the README of the [installation](../../distribution/install/README.md), of
[Docker Compose](../../distribution/docker/README.md), of [Helm](../../distribution/k8s/README.md)
and of the [portable](../../distribution/portable/README.md) installation.

## Apps of an organization

The administrators of an organization (role `organization-admin`) open **Organization apps** at
the bottom of the app bar, and for each app of the active extensions choose:

- **Shown**: an app that is off leaves the app bar of the organization; when all the apps of a
  extension are off, its API and its documents answer 403 to the people of the organization.
  What other extensions show of its resources, such as a map in a dashboard, becomes a placeholder
  that says what is missing, and tells administrators which extension to turn on (or to install);
  nothing is deleted, and the placeholders show the resources again, also in pages already open,
  when the apps are turned on again (MK-135);
- **Pinned**: people cannot hide it in their settings;
- **For**: **members and administrators**, or **who holds its permission**: the administrators of
  the organization, and the people to whom **Permissions** grants the permission of the app ("Use
  <app>") through a profile, a team or a personal exception (MK-056). An app that was for the
  administrators only before is now for who holds its permission, which nobody else holds until it
  is granted. Guests see an app only when a team of theirs or a personal exception grants its
  permission;
- the **order** of the app bar, with the arrows.

**Save** applies the settings to everyone in the organization at their next page, and records the
change in the audit log. Apps of extensions installed later are shown, after the others, until the
administrators decide. Platform administrators can do the same through
`PUT /api/v1/organizations/{slug}/apps`.

## Permissions of an organization

Extensions declare permissions, such as "create dashboards" (MK-056). A permission is off until the
administrators of the organization grant it:

- through a **profile**, a named set of permissions: each member has one profile, the one assigned
  to them or else the **default profile** of members;
- to a **team**, for its members and its guests;
- to a person, as a **personal exception**.

Grants only add. The administrators of the organization hold every permission; guests hold only
what their teams and their exceptions grant; platform administrators hold none for being platform
administrators. A permission that an update of an extension adds is in no profile, and when all
the apps of an extension are off its permissions are held by nobody. Every change is in the audit
log.

The administrators of the organization open **Permissions** at the bottom of the app bar, next to
**Organization apps**. It has three tabs:

- **Profiles**: the profiles of the organization; **New profile**, a name, a description, and the
  permissions grouped by extension, each with what it allows. Permissions are off until checked,
  and a permission that an update of an extension brings shows unchecked. **Default profile of
  members** makes it the profile of every member without one of their own (one profile at a time).
  **Delete** gives its members back the default profile. The permission of each app ("Use <app>",
  marked *App*) is here too: see **For** in the apps of an organization.
- **People**: choose a person to see their role, to assign a profile (or the default one), to grant
  or revoke **personal exceptions**, and **What they can do**: each permission with where it comes
  from (profile, team, personal exception, administrator of the organization). Administrators hold
  everything; guests have no profile.
- **Teams**: choose a team and check the permissions it grants to its members and guests.

Changes apply at once and are recorded in the audit log.

**Invite a person** (in **People**) asks for the email address, a name for a person without an
account, the role (member or administrator), the profile and the teams, and shows **What they will
be able to do**, with the source of each permission, before anything is sent. For a person who is
already a member, **Apply** gives them that profile and those teams (their role stays). A person
who is not a member yet is added by a platform administrator, whose **Invite** adds them with role,
profile and teams; the administrators of the organization see the preview only, until invitations
by link, accepted by the person, come with MK-068. For a person who has no account at all, **Create
an account** creates a local one in the organization ([Accounts created by an
administrator](#accounts-created-by-an-administrator)).

The same through the API, signed in to the organization: `/api/v1/organizations/{slug}/permissions`
(the declared permissions, `profiles`, `members/{email}`, its `profile` and
`exceptions/{permission}`, `teams/{id}/{permission}`, and `preview` of a proposed member), and
`PUT /api/v1/organizations/{slug}/members/{email}` with `profile` and `teams` (and `roles`, for
platform administrators).
Permissions are named `<extension>:<permission>`.

## Sharing of resources

Extensions that register their resources (MK-054) let people share them, one by one, with a
person, a team, the whole organization, anyone with a link or the public, at the levels the
extension declares, such as view, use, edit and manage (MK-055). The administrators of an
organization hold every level on every resource of their organization and may share any of them;
platform administrators hold none for being platform administrators. A guest gets what is shared
with them or with their teams, never what is shared with the organization. A guest reaches an
extension only when the organization gave them something of it, a permission through a team or an
exception, or a resource shared with them or their teams; then they get exactly that.

A link carries a level (never one that edits), an expiry and an optional password, and can be
revoked; after its expiry or revocation it answers "not found". No link lasts longer than
`mosaikit.sharing.link-max-validity` (30 days unless the installation sets otherwise; see
[configuration](configuration.md)). The kernel keeps only a hash of the secret of a link, so its
address is shown once, when it is made.

Every grant, change of level and revocation is in the audit log, as `sharing.granted`,
`sharing.revoked`, `sharing.link.created` and `sharing.link.revoked`. The use of a link is
`sharing.link.used`: every refused use, and the first use that works in each hour for each link on
each kernel, not every request, since a map read through a link asks for every tile with it. People share in the sharing dialog of the shell, the same
for every app (see the [user guide](using.md)); the REST API is under `/api/v1/sharing` (see the
OpenAPI document of the installation).

A link opens its resource at `/shared/<secret>` of the installation, also for people without an
account: the page asks for its password when it has one, and shows the resource as its app shows it
to links. The APIs of extensions answer a request without an account only when it carries a link
that works and opens a resource of that same extension, and only for that resource. When the
organization turns the apps of an extension off, its links open nothing.

The documents that apps without a backend share with a team (MK-032) are resources of this model
too: the team holds the level Edit on each of them, and the dialog can give access to other people
or teams, or take it away from the team. As before, the administrators of the organization do not
read them for being administrators: only the members of the team and whoever a document is shared
with do (an exception to the rule above). The documents shared with teams before this version
were moved onto the model when the kernel was updated (migration `V28`).

An update of an extension that removes a resource type, or a level of one, on which grants exist
is refused, with the list of those grants: revoke them first.

## Audit log

The kernel records who proposed, confirmed, rejected or ran an action of an assistant, and who
created an organization, changed its identity settings, its members, its apps, its permissions or
the retention of its audit log. Extensions record their own sensitive actions in the same log, with
the action named after the extension, such as `dev.example.dashboards:dashboard.exported`. Each entry says who (`actor`), what (`action`), on which object
(`subject`), when (`occurredAt`), with which `outcome`, and through which `channel`: `WEB` (the
console, or a client signed in as a person), `API_KEY`, `JOB` (a job of the kernel, such as the
retention), `ASSISTANT` (an assistant or an MCP client) or `EXTENSION`. The same entries are written to
the log category `mosaikit.audit`, which can be sent to a SIEM. Sign-ins are not recorded yet.

### Reading it

The administrators of an organization, signed in to it, read the entries of their organization, and
of no other, with `GET /api/v1/organizations/{slug}/audit-events`, newest first. They filter them by
`actor`, `action` (one action, or every action under a prefix that ends with a dot or a colon,
such as `permissions.`, or `dev.example.dashboards:` for the entries recorded by that extension),
`subject`, `channel`, and time with `from` and `to` (such as `2026-10-13T08:00:00Z`), and page with
`offset` and `limit` (100 by default, up to 500).

Platform administrators read the entries of the platform, those without organization, with
`GET /api/v1/audit-events?platform=true`, and those of one organization with `organization=<id>`;
the same filters apply.

### Verifying it

No API changes or deletes an entry, and requests cannot either in the database: the role they run
as may only read and add entries of their organization. Each organization has its own chain of
entries, and the platform one: every entry carries its position in the chain (`index`), the hash of
the entry before it (`previousHash`) and its own (`hash`, SHA-256 over its content and the previous
hash). Someone who changes, removes or inserts an entry directly in the database breaks the chain at
that position.

`GET /api/v1/organizations/{slug}/audit-events/verification` walks the chain of the organization
(`GET /api/v1/audit-events/verification` that of the platform, or of any organization with
`organization=<id>`) and answers `{"intact": true, "checked": 120, "firstIndex": 1, "lastIndex": 120}`,
or the first entry that is not as it was written:

```json
{"intact": false, "checked": 41, "altered": {"index": 42, "id": "…", "problem": "CHANGED"}}
```

`CHANGED` means the content of the entry, or its link to the entry before it, is not what the kernel
wrote; `MISSING` that the entry at that position is gone and the retention did not delete it. The
chain proves that the log was not altered after the fact by someone without access to the kernel;
whoever administers the database could rewrite a whole chain, so keep copies of the `mosaikit.audit`
log category, or of the last `hash`, outside the database.

### Retention

Entries are kept until the administrators set a retention: `PUT
/api/v1/organizations/{slug}/audit-events/retention` with `{"retentionDays": 730}`, or `null` to keep
every entry again (`/api/v1/audit-events/retention` for the platform). The installation sets a
minimum, `mosaikit.audit.min-retention` (365 days by default, see
[configuration](configuration.md#audit-log)): a shorter retention is refused, and no entry younger
than the minimum is ever deleted, even when the minimum is raised later. `GET` on the same path
answers the `retentionDays` set, the `minimumDays` and the `effectiveDays`.

Every few hours (`mosaikit.audit.retention-check`) each kernel deletes the entries older than the
retention of their organization, oldest first, and records it in the same chain
(`audit.entries.deleted`, channel `JOB`). The chain stays verifiable: the kernel keeps the hash of the
last deleted entry, and the verification starts from there (`firstIndex`).

## External origins

The browser loads and contacts only the installation, so the shell and the frontends of extensions
cannot read an external service directly, even one that allows cross-origin calls. Platform
administrators list the external services that the browser may contact for images, data and tiles
in **External origins**, in the administration menu, or with
`/api/v1/platform/content-security-policy` (MK-128): an origin is `scheme://host[:port]`, such as
`https://tiles.example.org`, or `https://*.tiles.example.org` for its sub-domains. The page also
shows the origins set in `mosaikit.content-security-policy.allowed-origins`, which only the
configuration removes (see [configuration](configuration.md#content-security-policy)). Every other
address stays blocked.

Each origin added or removed is in the audit log of the platform (`content-security-policy.origin-added`,
`content-security-policy.origin-removed`). Every kernel of the installation applies a change within
30 seconds, the one that received it at once. Administrators of organizations and extensions cannot
change the list: the table belongs to the installation, and requests have no right on it.

## Credentials of extensions

Extensions call external services, such as model providers, mail servers or databases, with keys
and passwords that must not be written into shared documents nor reach the browser. The
administrators of an organization keep them in **Credentials**, in the administration menu, or with
`/api/v1/organizations/{slug}/secrets` (see the [API](../development/api.md)). Each credential has a
name, such as `model-provider`, a kind (password, token, key or other), the value, a description, and
optionally the extension it is meant for: then only that extension reads it. The backend of an
extension reads a credential by name, on the server, in the organization of the request; the
browser never receives it. Tell the extensions which names to read from their documentation.

A value is encrypted as soon as it arrives and never comes back: lists and details show a hint at
most, `••••`, followed for a long token or key by its last four characters, never for a password. A
credential is replaced, with a new value or only a new description, or deleted. Every store,
replacement and deletion, and every read by an extension (`secrets.read`, channel `EXTENSION`), is in
the audit log under `secrets.`, without the value; values never appear in logs nor in error
messages.

### Credentials of the installation

Some credentials belong to no organization: the account of a server shared by every organization, a
mail relay, a licence key. Platform administrators keep them in **Installation credentials**, in the
administration menu, or with `/api/v1/platform/credentials` (MK-127): the same fields, the same
encryption and the same hints as the credentials of an organization. Extensions that read a
credential by name with `resolve` get the one of the organization of the request when there is one
they may read, otherwise the one of the installation, also where there is no organization, such as
in a scheduled job. So an organization can use an account of its own instead of the shared one by
storing a credential with the same name.

Every change is in the audit log of the platform under `secrets.`, with `scope` `installation`, and
every read by an extension too (`secrets.read`, with the organization of the request), without the
value. The values are bound to the installation when encrypted, so a row moved between the
installation and an organization does not decrypt. The table belongs to no organization: requests,
and the SQL of extensions, have no right on it; only the kernel reads it.

### The master key

Each value is encrypted with AES-256-GCM under a data key of its own, and the data key under the
master key of the installation, which never goes in the database: a copy of the database, or of a
backup, does not reveal the credentials without it. Both encryptions bind the value to its
organization and name, so a row moved to another organization or name does not decrypt. Credentials
are under row-level security like the rest of the data of an organization.

Generate the master key once, keep it with the other secrets of the installation, and back it up
apart from the database; without it the credentials are lost:

```sh
openssl rand -base64 32
```

Give it to the kernel as `MOSAIKIT_SECRETS_MASTER_KEY`, or in a file named by
`mosaikit.secrets.master-key-file` such as a mounted secret (see
[configuration](configuration.md#credentials-of-extensions)). Without a valid key the kernel still
starts, logs that the store of credentials is disabled and why, and its endpoints answer 503. All the
kernels of an installation need the same keys.

### Rotating the master key

1. Generate a new key.
2. Make it the current key (`mosaikit.secrets.master-key`), and move the old one to
   `mosaikit.secrets.previous-keys`; restart the kernels. New and replaced credentials use the new
   key; the others still decrypt with the old one.
3. As a platform administrator, call `POST /api/v1/platform/secrets/re-encryption`: it encrypts the
   data key of every credential, in every organization and of the installation, under the new key,
   without decrypting the values, and answers how many moved (`reEncrypted`) and how many it could not read (`unreadable`,
   when their key is missing from `previous-keys` or a row was altered). It is audited as
   `secrets.re-encrypted`.
4. `GET /api/v1/platform/secrets/keys` lists how many credentials each key still holds, by an
   identifier derived from the key. When the old key holds none, remove it from `previous-keys` and
   restart.

## Files of extensions

Extensions keep files through the kernel (MK-041): the content goes to the store of the
installation, under `<organization id>/<extension id>/<file id>`, and the database keeps the name,
type, size, SHA-256 checksum, owner and team of each file. Extensions never see the credentials of
the store. A person reads a file of their organization, or of a team they are in; a guest only the
files of their teams. A file attached to a resource of the extension, such as the cover of an
album, follows the sharing of that resource instead: it is read by the people the resource is shared
with, and replaced or deleted by those with a level that edits it. A file that a person may not read
answers "not found", even with its identifier. Every file stored or deleted is in the audit log, as `file.stored` and `file.deleted`.

Choose the store with `mosaikit.files.store` (see [configuration](configuration.md#files)):

- **`filesystem`** (the default): a directory of the server, `files/` in the installation directory
  unless `mosaikit.files.directory` says otherwise. Right for the portable distribution and for an
  installation on one server. Back it up with the database: a copy of one without the other gives
  files without metadata, or metadata without files. On Kubernetes the root filesystem of the kernel
  is read-only: the chart mounts a volume (`files.persistence`), which with more than one replica
  must be shared (`ReadWriteMany`), or use `s3`.
- **`s3`**: a bucket of an S3-compatible object store, such as Amazon S3, MinIO, Ceph or Garage; the
  choice for a cluster and for large volumes. Create the bucket first, keep it private (the kernel
  serves every download itself), and give the kernel an access key allowed to read, write and
  delete objects in it, from a secret:

  ```properties
  mosaikit.files.store=s3
  mosaikit.files.s3.endpoint=https://s3.example.org
  mosaikit.files.s3.bucket=mosaikit-files
  mosaikit.files.s3.path-style=true
  mosaikit.files.s3.access-key-id=mosaikit
  # from a secret: MOSAIKIT_FILES_S3_SECRET_ACCESS_KEY
  ```

  Without `endpoint`, the kernel talks to Amazon S3 in `mosaikit.files.s3.region`; without the
  access key, it uses the credentials of its environment (variables, profile, role of the machine
  or of the pod). At start the kernel logs where files are kept and warns when the bucket cannot be
  reached; it never logs the secret.

Files larger than `mosaikit.files.max-size` (10 MB unless set) are refused; to accept larger ones
through the REST API, raise `quarkus.http.limits.max-body-size` too. An upload is first written to
the temporary directory of the server, so it needs room for the largest file. Changing the store
does not move the files already stored: copy the objects to the new store, keeping their keys.

### Removing the content of files whose record is gone

A file of a team goes with the team, and the files of an organization with the organization; the
files of an extension stay recorded when it is uninstalled. In every case the content stays in the
store until a platform administrator removes it, explicitly, after a retention:

- Every file whose record is deleted (the file, its team or its organization) is queued for removal
  at once, by the database.
- The files of an uninstalled extension are queued only when you ask, for that extension:
  `POST /api/v1/platform/files/removals/extensions/<extension id>`. It is refused while the extension
  is installed, and while no extension at all is installed, which says more of a wrong
  `mosaikit.extensions.directory` than of the extension. Their records stay until the clean-up,
  which keeps them if the extension has been installed again.
- `GET /api/v1/platform/files/removals` tells how many contents wait, how many are past the
  retention, and which extensions that are no longer installed still have files.
- `POST /api/v1/platform/files/clean-up` removes from the store what was queued at least
  `mosaikit.files.removal-retention` before (30 days unless set, one day at least), so that a
  database restored from a backup of that time still finds its files. It refuses to run, and removes
  nothing, when the store does not hold the newest files the database records, as when
  `mosaikit.files.*` names another directory or bucket. A content that cannot be removed stays queued
  for the next clean-up. Each request for an extension (`files.removal.queued`) and each clean-up
  (`files.cleaned`, with how many contents and bytes, and why) is in the audit log of the platform.

### Signed links to files

Viewers, external tools, embedded pages and links in notifications download files without the
session of a person through signed, expiring links (MK-093). A person, or an extension, asks for a
link to a file they read, or to every file under a prefix of names, such as `tiles/`, of the
organization or of one of their teams; whoever holds the link downloads those files, with ranges and
cache validators, until it expires: at most `mosaikit.files.link-max-validity` (7 days unless set)
after it was made. An expired or altered link answers 404, as a file that does not exist, so that a
link never tells whether a file is there. Making a link is in the audit log as `file.link.created`;
its use as `file.link.used`, the first time in each hour for each link on each kernel, not every
download. A link made by a person opens only what that person still reads: a file attached to a
resource of the extension while they hold a level on the resource, and nothing once they left the
organization; revoking a share stops their links to the files of that resource. Otherwise a link opens
the files it names until it expires, also when the person who made it leaves the team: deleting the
file, or rotating the key, stops it.

No table keeps the links: each carries its organization, extension, file or prefix, expiry and the
account of the person who made it,
signed with HMAC-SHA256 by the key of the installation. The key is:

- `mosaikit.files.link-key` when set: 32 random bytes or more in base64 (`openssl rand -base64 32`),
  from a secret (`MOSAIKIT_FILES_LINK_KEY`);
- otherwise a key derived with HKDF-SHA256 from the master key of the store of credentials
  (`mosaikit.secrets.master-key`), under a label of its own, so that the master key never signs
  anything itself;
- without either, links to files are disabled: making one answers 503, and the kernel logs why at
  start.

All the kernels of an installation need the same keys. To **rotate** the key, make the new one
current and move the old one to `mosaikit.files.link-previous-keys`, then restart the kernels: new
links are signed with the new key, and those already given keep working until they expire. After
`mosaikit.files.link-max-validity` remove the old key. Removing a key at once, without moving it to
the former keys, stops every link it signed: the way to revoke all links after a leak. A key derived
from the master key rotates with it: the former master keys in `mosaikit.secrets.previous-keys` keep
their links working.

## Quotas of organizations

The kernel measures what each organization consumes and refuses what would pass its limits
(MK-076). A measure is either a **gauge**, what the organization keeps now, or a **counter**, what
it uses in a calendar month (UTC), from zero at the start of each month. The kernel has one measure
of its own, **storage**, a gauge in bytes: the files of the organization and the space that its
extensions report for their resources. Extensions may declare their own measures, such as calls to
a service or the credits of a model.

A limit comes from one of two places:

- the **default of the installation**, the same for every organization, in the settings:
  `mosaikit.quotas.storage=10G`, and `mosaikit.quotas.limits."<extension>/<measure>"=1000` for a
  measure of an extension (see [configuration](configuration.md#quotas));
- a **limit of the organization**, which a platform administrator sets over the default, on the
  **Quotas** page of the organization or with
  `PUT /api/v1/organizations/{slug}/quotas/{measure}` (`{"limit": n}`, or `{"limit": null}` for no
  limit whatever the default); removing it brings the default back.

Without either, the measure has no limit. A limit is never applied to what is already kept: an
organization above its storage limit keeps its files, deletes some to make room, and may not add
more until then. An action that does not fit is refused with `403 Quota exceeded`, whose message
names the measure, the limit, what is used and what the action needed; two uploads at the same time
cannot both pass a limit that only one of them fits. Every change of a limit is in the audit log, as
`quota.limit.set` and `quota.limit.removed`.

The administrators of the organization see, under **Administration > Quotas**, each measure with
its limit, where the limit comes from and the share used, and the consumption of a month by person;
platform administrators see and change the limits there. The same figures are at
`GET /api/v1/organizations/{slug}/quotas` and `GET /api/v1/organizations/{slug}/quotas/usage`. They
are current: every action updates them, there is nothing to wait for. A file counts to the person
who stored it, the space of a resource to its owner; what was used without a person, or by people
who left, counts to nobody in particular.

## Assistants and MCP clients

Extensions may declare actions that assistants use as tools (see
[extension development](../development/extensions/assistants.md#actions-for-assistants)). An MCP client
connects to `https://<host>/mcp` with the credentials of a person and the header
`X-Mosaikit-Organization: <slug>`; it has exactly the rights of that person in that organization,
and changes wait for the confirmation of the person. A client can also use a personal access key
created with the write switch (MK-060); a read-only key is refused, since every MCP call is a
`POST`.

## Published views for external services

Services that read who belongs to which organization and team from the database, such as a map
server with a JDBC role service, read the [published views](../development/published-views.md) of
schema `mk_published`: accounts, organizations, memberships, teams and their members, and who
holds the permissions of extensions, never passwords or secrets. Their names and columns are a contract that changes only with a breaking
change of the platform.

At each start the installation creates the role `mk_<database>_reader` (for the database `mosaikit`,
`mk_mosaikit_reader`), which reads those views and nothing else of the database. A database
administrator gives it to a login of the service:

```sql
create role map_server login password 'a long random secret';
grant mk_mosaikit_reader to map_server;
```

Or the kernel creates the login at start, from `mosaikit.database.published-views.login` and
`mosaikit.database.published-views.password` (see [configuration](configuration.md)).
Both ways need a database user with `CREATEROLE`, as row-level security does; without it the kernel
starts with a warning and the role is created by hand as above, followed by
`grant usage on schema mk_published to mk_mosaikit_reader` and
`grant select on all tables in schema mk_published to mk_mosaikit_reader`.

The views run with the rights of the kernel: row-level security never hides rows from them, and a
change made in the console or through the API is read at once. The login cannot read the tables of
the kernel or of extensions, call their functions, or write the views.

## Extensions

See [extensions](extensions.md). `GET /api/v1/extensions` lists every extension found, with its status, its
problems and, for signed packages of a trusted publisher, `publisherKey`.
