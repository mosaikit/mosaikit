# REST API

The kernel API is under `/api/v1`, the APIs of extensions under `/api/v1/ext/<api>`, where `<api>` is
the `backend.api` name of the manifest. The OpenAPI 3 document of the running kernel is at
`/q/openapi`; this page gives the conventions that hold for every endpoint.

## Authentication

| Client | How |
|---|---|
| Local accounts (the platform administrator, organizations without a realm) | HTTP Basic, over HTTPS |
| People of an organization with a Keycloak realm | `Authorization: Bearer <access token>` issued by the realm to the `mosaikit` client (authorization code with PKCE) |

The kernel finds the organization of a bearer token from the sub-domain of the request
(`mosaikit.identity.domain`), or from the issuer of the token. `GET /api/v1/identity/sign-in-options?email=`
tells a client how a person signs in.

Every extension API requires an authenticated person (`quarkus.http.auth.permission.extension-api`,
policy `person-or-link`), and only APIs of active extensions answer. The one exception is a request
without an account that carries, in `X-Mosaikit-Link`, a link that works and opens a resource of
that same extension (MK-055): it acts on the organization of the resource only after the extension
asked `Sharing` about that resource, so only routes annotated `@PermitAll` that call
`Sharing.require` serve it.

Every request acts on at most one organization of the person (MK-017): the one of the realm of a
bearer token; with a password, the one named by the `X-Mosaikit-Organization` header or by the
sub-domain, or the only organization of the person that accepts passwords. Requests to extension
APIs without an organization answer `403`. `GET /api/v1/accounts/me` gives the organization of the
request and every membership of the person.

The shell signs a local account in once, with a form posted to `/api/v1/accounts/session` (fields
`username` and `password`; 200 with the account, or 401). The kernel opens a session that it keeps
in its database (MK-125) and sets an HttpOnly, SameSite=Strict cookie, `mosaikit-session`, that
holds only a random value: a reload keeps the session, no script of the page holds the password, and
signing out, a suspension or the removal from the organization end the session on the server, so
that a copy of the cookie is refused at once (401). Every request with the cookie is checked against
the session, so a service that validates a session by calling the kernel with it, such as a gateway
in front of data, sees the end at once too. A bearer token of a realm belongs to the session of the
realm (its `sid`): signing out with it (`DELETE /api/v1/accounts/session`) ends that session on the
kernel, and its tokens are refused before they expire. Requests marked `X-Mosaikit-Client: shell` get a 401 without
`WWW-Authenticate`, so that the browser never opens its own sign-in dialog. Other clients keep using
HTTP Basic or bearer tokens.

Scripts and other clients use a personal access key (MK-060), created by the person in their
settings, sent as `Authorization: Bearer mk_...`. A bearer token that starts with `mk_` is always
read as a key, never as a token of a realm. The key acts for its person in the organization chosen
when it was created (the `X-Mosaikit-Organization` header is ignored), with the roles and
permissions the person has there at the time of each request; the roles of the platform are never
given to a key. An unknown, revoked or expired key, a key of a suspended person or of a person no
longer in its organization answers 401. A key created without the write switch passes only `GET`,
`HEAD` and `OPTIONS`, on the APIs of the kernel and of extensions: any other method answers 403. No
key reaches the sessions (`/api/v1/accounts/session`, `/api/v1/accounts/me/sessions`) or the keys
(`/api/v1/accounts/me/access-keys`): 403. The MCP server (`/mcp`) takes only `POST`, so it refuses
read-only keys. The audit log records through the channel `API_KEY` every refused request
(`account.access-key.refused`, with the reason) and the first use of a key in each hour
(`account.access-key.used`), not every request; every other entry written during a request made
with a key has the channel `API_KEY` too.

A service that receives a key from its own callers checks it with `GET
/api/v1/access-keys/current`, called with that same key: the key is its own credential, so the
service needs no secret of its own and cannot learn about other keys, and the call follows the
same rules as any other (401 once revoked). A service with a service identity checks keys, and
sessions, with credentials of its own (below).

```bash
curl -H "Authorization: Bearer $KEY" https://mosaikit.example.org/api/v1/access-keys/current
# {"id": "...", "name": "Gateway", "prefix": "mk_AbCdEfGh", "write": false, "expiresAt": "...",
#  "account": {"id": "...", "username": "ada@example.org", "displayName": "Ada"},
#  "organization": {"id": "...", "slug": "acme"}, "roles": ["organization-user"]}
```

