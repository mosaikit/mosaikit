-- Performance at scale (docs/reports/performance.md).

-- ---------------------------------------------------------------- what a person sees, as a set
-- core.visible_resources called core.level_of() (half a dozen queries in plpgsql) for EVERY item of the
-- tenant and of the plugin, and the search called core.level_for() for every match: the cost grew with
-- the size of the tenant, not with what the person sees. core.levels_for() finds the items a person
-- sees in a tenant from their side: what they own, what is shared with them or with their groups, and
-- the descendants of those (the GIN index on ancestors), with the same rules as core.level_for():
-- 0 in the trash (the item or an ancestor), 3 for the owner of the item or of an ancestor, otherwise the
-- highest share on the item or on its ancestors.
create function core.levels_for(p_user uuid, p_tenant uuid) returns table (id uuid, level int)
language sql stable security definer set search_path = core, pg_temp as $$
    with m as materialized (
        select p_user is not null and core.is_member(p_user, p_tenant) as ok
    ),
    -- the person and their groups in the tenant
    p as materialized (
        select 'user'::text as kind, p_user as id from m where m.ok
        union all
        select 'group', gm.group_id
        from m
        join core.group_members gm on gm.user_id = p_user
        join core.groups gr on gr.id = gm.group_id and gr.tenant_id = p_tenant
        where m.ok
    ),
    -- items owned in the tenant (an owned ancestor gives 3 to its descendants)
    o as materialized (
        select r.id from m join core.resources r on r.owner_id = p_user and r.tenant_id = p_tenant where m.ok
    ),
    -- shares to the person or to their groups: item -> highest level
    g as materialized (
        select s.resource_id, max(s.level)::int as level
        from core.grants s join p on p.kind = s.principal_type and p.id = s.principal_id
        group by s.resource_id
    ),
    roots as materialized (
        select coalesce(array_agg(x.id), '{}') as ids from (select o.id from o union select g.resource_id from g) x
    ),
    cand as (
        select o.id from o
        union
        select g.resource_id from g
        union
        select r.id from core.resources r, roots where cardinality(roots.ids) > 0 and r.ancestors && roots.ids
    )
    -- one lookup by key per candidate (the estimate of the descendants is far too high, and with a join
    -- the planner would read every item of the tenant)
    select r.id, lv.level
    from cand
    cross join lateral (select * from core.resources x where x.id = cand.id offset 0) r
    cross join lateral (
        select case
            when r.owner_id = p_user or exists (select 1 from o where o.id = any(r.ancestors)) then 3
            else coalesce((select max(g.level) from g where g.resource_id = any(r.ancestors || r.id)), 0)
        end as level
    ) lv
    where r.tenant_id = p_tenant
      and r.deleted_at is null
      and (cardinality(r.ancestors) = 0
           or not exists (select 1 from core.resources a where a.id = any(r.ancestors) and a.deleted_at is not null))
      and lv.level >= 1
$$;
revoke all on function core.levels_for(uuid, uuid) from public;

