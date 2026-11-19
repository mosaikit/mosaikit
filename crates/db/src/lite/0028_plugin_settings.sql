-- The settings of a plugin that belong to one tenant (see migrations/0030_plugin_settings.sql for PostgreSQL).
create table core_plugin_settings (
    tenant_id  uuid not null references core_tenants(id) on delete cascade,
    plugin     text not null,
    key        text not null,
    value      jsonb not null,
    updated_by uuid references core_users(id) on delete set null,
    updated_at timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    primary key (tenant_id, plugin, key)
);
