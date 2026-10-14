# Published views

Services that apply the decisions of the platform by themselves, such as a map server that reads
the roles of a person from a database, need to know who belongs to which organization and team. The
kernel publishes read-only views of people, organizations, memberships, teams and the holders of
permissions for them (MK-123), so that they read a contract instead of the internal tables of the
kernel, which change in any release. How an administrator gives a service a login on them is in the
[administration guide](../guide/administration.md#published-views-for-external-services).

The Java code of an extension does not need them: it reads the same people and teams of its
organization through the `People` bean of `kernel-api`, without a database login (see the
[extension guide](extension-development.md#people-and-teams-of-the-organization)).

## The contract

The views are in schema `mk_published` of the database of the installation. They are plain views:
a change made through the API is read at once.

### `mk_published.account`

Every account of the installation.

| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid` | identifier of the account |
| `username` | `varchar` | the e-mail address with which the person signs in, in lower case |
| `display_name` | `varchar` | the name shown for the person |
| `active` | `boolean` | `false` while a platform administrator suspends the account |

### `mk_published.organization`

| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid` | identifier of the organization |
| `slug` | `varchar` | the short name in addresses (`acme`) |
| `name` | `varchar` | the name shown |

### `mk_published.membership`

One row for each person in each organization of theirs.

| Column | Type | Meaning |
|---|---|---|
| `account_id` | `uuid` | the person |
| `organization_id` | `uuid` | the organization |
| `roles` | `text[]` | the kernel roles of the person in it: `organization-admin`, `organization-user`, `organization-guest` |

### `mk_published.team`

The teams of organizations and the groups of teams; never the chats between people.

| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid` | identifier of the team |
| `organization_id` | `uuid` | the organization of the team |
| `parent_id` | `uuid` | the team of a group, null for a team |
| `name` | `varchar` | the name shown |

### `mk_published.team_member`

| Column | Type | Meaning |
|---|---|---|
| `team_id` | `uuid` | the team |
| `account_id` | `uuid` | the person |
| `role` | `varchar` | `owner`, `member` or `guest` |

### `mk_published.permission_holder`

Who holds the permissions that extensions declare (MK-056): one row for each way a permission
reaches someone.

| Column | Type | Meaning |
|---|---|---|
| `organization_id` | `uuid` | the organization |
| `extension_id` | `varchar` | the extension that declares the permission (`dev.example.maps`) |
| `permission` | `varchar` | the name of the permission in the manifest (`edit-layer`) |
| `source` | `varchar` | `profile`, `exception` or `team` |
| `account_id` | `uuid` | the person, for `profile` and `exception`; null for `team` |
| `team_id` | `uuid` | the team or group, for `team`, whose people in `team_member` hold it; null otherwise |

- `profile` rows are the members whose profile grants the permission: the profile assigned to them,
  or else the default profile of members. Guests never get a profile, and administrators have no
  `profile` rows.
- **The administrators of an organization hold every permission**, whether a row names them or not:
  add the people whose `membership.roles` contain `organization-admin`.
- The rows of an extension whose apps the organization turned all off are left out, since it gives
  no permission then; the kernel removes at start the grants of permissions that the extensions no
  longer declare. A permission of an extension that is installed but not active is still listed:
  the Java API `PermissionHolders` applies every rule of the kernel and is the reference.

Nothing else of an account is published: no password hash, secret, session, preference or federated
subject.

## Example

The roles of a person, for a service whose roles are the identifiers of organizations and teams:

```sql
select m.organization_id::text as role
from mk_published.membership m
join mk_published.account a on a.id = m.account_id
where a.username = ? and a.active
union
select t.team_id::text
from mk_published.team_member t
join mk_published.account a on a.id = t.account_id
where a.username = ? and a.active;
```

The people who hold a permission in an organization, also through a team, administrators included:

```sql
select h.account_id from mk_published.permission_holder h
where h.organization_id = ? and h.extension_id = ? and h.permission = ? and h.account_id is not null
union
select m.account_id from mk_published.permission_holder h
join mk_published.team_member m on m.team_id = h.team_id
where h.organization_id = ? and h.extension_id = ? and h.permission = ?
union
select m.account_id from mk_published.membership m
where m.organization_id = ? and 'organization-admin' = any (m.roles);
```

## Rights

- The views are owned by the owner of the kernel and run with its rights: the base tables are not
  under row-level security, and the policies of ADR-0018 never restrict their owner, so a view
  always shows every row.
- The installation creates the role `mk_<database>_reader` (no login) at each start, with `USAGE` on
  `mk_published` and `SELECT` on its views, and nothing else: no right on the kernel schema, on the
  schemas of extensions nor on their functions (such as `mk_kernel.allows`). A login that holds
  that role cannot write the views nor create anything in their schema.
- The views are `security_barrier`: their filters (a chat is not a team) run before any function in
  the query of the reader.
- Like every login, the reader sees the system catalogs of PostgreSQL (names of tables and columns),
  never their data.

## Stability

The names of the views, and the names, order and types of their columns, stay the same across
releases. `PublishedViewsTest` pins them: a change fails the build.

- Adding a view, or a column at the end of a view, is compatible: it is listed under *Added* in the
  changelog, here, and in the test.
- Renaming or removing a view or a column, or changing the type or meaning of a column, is a
  **breaking change of the platform**: it is announced in `CHANGELOG.md` as a breaking change, in a
  major release, with what services must change; this page and the test change with it.
