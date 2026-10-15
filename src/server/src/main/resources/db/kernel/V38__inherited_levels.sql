-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-136 on MK-054 and MK-055: a level on a resource reaches the resources inside it, when their type
-- declares it in the manifest (inherits: parent). The level of a person on such a resource is the
-- highest of their own and of their level on each resource above it, following the parent of the
-- registry (V16) as long as the type of each resource on the way inherits. A level held above counts
-- as the highest level of the type below whose name the type above declares and that the level held
-- includes, as ResourceTypeEntry.carried() decides in Java. The kernel writes in sharing_level which
-- types inherit, as it writes their levels; the functions below follow the parents with a recursive
-- query, so that a list filtered with allows() reads each chain in the database.
--
-- Types that do not declare it keep the answers of V28 and V29: their chain is the resource alone.

alter table sharing_level add column inherits boolean not null default false;

-- A resource (depth 0) and the resources above it whose levels reach it: the parent of each resource
-- of the chain whose type inherits, within the same organization, at most 100 levels up (the registry
-- refuses a resource that contains itself; the bound keeps a query finite all the same). Security
-- invoker: under row-level security in the requests; as the owner of the tables in the functions that
-- are security definer.
create or replace function lineage(p_resource uuid)
    returns table (id uuid, extension_id varchar, type varchar, owner_id uuid, depth integer)
    language sql stable
    set search_path = mk_kernel, pg_temp
    as $$
    with recursive chain (id, organization_id, extension_id, type, owner_id, parent_id, depth) as (
        select r.id, r.organization_id, r.extension_id, r.type, r.owner_id, r.parent_id, 0
        from resource r
        where r.id = p_resource
        union all
        select p.id, p.organization_id, p.extension_id, p.type, p.owner_id, p.parent_id, c.depth + 1
        from chain c
        join resource p on p.id = c.parent_id and p.organization_id = c.organization_id
        where c.depth < 100
          and exists (select 1 from sharing_level s
                      where s.extension_id = c.extension_id and s.type = c.type and s.inherits)
    )
    select c.id, c.extension_id, c.type, c.owner_id, c.depth from chain c $$;

-- As in V28, on the chain of the resource: the request holds p_level when, on the resource or on one
-- above it that reaches it, it holds a level of that resource's type at least as high as a level of
-- the same name that, on the resource, is p_level or above. On the resource itself that is p_level
-- or above, as before. Links are not considered: the Java API answers for them.
create or replace function allows(p_extension text, p_type text, p_ref_id text, p_level text)
    returns boolean
    language sql stable
    set search_path = mk_kernel, pg_temp
    as $$
    select exists (
        select 1
        from resource r
        join sharing_level needed
          on needed.extension_id = r.extension_id and needed.type = r.type and needed.level = p_level
        cross join lateral lineage(r.id) n
        join sharing_level carried
          on carried.extension_id = r.extension_id and carried.type = r.type and carried.rank >= needed.rank
        join sharing_level there
          on there.extension_id = n.extension_id and there.type = n.type and there.level = carried.level
        where r.organization_id = current_organization()
          and r.extension_id = p_extension and r.type = p_type and r.ref_id = p_ref_id
          and (
            (current_account() is not null and n.owner_id = current_account())
            or (current_administrator() and there.administrators)
            or exists (
                select 1
                from resource_grant g
                join sharing_level given
                  on given.extension_id = n.extension_id and given.type = n.type and given.level = g.level
                where g.resource_id = n.id
                  and case when g.subject_kind = 'public' then 0 else given.rank end >= there.rank
                  and (
                    g.subject_kind = 'public'
                    or (g.subject_kind = 'organization' and current_account() is not null and not current_guest())
                    or (g.subject_kind = 'person' and g.account_id = current_account())
                    or (g.subject_kind = 'group' and exists (
                            select 1 from team_member m
                            where m.team_id = g.team_id and m.account_id = current_account()))
                  )
            )
          )
    ) $$;

