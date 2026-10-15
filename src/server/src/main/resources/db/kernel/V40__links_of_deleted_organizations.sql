-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- Fix of MK-093 and MK-055 with MK-130: the links that open what an organization holds without a
-- session answer not found from the moment the organization is deleted, not when they expire. A
-- signed link to files (V26, V38) and a sharing link (V18) carry their organization, and the
-- functions below read for them as the owner of the tables, outside row-level security: they now
-- leave out a deleted organization, as the published views do (V39). Same names, arguments and
-- columns, so the kernel calls them as before.

-- A file of an extension in an organization that is not deleted, by its identifier: a link to one file.
create or replace function signed_file(p_organization uuid, p_extension varchar, p_id uuid)
    returns table (
        id            uuid,
        extension_id  varchar,
        owner_id      uuid,
        team_id       uuid,
        name          varchar,
        content_type  varchar,
        size          bigint,
        checksum      varchar,
        storage_key   varchar,
        resource_id   uuid,
        created_at    timestamptz,
        updated_at    timestamptz)
    language sql stable security definer
    set search_path = mk_kernel, pg_temp
    as $$
    select f.id, f.extension_id, f.owner_id, f.team_id, f.name, f.content_type, f.size, f.checksum,
           f.storage_key, f.resource_id, f.created_at, f.updated_at
    from stored_file f
    join organization o on o.id = f.organization_id
    where f.organization_id = p_organization and f.extension_id = p_extension and f.id = p_id
      and o.deleted_at is null $$;

-- The newest file of an extension with this name, of the organization (p_team null) or of a team, in
-- an organization that is not deleted: a file under a link to a prefix.
create or replace function signed_file_named(p_organization uuid, p_extension varchar, p_team uuid, p_name varchar)
    returns table (
        id            uuid,
        extension_id  varchar,
        owner_id      uuid,
        team_id       uuid,
        name          varchar,
        content_type  varchar,
        size          bigint,
        checksum      varchar,
        storage_key   varchar,
        resource_id   uuid,
        created_at    timestamptz,
        updated_at    timestamptz)
    language sql stable security definer
    set search_path = mk_kernel, pg_temp
    as $$
    select f.id, f.extension_id, f.owner_id, f.team_id, f.name, f.content_type, f.size, f.checksum,
           f.storage_key, f.resource_id, f.created_at, f.updated_at
    from stored_file f
    join organization o on o.id = f.organization_id
    where f.organization_id = p_organization and f.extension_id = p_extension
      and f.team_id is not distinct from p_team and f.name = p_name
      and o.deleted_at is null
    order by f.created_at desc, f.id
    limit 1 $$;

-- Whether the person who made a signed link still reads a file of it (V38): never in a deleted
-- organization, whose members keep their rows until it is removed.
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
    select exists (select 1 from organization o where o.id = p_organization and o.deleted_at is null)
       and exists (select 1 from creator)
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

-- The link whose secret has this SHA-256, with its resource (V18): none in a deleted organization, so
-- that the link answers not found, as an unknown one does.
create or replace function shared_link(p_digest text)
    returns table (
        grant_id        uuid,
        organization_id uuid,
        resource_id     uuid,
        extension_id    varchar,
        type            varchar,
        ref_id          varchar,
        title           varchar,
        link            varchar,
        level           varchar,
        expires_at      timestamptz,
        password_hash   varchar,
        revoked_at      timestamptz)
    language sql stable security definer
    set search_path = mk_kernel, pg_temp
    as $$
    select g.id, g.organization_id, r.id, r.extension_id, r.type, r.ref_id, r.title, r.link, g.level,
           g.expires_at, g.password_hash, g.revoked_at
    from resource_grant g
    join resource r on r.id = g.resource_id
    join organization o on o.id = g.organization_id
    where g.subject_kind = 'link' and g.token_digest = p_digest
      and o.deleted_at is null $$;
