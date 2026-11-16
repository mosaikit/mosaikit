-- The built-in group "All members" of every tenant (see migrations/0027_all_members.sql for PostgreSQL).

alter table core_groups add column builtin text check (builtin in ('all'));
create unique index groups_builtin_all on core_groups (tenant_id) where builtin = 'all';

create trigger all_members_tenant after insert on core_tenants
begin
    insert into core_groups (tenant_id, name, builtin) values (new.id, 'All members', 'all');
end;

create trigger all_members_join after insert on core_memberships
begin
    insert into core_groups (tenant_id, name, builtin)
    select new.tenant_id,
           case when exists (select 1 from core_groups where tenant_id = new.tenant_id and name = 'All members')
                then 'All members (Mosaikit)' else 'All members' end,
           'all'
    where not exists (select 1 from core_groups where tenant_id = new.tenant_id and builtin = 'all');
    insert or ignore into core_group_members (group_id, user_id)
    select id, new.user_id from core_groups where tenant_id = new.tenant_id and builtin = 'all';
end;

create trigger all_members_leave after delete on core_memberships
begin
    delete from core_group_members
    where user_id = old.user_id
      and group_id in (select id from core_groups where tenant_id = old.tenant_id and builtin = 'all');
end;

-- the tenants and memberships that exist
insert into core_groups (tenant_id, name, builtin)
select t.id,
       case when exists (select 1 from core_groups x where x.tenant_id = t.id and x.name = 'All members')
            then 'All members (Mosaikit)' else 'All members' end,
       'all'
from core_tenants t;
insert or ignore into core_group_members (group_id, user_id)
select g.id, m.user_id from core_memberships m join core_groups g on g.tenant_id = m.tenant_id and g.builtin = 'all';
