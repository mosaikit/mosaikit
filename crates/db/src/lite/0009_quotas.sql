-- Quotas of the tenants (see migrations/0011_quotas.sql for PostgreSQL).

create table core_quota_usage (
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    day         text not null,
    storage     bigint not null default 0,
    people      bigint not null default 0,
    items       bigint not null default 0,
    primary key (tenant_id, day)
);

create table core_quota_alerts (
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    metric      text not null check (metric in ('storage', 'people', 'items')),
    level       text not null check (level in ('80', '100', 'forecast')),
    sent_at     timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    primary key (tenant_id, metric, level)
);
