-- Performance at scale (see migrations/0015_performance.sql for PostgreSQL, docs/reports/performance.md).

-- a page of the Log is `order by id desc limit 51` with the filters in use (no index on (user_id, id) as on
-- PostgreSQL: SQLite would pick it for count(distinct user_id) over a period and read every event)
create index core_events_tenant_id on core_events (tenant_id, id);
create index core_events_failed on core_events (tenant_id, id) where not ok;

-- count and storage of a tenant (quotas at every addition, tenant lists, monitoring) from the index alone
create index core_resources_tenant_size on core_resources (tenant_id, size_bytes);

-- the items the search has not indexed yet
create index core_resources_unindexed on core_resources (id) where search_text is null;
