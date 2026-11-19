-- The settings of a plugin that belong to one tenant (`[[config]] scope = "tenant"`): one row per tenant, plugin
-- and key, chosen by the Tenant Manager. The secrets of this scope are not here: they are encrypted in
-- core.secrets under `plugin:<id>:t:<tenant>:<key>`. Keys are matched by name, so a key that leaves the manifest
-- keeps its row (ignored) and finds its value again if it comes back.
create table core.plugin_settings (
    tenant_id  uuid not null references core.tenants(id) on delete cascade,
    plugin     text not null,
    key        text not null,
    value      jsonb not null,
    updated_by uuid references core.users(id) on delete set null,
    updated_at timestamptz not null default now(),
    primary key (tenant_id, plugin, key)
);
