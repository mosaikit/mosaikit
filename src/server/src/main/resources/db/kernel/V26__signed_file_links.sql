-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-093: signed links to files. A link carries its own grant, signed by the kernel, and no table
-- keeps it; the request that opens it has no session, and so no organization, which row-level
-- security (V24) would leave without rows. These two functions read the file a link names, in the
-- organization the link names. Security definer: the kernel calls them only after it verified the
-- signature of the link, and they give what the kernel needs to serve the file, nothing else.

-- A file of an extension in an organization, by its identifier: a link to one file.
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
    where f.organization_id = p_organization and f.extension_id = p_extension and f.id = p_id $$;

-- The newest file of an extension with this name, of the organization (p_team null) or of a team:
-- a file under a link to a prefix.
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
    where f.organization_id = p_organization and f.extension_id = p_extension
      and f.team_id is not distinct from p_team and f.name = p_name
    order by f.created_at desc, f.id
    limit 1 $$;

create index stored_file_name_ix on stored_file (organization_id, extension_id, name);