-- As in V29, on the chain of the resource: a signed link made by a person serves a file attached to a
-- resource while they hold a level on it, also through a resource above it; so removing a share on a
-- folder stops the links made through it at their next use.
create or replace function signed_link_reads(p_organization uuid, p_creator uuid, p_resource uuid)
    returns boolean
    language sql stable security definer
    set search_path = mk_kernel, pg_temp
    as $$
    with member as (
        select string_to_array(replace(m.roles, ' ', ''), ',') as roles
        from organization_member m
        where m.organization_id = p_organization and m.account_id = p_creator
    ),
    creator as (
        select 'organization-admin' = any (roles) as administrator,
               'organization-guest' = any (roles)
                   and not 'organization-user' = any (roles)
                   and not 'organization-admin' = any (roles) as guest
        from member
    )
    select exists (select 1 from creator)
       and (p_resource is null or exists (
            select 1
            from creator c
            cross join resource r
            cross join lateral lineage(r.id) n
            join sharing_level carried
              on carried.extension_id = r.extension_id and carried.type = r.type
            join sharing_level there
              on there.extension_id = n.extension_id and there.type = n.type and there.level = carried.level
            where r.id = p_resource and r.organization_id = p_organization
              and (
                n.owner_id = p_creator
                or (c.administrator and there.administrators)
                or exists (
                    select 1
                    from resource_grant g
                    join sharing_level given
                      on given.extension_id = n.extension_id and given.type = n.type and given.level = g.level
                    where g.resource_id = n.id
                      and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
                      and case when g.subject_kind = 'public' then 0 else given.rank end >= there.rank
                      and (
                        g.subject_kind = 'public'
                        or (g.subject_kind = 'organization' and not c.guest)
                        or (g.subject_kind = 'person' and g.account_id = p_creator)
                        or (g.subject_kind = 'group' and exists (
                                select 1 from team_member m
                                where m.team_id = g.team_id and m.account_id = p_creator))
                      )
                )
              )
        )) $$;

-- Whether a resource is below the resource of a live link, through types that inherit: a request
-- opened with a link to a folder, which has no organization yet, reaches what the folder holds. Security
-- definer, as shared_link(): the kernel calls it only for the link the request was opened with, after
-- checking it.
create or replace function link_reaches(p_grant uuid, p_extension text, p_type text, p_ref_id text)
    returns boolean
    language sql stable security definer
    set search_path = mk_kernel, pg_temp
    as $$
    select exists (
        select 1
        from resource_grant g
        join resource r
          on r.organization_id = g.organization_id
         and r.extension_id = p_extension and r.type = p_type and r.ref_id = p_ref_id
        cross join lateral lineage(r.id) n
        where g.id = p_grant and g.subject_kind = 'link'
          and g.revoked_at is null and g.expires_at > now()
          and n.id = g.resource_id and n.depth > 0
    ) $$;

-- Whether some resource of a type is below the resource of a live link, through types that inherit:
-- the same, for the lists of a request opened with a link to a folder.
create or replace function link_reaches_type(p_grant uuid, p_extension text, p_type text)
    returns boolean
    language sql stable security definer
    set search_path = mk_kernel, pg_temp
    as $$
    with recursive below (id, organization_id, extension_id, type, depth) as (
        select r.id, r.organization_id, r.extension_id, r.type, 0
        from resource_grant g
        join resource r on r.id = g.resource_id
        where g.id = p_grant and g.subject_kind = 'link'
          and g.revoked_at is null and g.expires_at > now()
        union all
        select c.id, c.organization_id, c.extension_id, c.type, b.depth + 1
        from below b
        join resource c on c.parent_id = b.id and c.organization_id = b.organization_id
        where b.depth < 100
          and exists (select 1 from sharing_level s
                      where s.extension_id = c.extension_id and s.type = c.type and s.inherits)
    )
    select exists (select 1 from below b where b.depth > 0 and b.extension_id = p_extension and b.type = p_type) $$;
