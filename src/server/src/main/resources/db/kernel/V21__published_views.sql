-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-123: read-only views of people, organizations, memberships and teams for services outside the
-- kernel, such as a map server that reads the roles of a person from the database. They are a
-- contract: their names and columns stay the same across releases, and a change is a breaking change
-- of the platform (docs/development/published-views.md, PublishedViewsTest pins them).
--
-- The views live in their own schema, owned by the owner of the kernel. They run with the rights of
-- their owner, so they read the kernel tables whatever the reader may do; the reader role of the
-- installation (mk_<database>_reader, created at start by PublishedViews) gets USAGE on this schema
-- and SELECT on its views, and nothing on the kernel schema. security_barrier keeps the filters of a
-- view (chats are not teams) evaluated before any function of the query of the reader.
--
-- Plain views, not materialized: a change made through the API is read at once.

create schema if not exists mk_published;

create view mk_published.account with (security_barrier) as
select a.id,
       a.username,
       a.display_name,
       a.suspended_at is null as active
from user_account a;

create view mk_published.organization with (security_barrier) as
select o.id,
       o.slug,
       o.name
from organization o;

create view mk_published.membership with (security_barrier) as
select m.account_id,
       m.organization_id,
       array_remove(string_to_array(m.roles, ','), '')::text[] as roles
from organization_member m;

create view mk_published.team with (security_barrier) as
select t.id,
       t.organization_id,
       t.parent_id,
       t.name
from team t
where t.kind = 'team';

create view mk_published.team_member with (security_barrier) as
select m.team_id,
       m.account_id,
       m.role
from team_member m
join team t on t.id = m.team_id
where t.kind = 'team';

comment on schema mk_published is
    'Mosaikit published views (MK-123): a stable, read-only contract for external services';
comment on view mk_published.account is 'Accounts of the installation: id, username (e-mail), display name, active';
comment on view mk_published.organization is 'Organizations: id, slug, name';
comment on view mk_published.membership is 'Memberships: account, organization, kernel roles in it';
comment on view mk_published.team is 'Teams and groups of teams (parent_id), never chats';
comment on view mk_published.team_member is 'People of a team with their role: owner, member or guest';
