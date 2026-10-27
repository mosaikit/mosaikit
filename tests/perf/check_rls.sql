-- Equivalence of the read policy of the plugin tables as a set (migration 0016:
-- `resource_id in (select id from core.ctx_levels() where level >= 1)`) with the rule it replaces
-- (`core.can_access(resource_id, 1)` for every row). Run on the data of the load test (cargo xtask perf)
-- as the owner of the database (the policies do not apply to the owner: both predicates are evaluated
-- here by hand on every row of the tables); everything is rolled back. Prints one line per case and
-- raises on a difference.

\set ON_ERROR_STOP on
begin;

-- more cases than the seed has (as in check_visibility.sql): items shared with a group at levels 1 and
-- 2, a shared item in the trash, a share to a person on top of a group share
do $$
declare
    t uuid := (select id from core.tenants where slug = 't0100');
    g uuid := (select id from core.groups where tenant_id = (select id from core.tenants where slug = 't0100') and name = 'Group 1');
    f record;
begin
    for f in select id, row_number() over (order by id) as n from core.resources
             where tenant_id = t and plugin_id = 'com.mosaikit.notes' order by id limit 20 loop
        insert into core.grants (resource_id, principal_type, principal_id, level)
        values (f.id, 'group', g, 1 + (f.n % 2)::int) on conflict do nothing;
        if f.n = 3 then
            update core.resources set deleted_at = now() where id = f.id;
        end if;
        if f.n = 5 then
            insert into core.grants (resource_id, principal_type, principal_id, level)
            values (f.id, 'user', (select id from core.users where username = 'u0100-005'), 3) on conflict do nothing;
        end if;
    end loop;
end $$;

do $$
declare
    secret bytea := (select value from core.secrets where name = 'ctx');
    t uuid := (select id from core.tenants where slug = 't0100');
    u record;
    tb record;
    d bigint;
    n bigint;
    link uuid;
begin
    for u in select id, username from core.users where username in
             ('u0100-000', 'u0100-001', 'u0100-005', 'u0100-006', 'u0100-010', 'u0100-011', 'u0099-007', 'u0101-007') loop
        for tb in select p.id as plugin, p.schema_name as s, c.relname as tname
                  from core.plugins p join pg_namespace ns on ns.nspname = p.schema_name
                  join pg_class c on c.relnamespace = ns.oid and c.relkind = 'r'
                  where exists (select 1 from pg_policy pol where pol.polrelid = c.oid and pol.polname = 'msk_select') loop
            perform core.set_ctx(secret, u.id, t, tb.plugin, null);
            execute format(
                'select count(*) from %I.%I x
                 where core.can_access(x.resource_id, 1) is distinct from
                       (x.resource_id in (select l.id from core.ctx_levels() l where l.level >= 1))',
                tb.s, tb.tname) into d;
            execute format('select count(*) from %I.%I x where core.can_access(x.resource_id, 1)', tb.s, tb.tname) into n;
            raise notice '% %.%: % readable, % differences', u.username, tb.s, tb.tname, n, d;
            if d <> 0 then
                raise exception 'the read policy differs for % in %.%', u.username, tb.s, tb.tname;
            end if;
        end loop;
    end loop;
    -- a public link on a note: that note only, read only
    link := (select id from core.resources where tenant_id = t and plugin_id = 'com.mosaikit.notes' and deleted_at is null order by id limit 1);
    perform core.set_ctx(secret, null, t, 'com.mosaikit.notes', link);
    select count(*) into d from plg_com_mosaikit_notes.notes x
    where core.can_access(x.resource_id, 1) is distinct from
          (x.resource_id in (select l.id from core.ctx_levels() l where l.level >= 1));
    raise notice 'public link: % differences', d;
    if d <> 0 then
        raise exception 'the read policy differs for the public link';
    end if;
end $$;

rollback;
