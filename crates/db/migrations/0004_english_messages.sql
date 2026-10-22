-- Messages of the core functions in English (the default language of Mosaikit). Same bodies as in
-- 0001_core.sql, only the texts of the exceptions change; `create or replace` keeps owner and grants.
-- Applied migrations are never edited (sqlx checks their checksums): changes go in new files.

create or replace function core.set_ctx(p_secret bytea, p_user uuid, p_tenant uuid, p_plugin text, p_link uuid)
returns void language plpgsql security definer set search_path = core, pg_temp as $$
begin
    if not exists (select 1 from core.secrets where name = 'ctx' and value = p_secret) then
        raise exception 'mosaikit: context not authorized' using errcode = '42501';
    end if;
    insert into core.session_ctx (pid, xid, user_id, tenant_id, plugin_id, link_resource)
    values (pg_backend_pid(), pg_current_xact_id(), p_user, p_tenant, p_plugin, p_link)
    on conflict (pid) do update
        set xid = excluded.xid, user_id = excluded.user_id, tenant_id = excluded.tenant_id,
            plugin_id = excluded.plugin_id, link_resource = excluded.link_resource;
end $$;

create or replace function core.create_resource(p_kind text, p_title text, p_parent uuid, p_meta jsonb) returns uuid
language plpgsql volatile security definer set search_path = core, pg_temp as $$
declare
    c core.session_ctx;
    p record;
    v_anc uuid[] := '{}';
    v_id uuid;
begin
    c := core.ctx_row();
    if c.pid is null or c.user_id is null or c.plugin_id is null or c.link_resource is not null
       or not core.is_member(c.user_id, c.tenant_id) then
        raise exception 'mosaikit: invalid context to create resources' using errcode = '42501';
    end if;
    if p_kind is null or p_kind !~ '^[a-z][a-z0-9_]{0,47}$' then
        raise exception 'mosaikit: invalid resource kind' using errcode = '22023';
    end if;
    if p_parent is not null then
        select * into p from core.resources where id = p_parent;
        if not found or p.tenant_id <> c.tenant_id or p.plugin_id <> c.plugin_id then
            raise exception 'mosaikit: invalid parent' using errcode = '22023';
        end if;
        if core.level_of(p_parent) < 2 then
            raise exception 'mosaikit: write permission on the parent required' using errcode = '42501';
        end if;
        v_anc := p.ancestors || p.id;
    end if;
    insert into core.resources (tenant_id, plugin_id, kind, parent_id, ancestors, owner_id, title, meta)
    values (c.tenant_id, c.plugin_id, p_kind, p_parent, v_anc, c.user_id, coalesce(p_title, ''), coalesce(p_meta, '{}'))
    returning id into v_id;
    return v_id;
end $$;

create or replace function core.update_resource(p_id uuid, p_title text, p_meta jsonb, p_size bigint) returns void
language plpgsql volatile security definer set search_path = core, pg_temp as $$
begin
    if core.level_of(p_id) < 2 then
        raise exception 'mosaikit: write permission required' using errcode = '42501';
    end if;
    update core.resources set
        title = coalesce(p_title, title),
        meta = case when p_meta is null then meta else meta || p_meta end,
        size_bytes = coalesce(p_size, size_bytes),
        updated_at = now()
    where id = p_id;
end $$;

create or replace function core.move_resource(p_id uuid, p_parent uuid) returns void
language plpgsql volatile security definer set search_path = core, pg_temp as $$
declare
    r record;
    p record;
    v_anc uuid[] := '{}';
begin
    if core.level_of(p_id) < 3 then
        raise exception 'mosaikit: manage permission required' using errcode = '42501';
    end if;
    select * into r from core.resources where id = p_id;
    if p_parent is not null then
        select * into p from core.resources where id = p_parent;
        if not found or p.tenant_id <> r.tenant_id or p.plugin_id <> r.plugin_id then
            raise exception 'mosaikit: invalid destination' using errcode = '22023';
        end if;
        if p.id = p_id or p_id = any(p.ancestors) then
            raise exception 'mosaikit: a folder cannot be moved into itself' using errcode = '22023';
        end if;
        if core.level_of(p_parent) < 2 then
            raise exception 'mosaikit: write permission on the destination required' using errcode = '42501';
        end if;
        v_anc := p.ancestors || p.id;
    end if;
    update core.resources set parent_id = p_parent, ancestors = v_anc, updated_at = now() where id = p_id;
    -- descendants: new prefix + the part after the moved resource
    update core.resources
       set ancestors = v_anc || p_id || ancestors[array_position(ancestors, p_id) + 1 :]
     where p_id = any(ancestors);
end $$;

create or replace function core.delete_resource(p_id uuid) returns setof uuid
language plpgsql volatile security definer set search_path = core, pg_temp as $$
begin
    if core.level_of(p_id) < 3 then
        raise exception 'mosaikit: manage permission required' using errcode = '42501';
    end if;
    return query
        with gone as (
            delete from core.resources where id = p_id or p_id = any(ancestors) returning id
        ) select id from gone;
end $$;
