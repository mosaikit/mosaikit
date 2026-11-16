-- The built-in group "All members" of every tenant (`builtin = 'all'`): a recipient of shares that is
-- kept by the platform, so a manager does not maintain a group by hand. Its members are the memberships
-- of the tenant; triggers keep it in step. Read-only for people (see tenancy/groups.rs). The ACL functions
-- are untouched: it is an ordinary group for them (and they still require an active membership).

alter table core.groups add column builtin text check (builtin in ('all'));
create unique index groups_builtin_all on core.groups (tenant_id) where builtin = 'all';

-- the group of a tenant (created on the fly)
create function core.all_members_group(p_tenant uuid) returns uuid
language plpgsql security definer set search_path = core, pg_temp as $$
declare
    gid uuid;
begin
    select id into gid from core.groups where tenant_id = p_tenant and builtin = 'all';
    if gid is null then
        insert into core.groups (tenant_id, name, builtin)
        values (p_tenant,
                case when exists (select 1 from core.groups where tenant_id = p_tenant and name = 'All members')
                     then 'All members (Mosaikit)' else 'All members' end,
                'all')
        returning id into gid;
    end if;
    return gid;
end $$;

create function core.all_members_tenant() returns trigger
language plpgsql security definer set search_path = core, pg_temp as $$
begin
    perform core.all_members_group(new.id);
    return new;
end $$;
create trigger all_members_tenant after insert on core.tenants
    for each row execute function core.all_members_tenant();

create function core.all_members_join() returns trigger
language plpgsql security definer set search_path = core, pg_temp as $$
begin
    insert into core.group_members (group_id, user_id)
    values (core.all_members_group(new.tenant_id), new.user_id)
    on conflict do nothing;
    return new;
end $$;
create trigger all_members_join after insert on core.memberships
    for each row execute function core.all_members_join();

create function core.all_members_leave() returns trigger
language plpgsql security definer set search_path = core, pg_temp as $$
begin
    delete from core.group_members
    where user_id = old.user_id
      and group_id in (select id from core.groups where tenant_id = old.tenant_id and builtin = 'all');
    return old;
end $$;
create trigger all_members_leave after delete on core.memberships
    for each row execute function core.all_members_leave();

-- the tenants and memberships that exist
select core.all_members_group(id) from core.tenants;
insert into core.group_members (group_id, user_id)
select g.id, m.user_id from core.memberships m join core.groups g on g.tenant_id = m.tenant_id and g.builtin = 'all'
on conflict do nothing;
