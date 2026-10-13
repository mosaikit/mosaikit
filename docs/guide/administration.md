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
- Every request made with a key is in the audit log: `account.access-key.used` with the key, the
  method and the path, or `account.access-key.refused` with the reason (`revoked`, `expired`,
  `suspended`, `not-a-member`, `read-only`, `not-with-a-key`); `account.access-key.created` and
  `account.access-key.revoked` record the actions of the person. The subject of the events is the
  prefix of the key that people see in their list.
- A service that receives keys from its callers, such as a gateway, checks one with `GET
  /api/v1/access-keys/current`, called with that key (see the [API](../development/api.md)).

## Suspending a person

A platform administrator suspends an account, for example when a person leaves or a device is
lost, and reactivates it later (MK-125):

```bash
curl -u admin -X PUT https://mosaikit.example.org/api/v1/platform/accounts/ada@acme.com/suspension
curl -u admin -X DELETE https://mosaikit.example.org/api/v1/platform/accounts/ada@acme.com/suspension
```

A suspended person signs in by no means: not with the password, not with **Remember me**, not
through the realm of an organization. All their sessions end at once, on every browser, and their
"remember me" tokens are revoked; the list of members shows `"suspended": true`. Reactivated, the
person signs in again; the sessions ended by the suspension stay ended, and their personal access
keys (MK-060) stay revoked. You cannot suspend your own
account. Both actions are in the audit log (`account.suspended`, `account.reactivated`).

A kernel ends a session at once; when several kernels serve the installation, the others refuse it
within `mosaikit.accounts.session-cache` (5 seconds by default). People also see and end their own
sessions in their settings. With Keycloak, the kernel ends its own side of the realm session (the
tokens of that session are refused); to end the session in Keycloak too, use its administration
console.

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
  links point to the address people use.
- The kernel gives the mail server `mosaikit.accounts.mail-timeout` (15 seconds) in all, in two
  attempts of half each: when the first one times out, it sends the mail once more on another
  connection (a person may then receive the same link twice; either works). When the mail server
  does not take the mail in time, or refuses it, the person sees that the mail could not be sent; the account is created all the
  same, and they ask for the link again from the sign-in page once the mail server works. The
  kernel never keeps a database transaction open while it talks to the mail server.

## Apps of an organization

The administrators of an organization (role `organization-admin`) open **Organization apps** at
the bottom of the app bar, and for each app of the active extensions choose:

- **Shown**: an app that is off leaves the app bar of the organization; when all the apps of a
  extension are off, its API and its documents answer 403 to the people of the organization;
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
by link, accepted by the person, come with MK-068.

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
with them or with their teams, never what is shared with the organization.

A link carries a level (never one that edits), an expiry and an optional password, and can be
revoked; after its expiry or revocation it answers "not found". No link lasts longer than
`mosaikit.sharing.link-max-validity` (30 days unless the installation sets otherwise; see
[configuration](configuration.md)). The kernel keeps only a hash of the secret of a link, so its
address is shown once, when it is made.

Every grant, change of level, revocation and use of a link is in the audit log, as
`sharing.granted`, `sharing.revoked`, `sharing.link.created`, `sharing.link.revoked` and
`sharing.link.used` (also when refused). The REST API is under `/api/v1/sharing` (see the OpenAPI
document of the installation); the sharing dialog of the shell comes next.

An update of an extension that removes a resource type, or a level of one, on which grants exist
is refused, with the list of those grants: revoke them first.

## Audit log

The kernel records who proposed, confirmed, rejected or ran an action of an assistant, and who
created an organization, changed its identity settings, its members, its apps, its permissions or
the retention of its audit log. Each entry says who (`actor`), what (`action`), on which object
(`subject`), when (`occurredAt`), with which `outcome`, and through which `channel`: `WEB` (the
console, or a client signed in as a person), `API_KEY`, `JOB` (a job of the kernel, such as the
retention), `ASSISTANT` (an assistant or an MCP client) or `EXTENSION`. The same entries are written to
the log category `mosaikit.audit`, which can be sent to a SIEM. Sign-ins are not recorded yet.

### Reading it

The administrators of an organization, signed in to it, read the entries of their organization, and
of no other, with `GET /api/v1/organizations/{slug}/audit-events`, newest first. They filter them by
`actor`, `action` (one action, or every action under a prefix that ends with a dot, such as
`permissions.`), `subject`, `channel`, and time with `from` and `to` (such as
`2026-10-13T08:00:00Z`), and page with `offset` and `limit` (100 by default, up to 500).

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

## Assistants and MCP clients

Extensions may declare actions that assistants use as tools (see
[extension development](../development/extension-development.md#actions-for-assistants)). An MCP client
connects to `https://<host>/mcp` with the credentials of a person and the header
`X-Mosaikit-Organization: <slug>`; it has exactly the rights of that person in that organization,
and changes wait for the confirmation of the person.

## Published views for external services

Services that read who belongs to which organization and team from the database, such as a map
server with a JDBC role service, read the [published views](../development/published-views.md) of
schema `mk_published`: accounts, organizations, memberships, teams and their members, never
passwords or secrets. Their names and columns are a contract that changes only with a breaking
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
