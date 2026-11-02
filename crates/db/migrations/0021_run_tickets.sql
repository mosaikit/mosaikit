-- Run tickets: a plugin called on behalf of a process that runs after the session that started it.
-- (docs/architecture.md, "Run tickets")

-- ---------------------------------------------------------------- the tickets
-- Not tied to a session: tied to the user who started the run. Only the hash of the token is kept.
create table core.run_tickets (
    id          uuid primary key default gen_random_uuid(),
    token_hash  bytea not null unique,
    user_id     uuid not null references core.users(id) on delete cascade,
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    plugin_id   text not null references core.plugins(id) on delete cascade,
    run_ref     text not null,
    -- JSON array of the commands the ticket may call (a subset of `permissions.run_commands`)
    commands    jsonb not null,
    -- JSON array of resource ids the ticket is limited to (null: the rights of the user)
    resources   jsonb,
    uses_left   integer not null check (uses_left >= 0),
    expires_at  timestamptz not null,
    revoked_at  timestamptz,
    created_at  timestamptz not null default now()
);
create index on core.run_tickets (user_id, tenant_id);
create index on core.run_tickets (expires_at);

-- ---------------------------------------------------------------- the resource scope of a context
-- A run ticket may be limited to a list of resources: the context carries them and the level of the
-- user is 0 outside them (and their descendants), whatever the plugin asks. Same idea as the link.
alter table core.session_ctx add column scope uuid[];

create function core.set_ctx(p_secret bytea, p_user uuid, p_tenant uuid, p_plugin text, p_link uuid, p_scope uuid[])
returns void language plpgsql security definer set search_path = core, pg_temp as $$
begin
    if not exists (select 1 from core.secrets where name = 'ctx' and value = p_secret) then
        raise exception 'mosaikit: context not authorized' using errcode = '42501';
    end if;
    insert into core.session_ctx (pid, xid, user_id, tenant_id, plugin_id, link_resource, scope)
    values (pg_backend_pid(), pg_current_xact_id(), p_user, p_tenant, p_plugin, p_link, p_scope)
    on conflict (pid) do update
        set xid = excluded.xid, user_id = excluded.user_id, tenant_id = excluded.tenant_id,
            plugin_id = excluded.plugin_id, link_resource = excluded.link_resource, scope = excluded.scope;
end $$;
revoke all on function core.set_ctx(bytea, uuid, uuid, text, uuid, uuid[]) from public;

-- The five-argument version is the one of a context without a scope: it must not leave the scope of
-- the previous transaction of the backend behind.
create or replace function core.set_ctx(p_secret bytea, p_user uuid, p_tenant uuid, p_plugin text, p_link uuid)
returns void language sql security definer set search_path = core, pg_temp as $$
    select core.set_ctx(p_secret, p_user, p_tenant, p_plugin, p_link, null::uuid[])
$$;

-- Level of the current context on a resource (0-3): as in 0010, plus the scope of a run ticket.
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
    if c.scope is not null and not (r.id = any(c.scope) or r.ancestors && c.scope) then
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

-- What the context sees, as a set (see 0015): plus the scope of a run ticket.
create or replace function core.ctx_levels() returns table (id uuid, level int)
language sql stable security definer set search_path = core, pg_temp as $$
    with c as materialized (
        select x.user_id, x.tenant_id, x.plugin_id, x.link_resource, x.scope
        from core.ctx_row() x
        where x.pid is not null and x.tenant_id is not null
    ),
    lv as (
        select l.id, l.level from c, core.levels_for(c.user_id, c.tenant_id) l where c.link_resource is null
        union all
        select r.id, 1
        from c join core.resources r on r.id = c.link_resource or r.ancestors @> array[c.link_resource]
        where c.link_resource is not null
          and r.tenant_id = c.tenant_id
          and r.deleted_at is null
          and (cardinality(r.ancestors) = 0
               or not exists (select 1 from core.resources a
                              where a.id = any(r.ancestors) and a.deleted_at is not null))
    )
    select lv.id, lv.level
    from lv, c
    where (c.plugin_id is null or exists (select 1 from core.resources r where r.id = lv.id and r.plugin_id = c.plugin_id))
      and (c.scope is null
           or lv.id = any(c.scope)
           or exists (select 1 from core.resources r where r.id = lv.id and r.ancestors && c.scope))
$$;

-- A context with a scope creates only under a resource of its scope (the check of the parent does the
-- rest: its level is 0 outside the scope).
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
       or (c.scope is not null and p_parent is null)
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

-- The roles of the plugins already installed may run the new version of set_ctx.
do $$
declare
    p record;
begin
    for p in select role_name from core.plugins loop
        if exists (select 1 from pg_roles where rolname = p.role_name) then
            execute format('grant execute on function core.set_ctx(bytea, uuid, uuid, text, uuid, uuid[]) to %I', p.role_name);
        end if;
    end loop;
end $$;
