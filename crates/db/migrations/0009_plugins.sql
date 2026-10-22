-- Plugins in the tenants (docs/architecture.md, "Plugins in the tenants").
--
-- - availability of a plugin to a tenant (the Administrator) and whether the tenant turned it on
--   (the Tenant Manager); a missing row: available as the default of the plugin, and on;
-- - the default availability of a plugin to the tenants that have no row;
-- - the settings of a plugin at platform level (`[[config]]` of the manifest; secrets apart, encrypted
--   in core.secrets);
-- - the values of the fields that extensions add to the items of the plugins they extend.

alter table core.plugins
    add column available_default boolean not null default true,
    add column config jsonb not null default '{}';

create table core.tenant_plugins (
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    plugin_id   text not null references core.plugins(id) on delete cascade,
    -- null: the default of the plugin
    available   boolean,
    enabled     boolean not null default true,
    updated_at  timestamptz not null default now(),
    updated_by  uuid references core.users(id) on delete set null,
    primary key (tenant_id, plugin_id)
);

create table core.extension_values (
    resource_id     uuid not null references core.resources(id) on delete cascade,
    extension_id    text not null references core.plugins(id) on delete cascade,
    tenant_id       uuid not null references core.tenants(id) on delete cascade,
    data            jsonb not null default '{}',
    updated_at      timestamptz not null default now(),
    updated_by      uuid references core.users(id) on delete set null,
    primary key (resource_id, extension_id)
);