Callers that are not people, such as a gateway in front of a map server or a map server that maps a
key to a person through an extension, use a service identity (MK-124), created by a platform
administrator, with a key of its own sent as `Authorization: Bearer mks_...`. A bearer token that
starts with `mks_` is always read as the key of a service. The request then has the principal
`service:<name>`, the single role `service`, no account and no organization: it reaches the APIs of
extensions the identity was given (`/api/v1/ext/<api>/`), and `POST /api/v1/services/check` when it
was given `check-session` or `check-key`; every other path, the shell and the other APIs of the
kernel included, answers 403. It acts on an organization only when it names one with
`X-Mosaikit-Organization` that the identity was allowed; another one answers 403. An unknown or
revoked key answers 401. The audit log records through the channel `SERVICE` every refused call
(`service.refused`, with the reason: `revoked`, `not-granted`, `organization`) and the first call of
each identity to each API in an hour (`service.used`). An identity has at most two live keys, so
that a key is rotated without a pause.

A gateway checks the session cookie of the shell, or a personal access key, that a person sent it:

```bash
curl -H "Authorization: Bearer $SERVICE_KEY" -H 'Content-Type: application/json'   -d '{"session": "<value of the mosaikit-session cookie>", "organization": "acme"}'   https://mosaikit.example.org/api/v1/services/check
# {"kind": "session", "account": {"id": "...", "username": "ada@example.org", "displayName": "Ada"},
#  "organization": {"id": "...", "slug": "acme"}, "roles": ["organization-user"]}
curl -H "Authorization: Bearer $SERVICE_KEY" -H 'Content-Type: application/json'   -d '{"key": "mk_..."}' https://mosaikit.example.org/api/v1/services/check
# {"kind": "key", "account": {...}, "organization": {...}, "roles": [...],
#  "key": {"id": "...", "name": "Map client", "prefix": "mk_AbCdEfGh", "write": false, "expiresAt": "..."}}
```

Credentials that open nothing (an ended session, a revoked or expired key, a suspended person)
answer 401, as when the person sends them to the kernel.

## Endpoints of the kernel

<!-- Generated: the rows are sorted by path and rewritten from the OpenAPI document of the kernel.
     After adding, changing or removing an endpoint run
       ./mvnw -pl sdk/java,src/server test -Dskip.npm -Dtest=DocumentationTest -Dsurefire.failIfNoSpecifiedTests=false -Ddocs.write=true
     which adds a row for each new endpoint (who may call it, from its security annotations or its
     OpenAPI extension x-mosaikit-access, and its @Operation summary) and removes the gone ones; the
     text of a row may then be completed by hand. DocumentationTest fails when the table is not up
     to date. -->

The rows are sorted by path, one row for a path and the methods that share a description.

