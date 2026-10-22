-- People and permissions (docs/architecture.md, "People and permissions").
--
-- - last sign-in of a person, suspension of a membership (a suspended membership is not a membership);
-- - permission profiles of a tenant: where the permissions of a User in the plugins start;
-- - grants of plugin permissions to groups and people, added to the profile;
-- - requests of access to items, decided by the owner or a Tenant Manager;
-- - one-time links to choose a new password.

alter table core.users add column last_sign_in_at timestamptz;

alter table core.memberships
    add column status text not null default 'active' check (status in ('active', 'suspended'));

create table core.permission_profiles (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    name        text not null,
    description text not null default '',
    -- the profile of the members without one, and of the new invitations
    is_default  boolean not null default false,
    -- plugin id -> keys of the permissions given; a plugin not listed gives its defaults
    perms       jsonb not null default '{}',
    created_at  timestamptz not null default now(),
    unique (tenant_id, name)
);
create unique index permission_profiles_default on core.permission_profiles (tenant_id) where is_default;

alter table core.memberships
    add column profile_id uuid references core.permission_profiles(id) on delete set null;
alter table core.invitations
    add column profile_id uuid references core.permission_profiles(id) on delete set null;

-- Permissions of a plugin given to a group or a person of the tenant, on top of the profile.
create table core.plugin_grants (
    tenant_id       uuid not null references core.tenants(id) on delete cascade,
    plugin_id       text not null,
    principal_type  text not null check (principal_type in ('user', 'group')),
    principal_id    uuid not null,
    perms           jsonb not null default '[]',
    updated_at      timestamptz not null default now(),
    primary key (tenant_id, plugin_id, principal_type, principal_id)
);

-- A person asks to see (level 1) or edit (level 2) an item they cannot see.
create table core.access_requests (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references core.tenants(id) on delete cascade,
    resource_id     uuid not null references core.resources(id) on delete cascade,
    requester_id    uuid not null references core.users(id) on delete cascade,
    level           smallint not null check (level between 1 and 2),
    message         text not null default '',
    -- forwarded: a Tenant Manager left the decision to the owner
    status          text not null default 'pending' check (status in ('pending', 'forwarded', 'approved', 'refused')),
    decided_by      uuid references core.users(id) on delete set null,
    decided_at      timestamptz,
    created_at      timestamptz not null default now()
);
create index access_requests_tenant on core.access_requests (tenant_id, status);
create unique index access_requests_open on core.access_requests (resource_id, requester_id)
    where status in ('pending', 'forwarded');

-- One-time links to choose a new password (local accounts), created by an Administrator or the
-- Tenant Manager of the home tenant.
create table core.password_resets (
    token_hash  bytea primary key,
    user_id     uuid not null references core.users(id) on delete cascade,
    created_by  uuid references core.users(id) on delete set null,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    used_at     timestamptz
);
create index password_resets_user on core.password_resets (user_id);

-- A suspended membership gives no access, like a disabled account.
create or replace function core.is_member(p_user uuid, p_tenant uuid) returns boolean
language sql stable security definer set search_path = core, pg_temp as $$
    select exists (
        select 1 from core.memberships m
        join core.users u on u.id = m.user_id and u.status = 'active'
        join core.tenants t on t.id = m.tenant_id and t.status = 'active'
        where m.tenant_id = p_tenant and m.user_id = p_user and m.status = 'active'
    )
$$;

-- Every tenant starts with the profile "Standard": the default permissions of every plugin.
insert into core.permission_profiles (tenant_id, name, description, is_default)
select id, 'Standard', 'The permissions every plugin gives by default.', true
from core.tenants where not is_system;
