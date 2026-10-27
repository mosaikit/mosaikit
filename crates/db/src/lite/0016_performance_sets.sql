-- Performance follow-ups (see migrations/0016_performance_sets.sql for PostgreSQL).

-- snapshots of the platform figures, computed by the background work and read by the KPI page
create table core_kpi_snapshots (
    scope       text primary key,
    computed_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    took_ms     integer not null default 0,
    data        text not null
);
