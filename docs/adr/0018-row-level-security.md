# 0018. Row-level security of the data of organizations

- Status: accepted
- Date: 2026-09-30
- Deciders: Massimo Antonini
- Extends [ADR-0016](0016-membership-of-several-organizations.md); prototype spike S3

## Context and problem statement

Since MK-017 every request acts on one organization, and plugins are asked to filter their queries
on it. A plugin that forgets one `where` clause, or a third-party plugin that does not care,
would show the data of every organization. The separation of organizations must not depend on the
care of each plugin (C-28 of the compliance matrix).

## Decision

- Kernel migration V5 defines `mk_kernel.current_organization()`, the organization of the
  connection (`mosaikit.organization` setting), null when there is none.
- Plugin tables that hold data of organizations enable row-level security with a policy on it:

  ```sql
  alter table note enable row level security;
  create policy note_organization on note
      using (organization_id = mk_kernel.current_organization())
      with check (organization_id = mk_kernel.current_organization());
  ```

- At start, after the migrations, the kernel creates the member role of the installation
  (`mk_<database>_member`, no login, owner of nothing), grants it to the database user and gives it
  the data rights on the kernel schema and on each plugin schema.
- A pool interceptor (`OrganizationConnections`) makes every connection handed out during a
  request run as that role, with the organization of the request; the connection goes back to the
  pool as the owner, without organization. Outside requests (start, Flyway), connections are the
  owner, which policies do not restrict.
- `mosaikit.database.row-security=false` turns it off, with a warning, for a database where the
  user may not create or use a role.

## Consequences

- A query without filter, a native query, a report or a join of a plugin sees only the rows of the
  organization of the request; a request without organization sees none; a row of another
  organization cannot be written (`RowSecurityTest`).
- The database user needs `CREATEROLE` once, or a role created by the database administrator.
  Superusers (the portable distribution, the Docker image of PostgreSQL) have it.
- Two statements run at each lease and return of a connection.
- Jobs outside requests see every row: they must set the organization themselves (to come with
  scheduled jobs of plugins).
- Kernel tables are not under row-level security: the kernel filters its own queries and keeps
  cross-organization tables (accounts, memberships, audit).

### Refined on 2026-10-13

The audit log (`audit_event`) is now under row-level security, and the request role may only insert
and read it (MK-059). The registry of resources, the grants of sharing and the permissions of
profiles, teams and members (MK-054, MK-055, MK-056) are kernel tables under row-level security too.

## Alternatives considered

- **A schema per organization.** Strong separation, but one migration per organization and plugin,
  and cross-organization features (a person in several organizations) become joins across
  schemas.
- **Hibernate filters.** They cover only the queries of Hibernate, not native SQL, and plugins can
  disable them.
- **`force row level security` on the owner.** It would also restrict migrations and the kernel at
  start, which must see every row.
