-- Quotas of the tenants (docs/architecture.md, quotas). The limits live in the settings of the tenants
-- (`quota`, set by the Administrator); the usage is measured from the data itself. Here only:
--
-- - the usage of each tenant at the end of each day, for the trend and the forecast;
-- - the alerts already sent, so that each threshold warns once per crossing.

create table core.quota_usage (
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    -- the day in UTC, YYYY-MM-DD
    day         text not null,
    storage     bigint not null default 0,
    people      bigint not null default 0,
    items       bigint not null default 0,
    primary key (tenant_id, day)
);

create table core.quota_alerts (
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    metric      text not null check (metric in ('storage', 'people', 'items')),
    level       text not null check (level in ('80', '100', 'forecast')),
    sent_at     timestamptz not null default now(),
    primary key (tenant_id, metric, level)
);
