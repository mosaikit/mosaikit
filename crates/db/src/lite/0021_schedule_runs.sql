-- Schedules, step 2 (see migrations/0023_schedule_runs.sql for PostgreSQL).
alter table core_schedules add column time_zone text not null default 'UTC';
alter table core_schedules add column catch_up_once boolean not null default false;

alter table core_run_tickets add column schedule_id uuid references core_schedules(id) on delete set null;
create index core_run_tickets_schedule on core_run_tickets (schedule_id) where schedule_id is not null;

create table core_schedule_runs (
    id             uuid primary key default (gen_random_uuid()),
    schedule_id    uuid not null references core_schedules(id) on delete cascade,
    tenant_id      uuid not null references core_tenants(id) on delete cascade,
    ticket_id      uuid references core_run_tickets(id) on delete set null,
    run_ref        text not null,
    started_by     text not null default 'timetable' check (started_by in ('timetable', 'manual')),
    status         text not null default 'running'
        check (status in ('running', 'succeeded', 'failed', 'timed_out')),
    service_run_id text,
    error          text,
    started_at     timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deadline_at    timestamptz not null,
    finished_at    timestamptz
);
create index core_schedule_runs_schedule on core_schedule_runs (schedule_id, started_at desc);
create index core_schedule_runs_deadline on core_schedule_runs (deadline_at) where status = 'running';
