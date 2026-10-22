-- Plugins in the tenants (see migrations/0009_plugins.sql for PostgreSQL).

alter table core_plugins add column available_default boolean not null default true;
alter table core_plugins add column config jsonb not null default '{}';

create table core_tenant_plugins (
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    plugin_id   text not null references core_plugins(id) on delete cascade,
    available   boolean,
    enabled     boolean not null default true,
    updated_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_by  uuid references core_users(id) on delete set null,
    primary key (tenant_id, plugin_id)
);

create table core_extension_values (
    resource_id     uuid not null references core_resources(id) on delete cascade,
    extension_id    text not null references core_plugins(id) on delete cascade,
    tenant_id       uuid not null references core_tenants(id) on delete cascade,
    data            jsonb not null default '{}',
    updated_at      timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_by      uuid references core_users(id) on delete set null,
    primary key (resource_id, extension_id)
);
