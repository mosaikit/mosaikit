-- Schedules, step 2: the worker (docs/architecture.md, "Schedules").
-- A time zone and a catch-up flag per schedule, the runs the worker started, and the link from a run ticket
-- to the schedule that minted it.
alter table core.schedules add column time_zone text not null default 'UTC';
alter table core.schedules add column catch_up_once boolean not null default false;

alter table core.run_tickets add column schedule_id uuid references core.schedules(id) on delete set null;
create index on core.run_tickets (schedule_id) where schedule_id is not null;

-- One row per run the worker started (or tried to start). `service_run_id` is the id the service answered
-- with when it accepted the push; the result is read later from the service with it.
create table core.schedule_runs (
    id             uuid primary key default gen_random_uuid(),
    schedule_id    uuid not null references core.schedules(id) on delete cascade,
    tenant_id      uuid not null references core.tenants(id) on delete cascade,
    ticket_id      uuid references core.run_tickets(id) on delete set null,
    run_ref        text not null,
    started_by     text not null default 'timetable' check (started_by in ('timetable', 'manual')),
    status         text not null default 'running'
        check (status in ('running', 'succeeded', 'failed', 'timed_out')),
    service_run_id text,
    error          text,
    started_at     timestamptz not null default now(),
    -- after this the run is `timed_out` (the longest run of the declaration, at most one hour)
    deadline_at    timestamptz not null,
    finished_at    timestamptz
);
create index on core.schedule_runs (schedule_id, started_at desc);
create index on core.schedule_runs (deadline_at) where status = 'running';
