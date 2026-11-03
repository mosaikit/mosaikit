-- Schedules (see migrations/0022_schedules.sql for PostgreSQL).
create table core_schedules (
    id                   uuid primary key default (gen_random_uuid()),
    tenant_id            uuid not null references core_tenants(id) on delete cascade,
    user_id              uuid not null references core_users(id) on delete cascade,
    plugin_id            text not null references core_plugins(id) on delete cascade,
    name                 text not null,
    label                text not null default '',
    cron                 text not null,
    args                 jsonb not null default '{}',
    resources            jsonb,
    status               text not null default 'active' check (status in ('active', 'paused')),
    paused_reason        text check (paused_reason in
        ('author', 'manager', 'author_inactive', 'failures', 'plugin_off', 'command_removed')),
    next_run_at          timestamptz,
    last_run_at          timestamptz,
    last_status          text,
    consecutive_failures integer not null default 0,
    claimed_until        timestamptz,
    created_at           timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index core_schedules_next on core_schedules (next_run_at) where status = 'active';
create index core_schedules_plugin on core_schedules (tenant_id, plugin_id);
create index core_schedules_user on core_schedules (user_id, tenant_id);
