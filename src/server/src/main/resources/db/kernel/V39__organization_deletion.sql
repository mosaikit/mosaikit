-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-130: a platform administrator deletes an organization. Deleting it marks it: from then on it
-- appears nowhere, its people lose access, and its data, with those of its extensions, stay until
-- removable_from, set at the deletion from mosaikit.organizations.removal-retention. A job of the
-- kernel then removes the organization, which deletes its kernel data (on delete cascade) and queues
-- the content of its files for the clean-up of the store (V36).
--
-- The check keeps every deleted organization for a day at least, whatever the code or a setting
-- says: a mistake can still be undone, and nothing is removed the moment it is deleted.

alter table organization add column deleted_at timestamptz;
alter table organization add column deleted_by varchar(255);
alter table organization add column removable_from timestamptz;

alter table organization add constraint organization_deletion_ck check (
    (deleted_at is null and deleted_by is null and removable_from is null)
    or (deleted_at is not null and deleted_by is not null
        and removable_from >= deleted_at + interval '1 day'));

create index organization_removable_ix on organization (removable_from) where deleted_at is not null;

-- The published views (MK-123) leave out deleted organizations, and what belongs to them: an external
-- service that reads the roles of a person no longer finds them there. Same names and columns as in
-- V21 and V33, so the contract does not change.

create or replace view mk_published.organization with (security_barrier) as
select o.id,
       o.slug,
       o.name
from organization o
where o.deleted_at is null;

create or replace view mk_published.membership with (security_barrier) as
select m.account_id,
       m.organization_id,
       array_remove(string_to_array(m.roles, ','), '')::text[] as roles
from organization_member m
join organization o on o.id = m.organization_id
where o.deleted_at is null;

create or replace view mk_published.team with (security_barrier) as
select t.id,
       t.organization_id,
       t.parent_id,
       t.name
from team t
join organization o on o.id = t.organization_id
where t.kind = 'team'
  and o.deleted_at is null;

create or replace view mk_published.team_member with (security_barrier) as
select m.team_id,
       m.account_id,
       m.role
from team_member m
join team t on t.id = m.team_id
join organization o on o.id = t.organization_id
where t.kind = 'team'
  and o.deleted_at is null;

create or replace view mk_published.permission_holder with (security_barrier) as
with held as (
    select g.organization_id,
           g.extension_id,
           g.permission,
           'profile'::varchar as source,
           m.account_id,
           null::uuid as team_id
    from organization_member m
    left join member_profile mp
           on mp.organization_id = m.organization_id and mp.account_id = m.account_id
    left join permission_profile d
           on d.organization_id = m.organization_id and d.default_for_role = 'organization-user'
    join permission_grant g
           on g.organization_id = m.organization_id and g.profile_id = coalesce(mp.profile_id, d.id)
    where 'organization-user' = any (string_to_array(m.roles, ','))
      and not 'organization-admin' = any (string_to_array(m.roles, ','))
    union all
    select g.organization_id, g.extension_id, g.permission, 'exception'::varchar, g.account_id, null::uuid
    from permission_grant g
    where g.account_id is not null
    union all
    select g.organization_id, g.extension_id, g.permission, 'team'::varchar, null::uuid, g.team_id
    from permission_grant g
    where g.team_id is not null
)
select h.organization_id,
       h.extension_id,
       h.permission,
       h.source,
       h.account_id,
       h.team_id
from held h
where not exists (
    select 1
    from organization_app a
    where a.organization_id = h.organization_id and a.extension_id = h.extension_id
    group by a.organization_id, a.extension_id
    having not bool_or(a.enabled))
  and exists (
    select 1
    from organization o
    where o.id = h.organization_id and o.deleted_at is null);
