-- Administrator come account di piattaforma (vedi migrations/0003_admins.sql per PostgreSQL).

alter table core_users add column totp_secret text;
alter table core_users add column totp_enabled boolean not null default false;
alter table core_users add column totp_last_step bigint not null default 0;
alter table core_users add column totp_recovery text not null default '[]';

alter table core_sessions add column pending text check (pending in ('totp', 'totp_setup'));

insert into core_users (home_tenant_id, username, display_name, email, password_hash, is_system_admin)
select s.id,
       case when exists (select 1 from core_users x where x.home_tenant_id = s.id and x.username = u.username)
            then substr(u.username || '-' || t.slug, 1, 64) else u.username end,
       u.display_name, u.email, u.password_hash, 1
from core_users u
join core_tenants t on t.id = u.home_tenant_id and not t.is_system
cross join (select id from core_tenants where is_system) s
where u.is_system_admin;

update core_users set is_system_admin = 0
where is_system_admin and home_tenant_id not in (select id from core_tenants where is_system);

update core_users set status = 'disabled'
where not is_system_admin and home_tenant_id in (select id from core_tenants where is_system);

delete from core_grants
where principal_type = 'user'
  and principal_id in (select u.id from core_users u join core_tenants t on t.id = u.home_tenant_id where t.is_system);
delete from core_group_members
where user_id in (select u.id from core_users u join core_tenants t on t.id = u.home_tenant_id where t.is_system);
delete from core_invitations
where tenant_id in (select id from core_tenants where is_system)
   or user_id in (select u.id from core_users u join core_tenants t on t.id = u.home_tenant_id where t.is_system);
delete from core_memberships
where tenant_id in (select id from core_tenants where is_system)
   or user_id in (select u.id from core_users u join core_tenants t on t.id = u.home_tenant_id where t.is_system);

delete from core_sessions;
