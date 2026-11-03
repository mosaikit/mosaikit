-- Schedules: recurring jobs a person puts on a timetable, run later on their behalf.
-- (docs/architecture.md, "Schedules")
--
-- Like the run tickets, a core table with no RLS: the kernel role filters by `tenant_id` in every query.
-- The columns of the worker (`next_run_at`, `claimed_until`, `consecutive_failures`...) are kept by the
-- kernel; the first version of the feature only stores and lists schedules.
create table core.schedules (
    id                   uuid primary key default gen_random_uuid(),
    tenant_id            uuid not null references core.tenants(id) on delete cascade,
    -- the author: the rights of the job are always the ones this person has when it runs
    user_id              uuid not null references core.users(id) on delete cascade,
    plugin_id            text not null references core.plugins(id) on delete cascade,
    name                 text not null,
    label                text not null default '',
    cron                 text not null,
    args                 jsonb not null default '{}',
    -- JSON array of resource ids the job is limited to (null: the rights of the author)
    resources            jsonb,
    status               text not null default 'active' check (status in ('active', 'paused')),
    paused_reason        text check (paused_reason in
        ('author', 'manager', 'author_inactive', 'failures', 'plugin_off', 'command_removed')),
    next_run_at          timestamptz,
    last_run_at          timestamptz,
    last_status          text,
    consecutive_failures integer not null default 0,
    -- lease of a run in flight (or of a dead worker)
    claimed_until        timestamptz,
    created_at           timestamptz not null default now()
);
create index on core.schedules (next_run_at) where status = 'active';
create index on core.schedules (tenant_id, plugin_id);
create index on core.schedules (user_id, tenant_id);
