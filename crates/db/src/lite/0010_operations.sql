-- Lifecycle of the tenants and operations of the platform (phase 7), as in the PostgreSQL migration
-- 0011: end of the trial and archive of the tenants, backups, metrics per minute, state of the alerts.

alter table core_tenants add column trial_until timestamptz;
alter table core_tenants add column trial_notice smallint not null default 0;
alter table core_tenants add column archived_at timestamptz;

create table core_backups (
    id          uuid primary key default (gen_random_uuid()),
    started_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at timestamptz,
    status      text not null default 'running' check (status in ('running', 'ok', 'failed')),
    manual      boolean not null default false,
    file        text not null default '',
    size_bytes  bigint not null default 0,
    whole       boolean not null default false,
    tenants     int not null default 0,
    error       text not null default '',
    created_by  uuid references core_users(id) on delete set null
);
create index core_backups_started on core_backups (started_at);

create table core_metrics (
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
    tenants      jsonb not null default '{}'
);

create table core_alerts (
    key         text primary key,
    active      boolean not null default false,
    since       timestamptz,
    detail      text not null default '',
    notified_at timestamptz
);
