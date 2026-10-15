-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-095 on MK-054: the trash. An extension moves a resource to the trash instead of deleting it; the
-- resources inside it (by the parent of the registry, whatever their type) go with it. A resource in
-- the trash keeps its entry, its grants and its data in the extension, but gives no level to anyone
-- and opens no link, until its owner or an administrator restores it. A job of the kernel deletes it
-- for good from purgeable_from, set when it was trashed from mosaikit.trash.retention.
--
-- trash_root_id names the resource whose trashing took this one: itself for the resource that was
-- trashed, the containing resource for those that went with it. They are restored and deleted
-- together. The check keeps every resource in the trash for a day at least, whatever the code or a
-- setting says: nothing is deleted for good the moment it is trashed.

alter table resource add column trashed_at timestamptz;
alter table resource add column trashed_by uuid;
alter table resource add column trash_root_id uuid;
alter table resource add column purgeable_from timestamptz;

alter table resource add constraint resource_trashed_by_fk
    foreign key (trashed_by) references user_account (id) on delete set null;

alter table resource add constraint resource_trash_ck check (
    (trashed_at is null and trashed_by is null and trash_root_id is null and purgeable_from is null)
    or (trashed_at is not null and trash_root_id is not null
        and purgeable_from >= trashed_at + interval '1 day'));

-- The job finds the resources due; the trash lists the resources trashed and what went with each.
create index resource_purgeable_ix on resource (purgeable_from) where trash_root_id = id;
create index resource_trash_root_ix on resource (trash_root_id) where trash_root_id is not null;

-- A resource that was trashed and is removed from the registry, by its extension or because the
-- extension was uninstalled, leaves the resources that went with it in the trash on their own: each is
-- then restored or deleted by itself. After the statement, so that deleting a resource with what went
-- with it, as the job does, finds nothing left to change.
create or replace function resource_trash_reroot()
    returns trigger
    language plpgsql
    set search_path = mk_kernel, pg_temp
    as $$
    begin
        update resource set trash_root_id = id where trash_root_id = old.id and id <> old.id;
        return old;
    end $$;

create trigger resource_trash_reroot after delete on resource
    for each row when (old.trash_root_id = old.id)
    execute function resource_trash_reroot();

-- The resources inside a resource, following the parent of the registry downwards whatever their type,
-- at most 100 levels down, without the resource itself. Security invoker: under row-level security.
create or replace function resource_contents(p_resource uuid)
    returns table (id uuid, depth integer)
    language sql stable
    set search_path = mk_kernel, pg_temp
    as $$
    with recursive below (id, organization_id, depth) as (
        select r.id, r.organization_id, 0
        from resource r
        where r.id = p_resource
        union all
        select c.id, c.organization_id, b.depth + 1
        from below b
        join resource c on c.parent_id = b.id and c.organization_id = b.organization_id
        where b.depth < 100
    )
    select b.id, b.depth from below b where b.depth > 0 $$;

-- As in V38, but a resource in the trash has no chain: allows(), signed_link_reads() and
-- link_reaches(), which follow it, give nothing on it.
create or replace function lineage(p_resource uuid)
    returns table (id uuid, extension_id varchar, type varchar, owner_id uuid, depth integer)
    language sql stable
    set search_path = mk_kernel, pg_temp
    as $$
    with recursive chain (id, organization_id, extension_id, type, owner_id, parent_id, depth) as (
        select r.id, r.organization_id, r.extension_id, r.type, r.owner_id, r.parent_id, 0
        from resource r
        where r.id = p_resource and r.trashed_at is null
        union all
        select p.id, p.organization_id, p.extension_id, p.type, p.owner_id, p.parent_id, c.depth + 1
        from chain c
        join resource p on p.id = c.parent_id and p.organization_id = c.organization_id
        where c.depth < 100
          and p.trashed_at is null
          and exists (select 1 from sharing_level s
                      where s.extension_id = c.extension_id and s.type = c.type and s.inherits)
    )
    select c.id, c.extension_id, c.type, c.owner_id, c.depth from chain c $$;

-- As in V38, without the resources in the trash.
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
          and r.trashed_at is null
        union all
        select c.id, c.organization_id, c.extension_id, c.type, b.depth + 1
        from below b
        join resource c on c.parent_id = b.id and c.organization_id = b.organization_id
        where b.depth < 100
          and c.trashed_at is null
          and exists (select 1 from sharing_level s
                      where s.extension_id = c.extension_id and s.type = c.type and s.inherits)
    )
    select exists (select 1 from below b where b.depth > 0 and b.extension_id = p_extension and b.type = p_type) $$;

-- As in V40: a link to a resource in the trash answers not found, as an unknown one does, and works
-- again once the resource is restored.
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
      and o.deleted_at is null
      and r.trashed_at is null $$;
