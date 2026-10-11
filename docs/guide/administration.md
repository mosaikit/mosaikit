# Administration

Platform administrators (role `platform-admin`, the `admin` account created at the first start)
manage organizations and plugins. Today this is done through the REST API; the examples use
`curl`, which asks for the password of `admin`. The whole API is described at `/q/openapi`.

## Roles

| Role | Who | Can |
|---|---|---|
| `platform-admin` | the administrators of the installation | manage organizations, their identity settings and the plugins |
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
change their roles:

```bash
curl -u admin https://mosaikit.example.org/api/v1/organizations/globex/members          # list
curl -u admin -X PUT https://mosaikit.example.org/api/v1/organizations/globex/members/ada@acme.com \
  -H 'Content-Type: application/json' -d '{"roles": ["organization-user"]}'
curl -u admin -X DELETE https://mosaikit.example.org/api/v1/organizations/globex/members/ada@acme.com
```

A person without an account gets one without password: they sign in through the realm of the
organization, which links the account at the first sign-in (if the realm verified the address).
A realm can link an existing account only when that account is a member of its organization.

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
  links point to the address people use. Without a mail server, registrations fail with a
  message and nothing is created.

## Apps of an organization

The administrators of an organization (role `organization-admin`) open **Organization apps** at
the bottom of the app bar, and for each app of the active plugins choose:

- **Shown**: an app that is off leaves the app bar of the organization; when all the apps of a
  plugin are off, its API and its documents answer 403 to the people of the organization;
- **Pinned**: people cannot hide it in their settings;
- **For**: everyone, or the administrators only;
- the **order** of the app bar, with the arrows.

**Save** applies the settings to everyone in the organization at their next page, and records the
change in the audit log. Apps of plugins installed later are shown, after the others, until the
administrators decide. Platform administrators can do the same through
`PUT /api/v1/organizations/{slug}/apps`.

## Audit log

The kernel records who proposed, confirmed, rejected or ran an action of an assistant, and who
created an organization, changed its identity settings or its members. Platform administrators
read the latest events with `GET /api/v1/audit-events?limit=100` (up to 500, and
`organization=<id>` for one organization). The same events are written to the log category
`mosaikit.audit`, which can be sent to a SIEM. The events are never changed nor deleted by the
kernel; sign-ins are not recorded yet.

## Assistants and MCP clients

Plugins may declare actions that assistants use as tools (see
[plugin development](../development/plugin-development.md#actions-for-assistants)). An MCP client
connects to `https://<host>/mcp` with the credentials of a person and the header
`X-Mosaikit-Organization: <slug>`; it has exactly the rights of that person in that organization,
and changes wait for the confirmation of the person.

## Plugins

See [plugins](plugins.md). `GET /api/v1/plugins` lists every plugin found, with its status, its
problems and, for signed packages of a trusted publisher, `publisherKey`.
