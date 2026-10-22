-- People and permissions (see migrations/0007_people.sql for PostgreSQL). The membership check of
-- SQLite (`core.is_member`, expanded by sql-guard) reads `core_memberships.status`.

alter table core_users add column last_sign_in_at timestamptz;

alter table core_memberships
    add column status text not null default 'active' check (status in ('active', 'suspended'));

create table core_permission_profiles (
    id          uuid primary key default (gen_random_uuid()),
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    name        text not null,
    description text not null default '',
    is_default  boolean not null default false,
    perms       jsonb not null default '{}',
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    unique (tenant_id, name)
);
create unique index core_permission_profiles_default on core_permission_profiles (tenant_id) where is_default;

alter table core_memberships
    add column profile_id uuid references core_permission_profiles(id) on delete set null;
alter table core_invitations
    add column profile_id uuid references core_permission_profiles(id) on delete set null;

create table core_plugin_grants (
    tenant_id       uuid not null references core_tenants(id) on delete cascade,
    plugin_id       text not null,
    principal_type  text not null check (principal_type in ('user', 'group')),
    principal_id    uuid not null,
    perms           jsonb not null default '[]',
    updated_at      timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    primary key (tenant_id, plugin_id, principal_type, principal_id)
);

create table core_access_requests (
    id              uuid primary key default (gen_random_uuid()),
    tenant_id       uuid not null references core_tenants(id) on delete cascade,
    resource_id     uuid not null references core_resources(id) on delete cascade,
    requester_id    uuid not null references core_users(id) on delete cascade,
    level           smallint not null check (level between 1 and 2),
    message         text not null default '',
    status          text not null default 'pending' check (status in ('pending', 'forwarded', 'approved', 'refused')),
    decided_by      uuid references core_users(id) on delete set null,
    decided_at      timestamptz,
    created_at      timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index core_access_requests_tenant on core_access_requests (tenant_id, status);
create unique index core_access_requests_open on core_access_requests (resource_id, requester_id)
    where status in ('pending', 'forwarded');

create table core_password_resets (
    token_hash  blob primary key,
    user_id     uuid not null references core_users(id) on delete cascade,
    created_by  uuid references core_users(id) on delete set null,
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at  timestamptz not null,
    used_at     timestamptz
);
create index core_password_resets_user on core_password_resets (user_id);

insert into core_permission_profiles (tenant_id, name, description, is_default)
select id, 'Standard', 'The permissions every plugin gives by default.', true
from core_tenants where not is_system;