| Method and path | Who | Purpose |
|---|---|---|
| `GET /api/v1/access-keys/current` | with an access key | validate the key of the request, for services: `id`, `name`, `prefix`, `write`, `expiresAt`, the `account` and the `organization` it acts for, and the `roles` of the person there now; 404 without a key (MK-060) |
| `POST /api/v1/accounts/confirmations` | anyone | confirm an address with the token of the link (`{"token": "…"}`); 404 when the link was used or expired |
| `POST /api/v1/accounts/confirmations/requests` | anyone | send the link again (`{"email": "…"}`); always 202 |
| `GET /api/v1/accounts/me` | signed in | the current account, with its personal settings |
| `GET /api/v1/accounts/me/access-keys` | signed in, not with a key | the access keys of the person not revoked, expired ones included (MK-060): `maxValidityDays` and `keys`, each with `id`, `name`, `prefix`, `organizationId`, `organization`, `write`, `createdAt`, `lastUsedAt` (to the hour), `expiresAt`, `expired`; never the secret |
| `POST /api/v1/accounts/me/access-keys` | signed in, not with a key | create a key (`{"name", "organization": "<slug>", "expiresAt"?, "write"?}`) for one organization of the person, expiring at most `mosaikit.accounts.access-key-max-validity` from now (the longest when absent), read-only unless `write` is true: 201 with the key and its `secret`, shown this once (audited) |
| `DELETE /api/v1/accounts/me/access-keys/{id}` | signed in, not with a key | revoke a key of the person: the next request with it is refused, the sessions go on; 404 when it is not a key of the person (audited) |
| `GET, PUT /api/v1/accounts/me/preferences` | signed in | the personal settings (MK-027): `theme`, `appearance` (`system`, `light`, `dark`, `contrast`), `language` (`en`, `it`), `hiddenApps` (`<extension id>/<app id>`) |
| `GET /api/v1/accounts/me/sessions` | signed in | the live sessions of the person (MK-125): `id`, `kind` (`password` or `realm`), `userAgent`, `address`, `createdAt`, `lastSeenAt`, `current` |
| `DELETE /api/v1/accounts/me/sessions/{id}` | signed in | end a session of the person: its cookie, its "remember me" and the tokens of its realm session are refused at once; 404 when it is not a live session of the person (audited) |
| `POST /api/v1/accounts/passwords` | anyone, with the token of a link | set the password of an account an administrator created (MK-048): `token`, `password` (12 to 128 characters); 204, then the person signs in; 404 when the link was used or expired (audited) |
| `GET /api/v1/accounts/registration-options` | anyone | whether the sign-in page offers to create an account, and in which organizations (MK-048) |
| `POST /api/v1/accounts/registrations` | anyone, when registration is on and the organization allows it | self-registration: 201 with the account, or 202 when a link was sent to confirm the address first |
| `GET /api/v1/accounts/session` | anyone | the account of the session of the shell, or 204 without one |
| `POST /api/v1/accounts/session` | anyone | sign in with the form fields `username` and `password`: 200 with the account and the session cookie, or 401 (MK-125) |
| `DELETE /api/v1/accounts/session` | anyone | end the session of the request on the server (the cookie of the shell, or the realm session of a bearer token), and forget the browser if it was remembered |
| `POST /api/v1/accounts/session/remembrance` | signed in, with a password | remember this browser: an HttpOnly cookie signs the person in again for `mosaikit.accounts.remember-for` |
| `GET /api/v1/ai/assistant` | signed in | whether an assistant is configured, and its model (MK-024) |
| `POST /api/v1/ai/assistant/replies` | signed in, with an organization | ask the assistant: `{"messages": [{"role": "user", "content": "…"}]}`; returns the reply, the tools used and the drafts |
| `GET /api/v1/ai/drafts` | signed in | the open drafts that the person proposed |
| `GET /api/v1/ai/drafts/{id}` | the person who proposed it | one draft |
| `DELETE /api/v1/ai/drafts/{id}` | the person who proposed it | reject a draft |
| `POST /api/v1/ai/drafts/{id}/confirmation` | the person who proposed it | run a draft |
| `GET /api/v1/ai/tools` | signed in, with an organization | the tools of the active extensions (MK-015) |
| `POST /api/v1/ai/tools/{tool}/invocations` | signed in, with an organization | invoke a tool: 200 with the result, or 202 with a draft |
| `GET /api/v1/audit-events` | `platform-admin` | audit events, newest first: of every organization, of one (`organization=<id>`) or of the platform only (`platform=true`); with the filters of the list of an organization (MK-059) |
| `GET, PUT /api/v1/audit-events/retention` | `platform-admin` | the retention of the entries of the platform: `{"retentionDays": 730}`, or `null` to keep every entry; never below the minimum of the installation, `minimumDays`, or the answer is 400 (audited) |
| `GET /api/v1/audit-events/verification` | `platform-admin` | verify the chain of the platform, or of one organization with `organization=<id>`: `{"intact": true, "checked", "firstIndex", "lastIndex"}`, or `{"intact": false, "altered": {"index", "id", "problem"}}` with the first entry `CHANGED` or `MISSING` (MK-059) |
| `GET, POST /api/v1/data/{extension}/{collection}` | signed in, with an organization | the documents of a collection declared by an active extension, newest first (`offset`, `limit`); add one (MK-046); with `team`, those shared with that team of the person (MK-032), each a resource `data-document` of the sharing model with the team at the level `edit` (MK-055) |
| `GET, PUT, DELETE /api/v1/data/{extension}/{collection}/{id}` | signed in, with an organization | one document; `PUT` with `If-Match: <version>` answers 409 if it changed since; a document of a team needs the level `view` to read and `edit` to change or delete (403) |
| `GET /api/v1/extension-assets/{id}/{path}` | anyone | web files of active extensions |
| `GET /api/v1/extensions` | `platform-admin` | every extension found, with status, problems and publisher |
| `POST /api/v1/extensions/packages` | `platform-admin` | install an uploaded package (`application/zip`); 202, active at once or at the next start (`restartRequired`) |
| `DELETE /api/v1/extensions/{id}` | `platform-admin` | remove an installed extension: its package goes to `extensions/.previous`, its schema and data stay; at once without Java code nor schema, else at the next start (`restartRequired`); 409 naming the active extensions that require it (MK-132) |
| `GET /api/v1/files/signed/{organization}/{extension}/named/{name}?prefix=&team=&expires=&creator=&signature=` | anyone with the link | the newest file of that name under a signed link to a prefix; 404 as for a link to one file, and when the name does not start with the prefix or the file is of another scope than the link; a file attached to a resource only while the person who made the link holds a level on it, files without a resource as the scope of the link |
| `GET /api/v1/files/signed/{organization}/{extension}/{id}?expires=&creator=&signature=` | anyone with the link | the content of the file of a signed link, as `GET /api/v1/files/{extension}/{id}/content` serves it (ranges, cache validators); 404, the same for every refusal, when the link expired or was altered, the file is no longer there, or the person who made the link (`creator`, absent for a link made without a person) no longer reads it: out of the organization, or without a level on the resource of the file (MK-055). Its first use in each hour is audited |
| `GET /api/v1/files/{extension}` | signed in, with an organization | the files of an active extension that the person reads, newest first: of the organization and of their teams, or with `team` of that team of theirs only (`offset`, `limit`); a file attached to a resource only when the person holds a level on it (MK-055) or stored the file (MK-041) |
| `POST /api/v1/files/{extension}?name=` | signed in, with an organization | store a file: the body is the content, streamed, `Content-Type` its media type, `name` its name or a path such as `tiles/3/4/2.png`; with `team`, shared with that team of the person only; with `resource=<type>/<id>`, attached to a registered resource of the extension (MK-054), on which the person holds a level that edits (400 as unregistered without a level, 403 with one that does not edit); 201 with its metadata, 413 beyond `mosaikit.files.max-size` (audited) |
| `POST /api/v1/files/{extension}/links` | signed in, with an organization: for a file, the people who read it; for a prefix, the people of the team, or of the organization without `team` (not its guests) | make a signed, expiring link (MK-093): `{"file": <id>}`, or `{"prefix": "tiles/", "team"?: <id>}` for every file whose name starts with the prefix (empty for every file); `expires` at most `mosaikit.files.link-max-validity` from now, the longest when absent. 201 with `url`, `base`, `query` and `expires`: a file under a prefix is at `base + name + "?" + query`; a link made by a person carries their account (`creator`) and serves only what they still read: a file attached to a resource while they hold a level on it (MK-055), nothing once they left the organization; 503 when the installation has no key for links (audited) |
| `GET /api/v1/files/{extension}/{id}` | signed in, with an organization: its people for a file of the organization, the people of its team for a file of a team; for a file attached to a resource, who stored it and the people with a level on the resource (MK-055) | its metadata: `name`, `contentType`, `size`, `checksum` (SHA-256), `owner`, `team`, `resource`, `createdAt`, `updatedAt` |
| `DELETE /api/v1/files/{extension}/{id}` | its owner, an owner of its team, the administrators of the organization; for a file attached to a resource, its owner and the people with a level that edits the resource (its owner and administrators included, MK-055) | delete a file (audited) |
| `GET /api/v1/files/{extension}/{id}/content` | signed in, with an organization: its people for a file of the organization, the people of its team for a file of a team; for a file attached to a resource, who stored it and the people with a level on the resource (MK-055) | its content, streamed: one `Range` of bytes (206, or 416), `If-Range`, `If-None-Match` and `If-Modified-Since` (304); `ETag` is the checksum. Shown inline only for types a browser does not run, otherwise as an attachment, always with `nosniff` and a sandbox policy |
| `GET /api/v1/identity/sign-in-options` | anyone | how a person signs in |
| `WS /api/v1/live` (WebSocket) | signed in | the real-time channel (MK-031): `?organization=<slug>`; send `{"type": "subscribe", "topic": "…"}`, receive `subscribed`, `refused` or `{"type": "event", "topic", "data"}`; closed with code `4401` when its session ends (MK-125) |
| `GET /api/v1/marketplace` | `platform-admin` | the catalogs and what they offer, compared with what is installed (MK-022) |
| `POST /api/v1/marketplace/installations` | `platform-admin` | install a package of a catalog (`source`, `id`, `version`); 202, active at once or at the next start (`restartRequired`) |
| `POST /api/v1/marketplace/operations` | `platform-admin` | install several packages of the catalogs together (`installations`: `source`, `id`, `version` each), every one or none; 202 with the `installations`; 409 naming a required extension missing or out of its range, or the dependents an update would break (MK-132) |
| `GET, POST /api/v1/notifications` | signed in, with an organization | the activity feed of the person (`unread`, `notifications`, newest first); notify people of the organization as an extension (`extension`, `to` email addresses, `kind`, `title`, `body`, `link`): 202 (MK-038) |
| `POST /api/v1/notifications/read` | signed in, with an organization | mark every notification of the person as read |
| `POST /api/v1/notifications/{id}/read` | signed in, with an organization | mark a notification of the person as read |
| `GET, POST /api/v1/organizations` | `platform-admin` | list and create organizations (with `federation`, their realm) |
| `GET /api/v1/organizations/{slug}` | `platform-admin` | one organization |
| `POST /api/v1/organizations/{slug}/accounts` | the administrators of the organization, signed in to it, `platform-admin` | create a local account without password (MK-048): `email`, `displayName`, `roles`; 201 with `member`, `mailed`, `link` (returned this once when the installation sends no mail, `null` when mailed) and `expiresAt`; 409 when the address has an account (audited) |
| `POST /api/v1/organizations/{slug}/accounts/{email}/password-link` | the administrators of the organization, signed in to it, for people of no other organization; `platform-admin` | a new link to set the password of a member without one, which replaces the previous; the same answer as creating the account; 409 when the password is set (audited) |
| `GET, PUT /api/v1/organizations/{slug}/apps` | the administrators of the organization, `platform-admin` | the apps of its app bar: `enabled`, `pinned`, `restricted` (only who holds the `permission` of the app, `<extension>:use-<app>`, sees it; MK-056), in order; `roles` is deprecated (`[organization-admin]` is `restricted`); `PUT []` goes back to the defaults (audited) |
| `GET /api/v1/organizations/{slug}/audit-events` | the administrators of the organization, signed in to it, `platform-admin` | the audit events of the organization only, newest first, each with its `channel` (`WEB`, `API_KEY`, `JOB`, `ASSISTANT`, `EXTENSION`), `index` in the chain, `previousHash` and `hash`; filters `actor`, `action` (exact, or a prefix ending with a dot or a colon such as `permissions.` or `dev.example.dashboards:`), `subject`, `channel`, `from` and `to` (times such as `2026-10-13T08:00:00Z`), `offset`, `limit` (up to 500) (MK-059) |
| `GET, PUT /api/v1/organizations/{slug}/audit-events/retention` | the administrators of the organization, signed in to it, `platform-admin` | the retention of the entries of the organization, as for the platform (audited) |
| `GET /api/v1/organizations/{slug}/audit-events/verification` | the administrators of the organization, signed in to it, `platform-admin` | verify the chain of the organization, as for the platform (MK-059) |
| `PUT /api/v1/organizations/{slug}/identity` | `platform-admin` | realm, email domains and sign-in policy of an organization |
| `GET /api/v1/organizations/{slug}/members` | `platform-admin`, the administrators of the organization signed in to it | the members of an organization |
| `PUT /api/v1/organizations/{slug}/members/{email}` | `platform-admin`; the administrators of the organization signed in to it, for people already members | add a person or change their roles (`roles`, `displayName`): `platform-admin` only; signed in to the organization, also `profile` and `teams`, with what `.../permissions/preview` shows (MK-056); all or nothing (audited) |
| `DELETE /api/v1/organizations/{slug}/members/{email}` | `platform-admin` | remove a person |
| `GET /api/v1/organizations/{slug}/permissions` | the administrators of the organization, signed in to it | the permissions declared by the active extensions: `id` (`<extension>:<permission>`), `extension`, `extensionName`, `name`, `title`, `description`, `i18n`, `off` when all the apps of the extension are off, and `app` for the permission of an app, `use-<app>` (MK-056) |
| `GET /api/v1/organizations/{slug}/permissions/members/{email}` | the administrators of the organization, signed in to it | what a member holds and why: `standing`, `profile`, `profileAssigned`, `exceptions`, and `permissions` with their `sources` (`administrator`, `profile`, `team`, `exception`), `granted` and `withheld` (`apps-off`) |
| `PUT, DELETE /api/v1/organizations/{slug}/permissions/members/{email}/exceptions/{permission}` | the administrators of the organization, signed in to it | grant or revoke a permission to a member as a personal exception (audited) |
| `PUT /api/v1/organizations/{slug}/permissions/members/{email}/profile` | the administrators of the organization, signed in to it | assign a profile to a member (`{"profile": "<id>"}`), or `null` for the default profile (audited); not to guests |
| `POST /api/v1/organizations/{slug}/permissions/preview` | the administrators of the organization, signed in to it | what a proposed member would hold (`role`, `profile`, `teams`), with the sources, without changing anything: for invitations |
| `GET, POST /api/v1/organizations/{slug}/permissions/profiles` | the administrators of the organization, signed in to it | the profiles with their `permissions`; create one (`name`, `description`, `defaultForRole` `organization-user` or none, `permissions`) (audited) |
| `GET, PUT, DELETE /api/v1/organizations/{slug}/permissions/profiles/{id}` | the administrators of the organization, signed in to it | one profile; replace its name, description, default role and permissions; delete it, its members going back to the default profile (audited) |
| `GET /api/v1/organizations/{slug}/permissions/teams/{id}` | the administrators of the organization, signed in to it | the permissions granted to a team |
| `PUT, DELETE /api/v1/organizations/{slug}/permissions/teams/{id}/{permission}` | the administrators of the organization, signed in to it | grant or revoke a permission to a team, for its members and guests (audited) |
| `GET /api/v1/organizations/{slug}/quotas` | the administrators of the organization, signed in to it; `platform-admin` | its measures (MK-076): `storage`, then those of the active extensions, each with `measure`, `label`, `unit`, `kind` (`counter` per month or `gauge`), `extension`, `limit` (`null` for none), `source` (`organization`, `installation` or `none`), `installationLimit`, `period` (this month for a counter, `null` for a gauge) and `used`, current at every call |
| `GET /api/v1/organizations/{slug}/quotas/usage?period=` | the administrators of the organization, signed in to it; `platform-admin` | its consumption by measure and person: the counters of a month (`period`, such as `2026-10`, this month by default) and the gauges now, as `rows` of `measure`, `period`, `person` (`id`, `name`, `email`, or `null` for none or a person who left), `amount`, `updatedAt`; `periods` lists the months with consumption |
| `GET, PUT, DELETE /api/v1/organizations/{slug}/quotas/{measure}` | reading: the administrators of the organization, signed in to it, and `platform-admin`; changing: `platform-admin` | one measure; set its limit for the organization (`{"limit": n}` in its unit, bytes for `storage`, per month for a counter; `{"limit": null}` for none), over the default of the installation (`mosaikit.quotas.*`); remove it, back to the default (audited) |
| `GET, POST /api/v1/organizations/{slug}/secrets` | the administrators of the organization, signed in to it | the credentials that its extensions use (MK-062), without their values: `name`, `kind`, `description`, `extension`, `hint` (`••••`, or the last four characters of a long token or key), `createdAt`, `updatedAt`, `updatedBy`; store one (`name`, `kind` `password`, `token`, `key` or `other`, `value`, `description`, and `extension` when only that extension may read it), encrypted at once (audited); 503 when the installation has no master key |
| `GET, PUT, DELETE /api/v1/organizations/{slug}/secrets/{name}` | the administrators of the organization, signed in to it | one credential, without its value; replace it (`kind`, `description`, `extension`, and `value`, kept when absent; the name does not change); delete it (audited) |
| `GET /api/v1/platform/accounts/suspended` | `platform-admin` | the suspended accounts, the most recently suspended first, each as below (MK-125) |
| `GET /api/v1/platform/accounts/{email}/suspension` | `platform-admin` | whether an account is suspended: `accountId`, `username`, `displayName`, `suspended`, and while it is `suspendedAt`, `suspendedBy` and `reason` (MK-125) |
| `PUT, DELETE /api/v1/platform/accounts/{email}/suspension` | `platform-admin` | suspend an account, which ends all its sessions and "remember me" tokens, revokes its access keys and refuses every sign-in, with an optional `{"reason": "…"}` (at most 500 characters, kept until reactivation and in the audit log; an account already suspended keeps its first reason), or reactivate it; not one's own account (MK-125, audited) |
| `GET /api/v1/platform/content-security-policy` | `platform-admin` | the external origins that the browser may contact for images, data and tiles (MK-128): `enabled` (whether the kernel sends the policy), `policy` (the header it sends) and `origins`, each with `origin`, `source` (`CONFIGURATION` for `mosaikit.content-security-policy.allowed-origins`, `ADMINISTRATION`), `addedAt` and `addedBy` |
| `POST /api/v1/platform/content-security-policy/origins` | `platform-admin` | allow an external origin, `{"origin": "https://tiles.example.org"}`: `scheme://host[:port]` with `https`, `wss`, `http` or `ws`, at most one leading `*.`, no path; added to `connect-src` and `img-src` only; 400 for anything else, 409 when already allowed (audited) |
| `DELETE /api/v1/platform/content-security-policy/origins` | `platform-admin` | stop allowing an origin that an administrator added, `?origin=<origin>`; 409 for an origin of the configuration (audited) |
| `GET, POST /api/v1/platform/credentials` | `platform-admin` | the credentials of the installation (MK-127), which extensions read with `Secrets.resolve` in every organization that has none with the same name, and outside organizations: the same view as those of an organization, without values; store one, with the same fields, encrypted at once (audited in the log of the platform); 503 when the installation has no master key |
| `GET, PUT, DELETE /api/v1/platform/credentials/{name}` | `platform-admin` | one credential of the installation, without its value; replace it (`kind`, `description`, `extension`, and `value`, kept when absent); delete it (audited) |
| `POST /api/v1/platform/files/clean-up` | `platform-admin` | remove from the store the contents of files queued for removal at least `mosaikit.files.removal-retention` before (#102): `{"removed", "bytes", "failed", "kept", "reasons"}`; 503, removing nothing, when the store does not hold the newest files the database records (audited in the log of the platform) |
| `GET /api/v1/platform/files/removals` | `platform-admin` | the contents of files waiting to leave the store (`files`, `bytes`, `due`, `dueBytes`, `retention`) and the files that extensions no longer installed left (`uninstalled`: `extension`, `files`, `bytes`, `queued`) |
| `POST /api/v1/platform/files/removals/extensions/{extension}` | `platform-admin` | queue the files of an uninstalled extension, in every organization, for the clean-up after the retention, which keeps them if the extension is installed again: `{"extension", "files", "bytes", "removableFrom"}`; 409 while it is installed or no extension is, 404 when it has no files (audited) |
| `GET /api/v1/platform/secrets/keys` | `platform-admin` | the master keys of the store of credentials: `enabled`, `problem` when disabled, `currentKey` and `previousKeys` (identifiers, never keys), and `credentials`, how many each key holds in every organization and in the installation (MK-062, MK-127) |
| `POST /api/v1/platform/secrets/re-encryption` | `platform-admin` | after a rotation, encrypt the data key of every credential under the current master key, without decrypting the values: `{"reEncrypted", "unreadable", "currentKey"}` (audited) |
| `GET, POST /api/v1/platform/service-identities` | `platform-admin` | the service identities (MK-124): `identities`, each with `id`, `name`, `description`, `apis`, `endpoints`, `organizations` (slugs), `createdAt`, `createdBy` and its live `keys` (`id`, `prefix`, `createdAt`, `lastUsedAt`), with the `endpoints` that can be given and `maxKeys`; create one (`{"name", "description"?, "apis": ["<api>"], "endpoints"?: ["check-session", "check-key"], "organizations"?: ["<slug>"]}`): 201 with its first key and its `secret`, shown this once; 409 when the name is taken (audited) |
| `PUT /api/v1/platform/service-identities/{id}` | `platform-admin` | change the `description`, `apis`, `endpoints` and `organizations` of an identity; its next call follows them (audited) |
| `POST /api/v1/platform/service-identities/{id}/keys` | `platform-admin` | a new key for an identity, to rotate the old one, which goes on until revoked: 201 with its `secret`, shown this once; 409 when the identity already has two live keys (audited) |
| `DELETE /api/v1/platform/service-identities/{id}/keys/{key}` | `platform-admin` | revoke a key of an identity: its next call is refused; 404 when it is not a live key of the identity (audited) |
| `GET, PUT /api/v1/platform/settings` | `platform-admin` | the settings of the platform: `{"registration": true}` turns self-registration on or off (audited) |
| `POST /api/v1/services/check` | a service identity given `check-session` or `check-key` | check the credentials of a person for a service (MK-124): `{"session": "<cookie value>", "organization"?: "<slug>"}` or `{"key": "mk_..."}`; 200 with `kind` (`session` or `key`), the `account`, the `organization` (or `null`), the `roles` there now and, for a key, the `key`; 401 when they open nothing; 403 without the endpoint |
| `DELETE /api/v1/sharing/grants/{grant}` | who may share the resource | revokes a grant or a link |
| `POST /api/v1/sharing/links/open` | anyone | opens a link with its token and password: the resource, the level and the `shared.view` element of the extension that shows it (`view`), `404` when unknown, expired or revoked, `403` when the password is wrong; every use is audited |
| `GET /api/v1/sharing/resources/{extension}/{type}/{id}` | signed in | a registered resource with its owner (`ownerName`), the level of the request on it (the one `Sharing.level` gives the extension, also through the resources above it for a type that inherits, MK-136) and whether the person may share it (MK-055); 404 without a level |
| `GET /api/v1/sharing/resources/{extension}/{type}/{id}/grants` | who may share the resource | its grants, links included, with the names of their subjects |
| `PUT /api/v1/sharing/resources/{extension}/{type}/{id}/grants` | who may share the resource | grants a level to a person (`subject.id`, or `subject.email` of a person of the organization), a team, the organization or the public; granting again replaces the level |
| `GET /api/v1/sharing/resources/{extension}/{type}/{id}/inherited` | who may share the resource | for a type that declares `inherits: parent`, the accesses that come from each resource above it, from the parent upwards: the resource, its owner, the levels of its type and its grants (MK-136) |
| `POST /api/v1/sharing/resources/{extension}/{type}/{id}/links` | who may share the resource | creates a link with a level, an expiry within `mosaikit.sharing.link-max-validity` and an optional password; the token is returned once |
| `GET /api/v1/shell/apps` | signed in | the apps the person sees in the app bar, in order, with the pinned ones (MK-030); a restricted app, and any app for a guest, only when the person holds its permission (MK-056) |
| `GET /api/v1/shell/extensions` | signed in | frontends of the active extensions, for the shell; not those turned off for the organization of the request, nor what they contribute to other extensions (MK-030, MK-035) |
| `GET /api/v1/shell/extensions/active` | signed in | every extension active in the organization of the request, with its version: installed, compatible and not turned off there (MK-133); in the installation without an organization; kept current by the real-time topic `extensions` |
| `GET /api/v1/shell/extensions/revision` | signed in | changes when the watched extensions directory changes (`mosaikit.extensions.watch`); 204 without a body when it is not watched |
| `GET /api/v1/shell/permissions` | signed in | the permissions of the person in the organization of the request, as `<extension>:<permission>` (MK-056); empty without an organization; a hint for the interface, the backends check |
| `GET /api/v1/system/info` | anyone | product, version, active extensions, theme |
| `GET /api/v1/system/themes` | anyone | the themes of the active theme extensions (MK-028): id, title, font, radius, light and dark colors |
| `GET, POST /api/v1/teams` | signed in, with an organization | the teams the person sees (theirs and, unless a guest, the public ones), with their `role`; create one (`name`, `description`, `visibility` `public` or `private`), owned by the person (MK-032, audited); with `parent`, the groups of a team in which the person is, or a new group, always private, such as a private channel (MK-034); with `kind=chat`, the chats of the person with their people, newest first, or a new chat (`kind: chat`, `people`, optional `name`), the same one between two people (MK-036) |
| `GET, PUT, DELETE /api/v1/teams/{id}` | signed in, with an organization | one team with its `members`; change or delete it: its owners and the administrators of the organization |
| `PUT, DELETE /api/v1/teams/{id}/members/{email}` | signed in, with an organization | add a person with a `role` (`owner`, `member`, or `guest` for a person of another organization) or change it: the owners; join a public team as `member`, or leave a team: the person (audited) |
| `GET /mcp` | signed in | answers 405: the MCP server opens no event stream of its own |
| `POST /mcp` | signed in, with an organization | MCP server with the same tools |

## Tools for assistants and MCP

Each action of an active extension is a tool named `<api>__<action>`, for example
`sample-notes__create-note`. The body of an invocation is the arguments, checked against the input
schema of the action (400 with one error per field otherwise):

```http
POST /api/v1/ai/tools/sample-notes__create-note/invocations
Authorization: Basic ...
X-Mosaikit-Organization: acme
Content-Type: application/json

{"text": "Call the supplier"}
```

A `read` tool answers `{"outcome": "executed", "result": {"status": 200, "body": ...}}`. A
`write` or `execute` tool answers 202 with `{"outcome": "drafted", "draft": {...}}`: nothing
changes until the same person confirms the draft within 15 minutes. The kernel calls the extension
with the credentials of the request, so the extension checks the permissions of the person.

MCP clients connect to `https://<host>/mcp` with the same credentials and the
`X-Mosaikit-Organization` header, and use `initialize`, `build/list` and `build/call`. The server
answers JSON (no event stream), refuses browser requests from another origin and returns drafts
for the tools that change data.

## Errors

Errors are problem details (RFC 9457, `application/problem+json`), without stack traces or
internal messages:

```json
{
  "type": "about:blank",
  "title": "Invalid request",
  "status": 400,
  "detail": "Correct the listed fields and retry.",
  "errors": [{ "field": "slug", "message": "use lowercase letters, digits and inner hyphens" }]
}
```

| Status | When |
|---|---|
| `400` | validation failed; `errors` lists the fields |
| `401`, `403` | not signed in, or not allowed; `403` with the title `Quota exceeded` when the action passes a limit of the organization (MK-076), named in `detail` and in the member `quota`: `measure`, `unit`, `period`, `limit`, `used`, `requested` |
| `404` | not found, or an API of an extension that is not active |
| `409` | conflict, for example a slug, an email domain or a realm already in use |
| `413` | the content is too large, such as a file over `mosaikit.files.max-size` |
| `503` | a service the request needs (Keycloak, the store of files) cannot be reached |

## Versioning

`/api/v1` changes only by addition: new endpoints, new optional fields. Clients ignore fields
they do not know. A breaking change becomes `/api/v2`, with both versions served for a release
cycle.
