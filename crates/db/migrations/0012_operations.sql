-- Lifecycle of the tenants and operations of the platform (phase 7).
--
-- Tenants: an optional end of the trial period (with the notices already sent: 1 a week before, 2 a
-- day before) and the archive (a suspended tenant kept as it is, reversible).
--
-- Backups: one row per backup of the installation (file in <data_dir>/backups).
--
-- Metrics: one snapshot per minute of the requests, the errors, the latencies and the queues (the
-- Monitoring pages read them); alerts: the state of each condition, so that a crossing is notified once.

alter table core.tenants
    add column trial_until timestamptz,
    add column trial_notice smallint not null default 0,
    add column archived_at timestamptz;

create table core.backups (
    id          uuid primary key default gen_random_uuid(),
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    status      text not null default 'running' check (status in ('running', 'ok', 'failed')),
    manual      boolean not null default false,
    file        text not null default '',
    size_bytes  bigint not null default 0,
    -- the dump of the whole database is inside (pg_dump or the copy of the SQLite file)
    whole       boolean not null default false,
    tenants     int not null default 0,
    error       text not null default '',
    created_by  uuid references core.users(id) on delete set null
);
create index on core.backups (started_at);

create table core.metrics (
    ts           timestamptz primary key,
    requests     bigint not null default 0,
    errors       bigint not null default 0,
    p50_ms       double precision not null default 0,
    p95_ms       double precision not null default 0,
    p99_ms       double precision not null default 0,
    sessions     int not null default 0,
    mail_pending int not null default 0,
    mail_failed  int not null default 0,
    db_ms        double precision not null default 0,
    -- requests per tenant in the minute: {"<tenant id>": n}
    tenants      jsonb not null default '{}'
);

create table core.alerts (
    key         text primary key,
    active      boolean not null default false,
    since       timestamptz,
    detail      text not null default '',
    notified_at timestamptz
);
