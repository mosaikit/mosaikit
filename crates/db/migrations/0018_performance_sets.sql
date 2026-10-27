-- Performance follow-ups (docs/reports/performance.md, "Follow-ups").

-- ---------------------------------------------------------------- row-level security of the plugin tables as sets
-- The read policy of every plugin table called core.can_access() for every row it looked at: plpgsql,
-- half a dozen queries per row, so a statement that read a thousand rows paid a thousand level checks,
-- and a statement of a plugin over its whole table (a count, a report) paid one per row of the tenant.
-- The rows are now filtered with what the context sees as a set, computed once per statement
-- (core.ctx_levels(), the same rules as core.level_of(): owner of the item or of an ancestor, highest
-- share on the chain, trash, public links, items of the plugin only; checked on the data of the load
-- test by xtask/perf/check_rls.sql). The checks of the rows being written (insert, update, delete)
-- stay per row: a write touches the rows it names, and a set would cost more than those few checks.

revoke all on function core.ctx_levels() from public;

do $$
declare
    p record;
    t record;
    read_policy text := 'resource_id in (select l.id from core.ctx_levels() l where l.level >= 1)';
begin
    for p in select id, schema_name, role_name from core.plugins loop
        if exists (select 1 from pg_roles where rolname = p.role_name) then
            execute format('grant execute on function core.ctx_levels() to %I', p.role_name);
        end if;
        for t in
            select c.relname
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = p.schema_name
              and exists (select 1 from pg_policy pol where pol.polrelid = c.oid and pol.polname = 'msk_select')
        loop
            execute format('drop policy msk_select on %I.%I', p.schema_name, t.relname);
            execute format('create policy msk_select on %I.%I for select using (%s)', p.schema_name, t.relname, read_policy);
        end loop;
    end loop;
end $$;

-- ---------------------------------------------------------------- search in the Log with trigrams
-- The search of the Log (action, details, address, person) used `ilike '%word%'`, which no B-tree
-- index can answer: with few matches the whole Log of the tenant was read (1 s for 25,000 events of a
-- tenant, more for the platform). With the pg_trgm extension a trigram index answers it. The extension
-- is "trusted" since PostgreSQL 13 (whoever may create objects in the database may install it); where
-- it is missing or may not be installed the search works as before, without the index.
do $$
declare
    s text;
begin
    if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
        if exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
            begin
                create extension pg_trgm with schema core;
            exception when others then
                raise notice 'pg_trgm not installed (%): the search of the Log works without its index', sqlerrm;
            end;
        end if;
    end if;
    select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
    if s is not null then
        -- one text per event with the fields the search reads, separated by a character nobody types
        -- (the same expression as in crates/kernel/src/log.rs; plain `||`: concat_ws is not immutable)
        execute format(
            'create index if not exists events_search_trgm on core.events using gin '
            '((action || chr(1) || coalesce(detail::text, '''') || chr(1) || coalesce(ip, '''')) %I.gin_trgm_ops)', s);
        execute format(
            'create index if not exists users_search_trgm on core.users using gin '
            '((username || chr(1) || coalesce(display_name, '''')) %I.gin_trgm_ops)', s);
    end if;
end $$;

-- ---------------------------------------------------------------- snapshots of the platform figures
-- The platform KPIs group every item, share, link and event of the installation (10 s for a million
-- items): the background work computes them every ten minutes and the page reads the last snapshot,
-- with the time it was taken.
create table core.kpi_snapshots (
    scope       text primary key,
    computed_at timestamptz not null default now(),
    took_ms     integer not null default 0,
    data        jsonb not null
);
