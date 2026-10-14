-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-123, MK-056: who holds the permissions of extensions, published for services outside the kernel
-- that translate them into rules of their own, next to the views of V21 and with the same contract
-- (docs/development/published-views.md, PublishedViewsTest pins the columns).
--
-- One row for each way a permission reaches someone: a profile (the one assigned to a member, or
-- else the default profile of their role; never to a guest nor to an administrator), a personal
-- exception, or a team, whose people hold it as they are in mk_published.team_member. The
-- administrators of an organization hold every permission, whether a row names them or not. An extension whose apps the organization turned all off
-- (MK-030) gives no permission, so its rows are left out; the kernel also removes at start the grants
-- of permissions that the extensions no longer declare.

create view mk_published.permission_holder with (security_barrier) as
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
    having not bool_or(a.enabled));

comment on view mk_published.permission_holder is
    'Who holds the permissions of extensions: by profile or exception (account_id) or team (team_id)';
