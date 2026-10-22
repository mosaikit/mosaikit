-- Mosaikit on SQLite: core schema (the same tables as PostgreSQL, prefix core_).
-- uuids and instants are text (instants: RFC 3339 with milliseconds, UTC, sortable),
-- jsonb and arrays are JSON, boolean is 0/1. The type names stay the ones of
-- PostgreSQL for readability (the SQLite affinity is the right one).
-- Access levels and context are computed as in PostgreSQL: see
-- mosaikit_sql_guard::sqlite (SQL templates) and the functions core_ctx_*().

create table core_tenants (
    id          uuid primary key default (gen_random_uuid()),
    slug        text not null unique,
    name        text not null,
    status      text not null default 'active' check (status in ('active', 'suspended')),
    is_system   boolean not null default false,
    settings    jsonb not null default '{}',
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table core_users (
    id              uuid primary key default (gen_random_uuid()),
    home_tenant_id  uuid not null references core_tenants(id),
    username        text not null,
    display_name    text not null default '',
    email           text,
    password_hash   text,
    status          text not null default 'active' check (status in ('active', 'disabled')),
    is_system_admin boolean not null default false,
    created_at      timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    unique (home_tenant_id, username)
);

create table core_memberships (
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    user_id     uuid not null references core_users(id) on delete cascade,
    role        text not null check (role in ('tenant_manager', 'user')),
    invited_by  uuid references core_users(id) on delete set null,
    joined_at   timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    primary key (tenant_id, user_id)
);
create index core_memberships_user on core_memberships (user_id);

create table core_invitations (
    id          uuid primary key default (gen_random_uuid()),
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    user_id     uuid not null references core_users(id) on delete cascade,
    role        text not null check (role in ('tenant_manager', 'user')),
    invited_by  uuid references core_users(id) on delete set null,
    status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+14 days'))
);
create index core_invitations_user on core_invitations (user_id, status);

create table core_sessions (
    token_hash  blob primary key,
    user_id     uuid not null references core_users(id) on delete cascade,
    csrf        text not null,
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at  timestamptz not null,
    last_seen   timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index core_sessions_user on core_sessions (user_id);

create table core_groups (
    id          uuid primary key default (gen_random_uuid()),
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    name        text not null,
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    unique (tenant_id, name)
);

create table core_group_members (
    group_id    uuid not null references core_groups(id) on delete cascade,
    user_id     uuid not null references core_users(id) on delete cascade,
    primary key (group_id, user_id)
);
create index core_group_members_user on core_group_members (user_id);

create table core_user_prefs (
    user_id     uuid not null references core_users(id) on delete cascade,
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    prefs       jsonb not null default '{}',
    primary key (user_id, tenant_id)
);

-- ---------------------------------------------------------------- plugin

create table core_plugins (
    id                  text primary key,
    version             text not null,
    manifest            jsonb not null,
    sha256              text not null,
    signed_by           text,
    status              text not null default 'installed' check (status in ('installed', 'active', 'blocked')),
    dev                 boolean not null default false,
    schema_name         text not null unique,
    role_name           text not null unique,
    role_password       text not null,
    installed_at        timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table core_plugin_migrations (
    plugin_id   text not null references core_plugins(id) on delete cascade,
    version     int not null,
    name        text not null,
    checksum    text not null,
    applied_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    primary key (plugin_id, version)
);

-- views of the plugins (not KPI): expanded at every use, with the filters of the context
create table core_plugin_views (
    plugin_id   text not null references core_plugins(id) on delete cascade,
    name        text not null,
    sql         text not null,
    primary key (plugin_id, name)
);

-- ---------------------------------------------------------------- resources and permissions

create table core_resources (
    id          uuid primary key default (gen_random_uuid()),
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    plugin_id   text not null references core_plugins(id) on delete cascade,
    kind        text not null,
    parent_id   uuid references core_resources(id) on delete cascade,
    -- ancestors from the root to the parent (JSON array)
    ancestors   uuid[] not null default '[]',
    owner_id    uuid not null references core_users(id),
    title       text not null default '',
    size_bytes  bigint not null default 0,
    meta        jsonb not null default '{}',
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index core_resources_tpk on core_resources (tenant_id, plugin_id, kind);
create index core_resources_owner on core_resources (owner_id);
create index core_resources_parent on core_resources (parent_id);

create table core_grants (
    resource_id     uuid not null references core_resources(id) on delete cascade,
    principal_type  text not null check (principal_type in ('user', 'group')),
    principal_id    uuid not null,
    level           smallint not null check (level between 1 and 3),
    granted_by      uuid references core_users(id) on delete set null,
    granted_at      timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    primary key (resource_id, principal_type, principal_id)
);
create index core_grants_principal on core_grants (principal_type, principal_id);

create table core_public_links (
    id              uuid primary key default (gen_random_uuid()),
    resource_id     uuid not null references core_resources(id) on delete cascade,
    token_hash      blob not null unique,
    expires_at      timestamptz,
    password_hash   text,
    created_by      uuid references core_users(id) on delete set null,
    created_at      timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    revoked_at      timestamptz,
    view_count      bigint not null default 0
);
create index core_public_links_resource on core_public_links (resource_id);

create table core_tickets (
    token_hash      blob primary key,
    resource_id     uuid not null references core_resources(id) on delete cascade,
    user_id         uuid not null references core_users(id) on delete cascade,
    tenant_id       uuid not null references core_tenants(id) on delete cascade,
    session_hash    blob not null references core_sessions(token_hash) on delete cascade,
    download        boolean not null default false,
    expires_at      timestamptz not null
);

create table core_events (
    id          integer primary key autoincrement,
    ts          timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    tenant_id   uuid references core_tenants(id) on delete cascade,
    user_id     uuid references core_users(id) on delete set null,
    plugin_id   text,
    resource_id uuid,
    action      text not null,
    detail      jsonb not null default '{}'
);
create index core_events_tenant_ts on core_events (tenant_id, ts);

create table core_secrets (
    name    text primary key,
    value   blob not null
);
