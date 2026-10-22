-- Trash and log (phase 5).
--
-- Trash: deleting a resource moves it to the trash (deleted_at); the resource and everything under it
-- become invisible to everybody, in the core and in the tables of the plugins (the level is 0). It is
-- restored by clearing deleted_at, or deleted for good by the purge (the rows of the plugins go with it
-- through their foreign keys).
--
-- Log: the events get the outcome (failures, e.g. a refused sign-in), the address and the browser of the
-- request, and the indexes for the filters of the Log page.

alter table core.resources
    add column deleted_at timestamptz,
    add column deleted_by uuid references core.users(id) on delete set null;
create index on core.resources (tenant_id, deleted_at) where deleted_at is not null;

-- The resource or one of its ancestors is in the trash.
create function core.in_trash(p_rid uuid) returns boolean
language sql stable security definer set search_path = core, pg_temp as $$
    select exists (
        select 1 from core.resources r
        where r.id = p_rid
          and (r.deleted_at is not null
               or exists (select 1 from core.resources a where a.id = any(r.ancestors) and a.deleted_at is not null))
    )
$$;
revoke all on function core.in_trash(uuid) from public;

-- Level of a user on a resource: 0 in the trash, otherwise as before (ownership and grants on the
-- resource and its ancestors).
create or replace function core.level_for(p_user uuid, p_tenant uuid, p_rid uuid, p_ancestors uuid[]) returns int
language plpgsql stable security definer set search_path = core, pg_temp as $$
declare
    v_chain uuid[] := p_ancestors || p_rid;
begin
    if p_user is null or not core.is_member(p_user, p_tenant) then
        return 0;
    end if;
    if exists (select 1 from core.resources where id = any(v_chain) and deleted_at is not null) then
        return 0;
    end if;
    if exists (select 1 from core.resources where id = any(v_chain) and owner_id = p_user) then
        return 3;
    end if;
    return coalesce((
        select max(g.level) from core.grants g
        where g.resource_id = any(v_chain)
          and ((g.principal_type = 'user' and g.principal_id = p_user)
            or (g.principal_type = 'group' and g.principal_id in (
                    select gm.group_id from core.group_members gm
                    join core.groups gr on gr.id = gm.group_id
                    where gm.user_id = p_user and gr.tenant_id = p_tenant)))
    ), 0);
end $$;

-- Level of the current context on a resource (0-3); a public link does not open what is in the trash.
create or replace function core.level_of(p_rid uuid) returns int
language plpgsql stable security definer set search_path = core, pg_temp as $$
declare
    c core.session_ctx;
    r record;
begin
    c := core.ctx_row();
    if c.pid is null or p_rid is null then
        return 0;
    end if;
    select id, tenant_id, plugin_id, ancestors, deleted_at into r from core.resources where id = p_rid;
    if not found or c.tenant_id is null or r.tenant_id <> c.tenant_id then
        return 0;
    end if;
    if c.plugin_id is not null and r.plugin_id <> c.plugin_id then
        return 0;
    end if;
    if r.deleted_at is not null
       or exists (select 1 from core.resources a where a.id = any(r.ancestors) and a.deleted_at is not null) then
        return 0;
    end if;
    if c.link_resource is not null then
        -- public link: read only of the resource and of its descendants
        if r.id = c.link_resource or c.link_resource = any(r.ancestors) then
            return 1;
        end if;
        return 0;
    end if;
    return core.level_for(c.user_id, r.tenant_id, r.id, r.ancestors);
end $$;

-- Deleting moves to the trash: the resource is marked, its descendants follow it (they are hidden
-- through their ancestors). Returns the resource and its descendants, as before.
create or replace function core.delete_resource(p_id uuid) returns setof uuid
language plpgsql volatile security definer set search_path = core, pg_temp as $$
begin
    if core.level_of(p_id) < 3 then
        raise exception 'mosaikit: manage permission required' using errcode = '42501';
    end if;
    update core.resources set deleted_at = now(), deleted_by = (core.ctx_row()).user_id where id = p_id;
    return query select id from core.resources where id = p_id or p_id = any(ancestors);
end $$;

alter table core.events
    add column ok boolean not null default true,
    add column ip text,
    add column agent text;
create index on core.events (ts);
create index on core.events (tenant_id, user_id, ts);
create index on core.events (resource_id) where resource_id is not null;
