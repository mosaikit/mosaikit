-- Equivalence of core.visible_resources (sets, migration 0015) with the rule it replaces: level_of() on
-- every item of the tenant and of the plugin. Run on the data of the load test (cargo xtask perf), as the
-- owner of the database; everything is rolled back. Prints one line per case and raises on a difference.

\set ON_ERROR_STOP on
begin;

-- more cases than the seed has: folders shared with a group, a shared folder in the trash, a share of
-- an item to a person on top of a group share
do $$
declare
    t uuid := (select id from core.tenants where slug = 't0100');
    g uuid := (select id from core.groups where tenant_id = (select id from core.tenants where slug = 't0100') and name = 'Group 1');
    f record;
begin
    for f in select id, row_number() over (order by id) as n from core.resources
             where tenant_id = t and kind = 'folder' order by id limit 20 loop
        insert into core.grants (resource_id, principal_type, principal_id, level)
        values (f.id, 'group', g, 1 + (f.n % 2)::int) on conflict do nothing;
        if f.n = 3 then
            update core.resources set deleted_at = now() where id = f.id;
        end if;
        if f.n = 5 then
            insert into core.grants (resource_id, principal_type, principal_id, level)
            select r.id, 'user', (select id from core.users where username = 'u0100-005'), 3
            from core.resources r where r.parent_id = f.id limit 1 on conflict do nothing;
        end if;
    end loop;
end $$;

do $$
declare
    secret bytea := (select value from core.secrets where name = 'ctx');
    t uuid := (select id from core.tenants where slug = 't0100');
    u record;
    p text;
    a bigint;
    b bigint;
    link uuid;
begin
    for u in select id, username from core.users where username in
             ('u0100-000', 'u0100-001', 'u0100-005', 'u0100-006', 'u0100-010', 'u0100-011', 'u0099-007', 'u0101-007') loop
        foreach p in array array['com.mosaikit.notes', 'com.mosaikit.tasks', 'com.mosaikit.files'] loop
            perform core.set_ctx(secret, u.id, t, p, null);
            select count(*) into a from (
                (select id, my_level from core.visible_resources
                 except
                 select id, core.level_of(id) from core.resources
                 where tenant_id = t and plugin_id = p and core.level_of(id) >= 1)
                union all
                (select id, core.level_of(id) from core.resources
                 where tenant_id = t and plugin_id = p and core.level_of(id) >= 1
                 except
                 select id, my_level from core.visible_resources)) d;
            select count(*) into b from core.visible_resources;
            raise notice '% %: % visible, % differences', u.username, p, b, a;
            if a <> 0 then
                raise exception 'visibility differs for % in %', u.username, p;
            end if;
        end loop;
    end loop;
    -- a public link on a folder: the folder and what it contains, read only
    link := (select id from core.resources where tenant_id = t and kind = 'folder' and deleted_at is null order by id limit 1);
    perform core.set_ctx(secret, null, t, 'com.mosaikit.files', link);
    select count(*) into a from (
        (select id, my_level from core.visible_resources
         except
         select id, core.level_of(id) from core.resources
         where tenant_id = t and plugin_id = 'com.mosaikit.files' and core.level_of(id) >= 1)
        union all
        (select id, core.level_of(id) from core.resources
         where tenant_id = t and plugin_id = 'com.mosaikit.files' and core.level_of(id) >= 1
         except
         select id, my_level from core.visible_resources)) d;
    select count(*) into b from core.visible_resources;
    raise notice 'public link: % visible, % differences', b, a;
    if a <> 0 then
        raise exception 'visibility differs for the public link';
    end if;
end $$;

rollback;
