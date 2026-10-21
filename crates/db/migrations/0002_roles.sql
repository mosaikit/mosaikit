-- Ruoli espliciti: Administrator (core.users.is_system_admin, tutto il sistema),
-- Tenant Manager e User (per tenant, in core.memberships e core.invitations).

alter table core.memberships drop constraint memberships_role_check;
alter table core.invitations drop constraint invitations_role_check;

update core.memberships set role = case role when 'manager' then 'tenant_manager' else 'user' end;
update core.invitations set role = case role when 'manager' then 'tenant_manager' else 'user' end;

alter table core.memberships add constraint memberships_role_check check (role in ('tenant_manager', 'user'));
alter table core.invitations add constraint invitations_role_check check (role in ('tenant_manager', 'user'));