-- What the current context sees, with the level: the items of core.levels_for() for a person, or for a
-- public link its item and the descendants (read only); with a plugin in the context, only its items.
-- No arguments: like core.level_of() it reads the context, so the roles of the plugins may call it.
create function core.ctx_levels() returns table (id uuid, level int)
language sql stable security definer set search_path = core, pg_temp as $$
    with c as materialized (
        select x.user_id, x.tenant_id, x.plugin_id, x.link_resource
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
    where c.plugin_id is null or exists (select 1 from core.resources r where r.id = lv.id and r.plugin_id = c.plugin_id)
$$;

-- The items of the current plugin visible in the context: same columns and rows as before.
create or replace view core.visible_resources with (security_barrier) as
select r.id, r.tenant_id, r.plugin_id, r.kind, r.parent_id, r.ancestors, r.owner_id,
       u.username as owner_username, coalesce(nullif(u.display_name, ''), u.username) as owner_name,
       r.title, r.size_bytes, r.meta, r.created_at, r.updated_at,
       lv.level as my_level,
       exists (select 1 from core.grants s where s.resource_id = r.id) as shared
from core.ctx_levels() lv
join core.resources r on r.id = lv.id
join core.users u on u.id = r.owner_id
where r.tenant_id = core.ctx_tenant()
  and r.plugin_id = core.ctx_plugin();

-- ---------------------------------------------------------------- descendants through the index
-- `p_id = any(ancestors)` reads the whole table; `ancestors @> array[p_id]` uses the GIN index.
create or replace function core.delete_resource(p_id uuid) returns setof uuid
language plpgsql security definer set search_path = core, pg_temp as $$
begin
    if core.level_of(p_id) < 3 then
        raise exception 'mosaikit: manage permission required' using errcode = '42501';
    end if;
    update core.resources set deleted_at = now(), deleted_by = (core.ctx_row()).user_id where id = p_id;
    return query select r.id from core.resources r where r.id = p_id or r.ancestors @> array[p_id];
end $$;

create or replace function core.move_resource(p_id uuid, p_parent uuid) returns void
language plpgsql security definer set search_path = core, pg_temp as $$
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
     where ancestors @> array[p_id];
end $$;

-- ---------------------------------------------------------------- the trash as a set
-- The items in the trash (deleted, or under a deleted folder) of a tenant (null: of all of them), for
-- the counts of the KPIs: core.in_trash() called twice for every item cost minutes on a large platform.
create function core.trashed(p_tenant uuid) returns table (id uuid)
language sql stable security definer set search_path = core, pg_temp as $$
    with roots as materialized (
        select r.id from core.resources r
        where r.deleted_at is not null and (p_tenant is null or r.tenant_id = p_tenant)
    )
    select roots.id from roots
    union
    select d.id from roots join core.resources d on d.ancestors @> array[roots.id]
$$;
revoke all on function core.trashed(uuid) from public;

-- ---------------------------------------------------------------- storage and items of a tenant
-- count(*) and sum(size_bytes) of a tenant (quotas at every addition, tenant lists, monitoring) from
-- the index alone, without reading the rows.
create index resources_tenant_size on core.resources (tenant_id) include (size_bytes);

-- the items the search has not indexed yet (the background worker takes them 200 at a time)
create index resources_unindexed on core.resources (id) where search_text is null;

-- ---------------------------------------------------------------- GIN indexes without a pending list
-- With fastupdate (the default) new entries wait in a pending list that every search reads in full,
-- up to gin_pending_list_limit (4 MB): after many inserts a lookup on the ancestors took 110 ms instead
-- of 0.3 ms. The items are written far less often than they are read.
alter index core.resources_ancestors_idx set (fastupdate = off);
alter index core.resources_search_vec set (fastupdate = off);
select gin_clean_pending_list('core.resources_ancestors_idx'::regclass);
select gin_clean_pending_list('core.resources_search_vec'::regclass);

-- ---------------------------------------------------------------- indexes of the Log
-- a page of the Log is `order by id desc limit 51` with the filters in use
create index events_tenant_id on core.events (tenant_id, id);
create index events_user_id on core.events (user_id, id) where user_id is not null;
create index events_failed on core.events (tenant_id, id) where not ok;

-- ---------------------------------------------------------------- plugin tables of installed plugins
-- The kernel now creates an index on tenant_id with every table of a plugin (the KPIs of a tenant read
-- its rows only); the tables of the plugins already installed get it here.
do $$
declare
    t record;
begin
    for t in
        select c.table_schema, c.table_name
        from information_schema.columns c
        join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
                                         and x.table_type = 'BASE TABLE'
        where c.column_name = 'tenant_id' and c.table_schema in (select schema_name from core.plugins)
    loop
        if not exists (
            select 1 from pg_index i
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
            where i.indrelid = format('%I.%I', t.table_schema, t.table_name)::regclass and a.attname = 'tenant_id'
        ) then
            execute format('create index on %I.%I (tenant_id)', t.table_schema, t.table_name);
        end if;
    end loop;
end $$;
