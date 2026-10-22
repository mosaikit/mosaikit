-- Migrations of the plugin: they run with the role of the plugin, only in its schema.
-- Every table must have `resource_id uuid not null` and `tenant_id uuid not null`
-- (default core.ctx_tenant()): the host adds FKs and RLS policies.
-- The kpi_* views (with tenant_id) are read by the managers and by the administrator.

create view kpi_{{table}}_by_status as
  select tenant_id, coalesce(status, '(none)') as status, count(*) as items
  from {{table}}
  group by tenant_id, coalesce(status, '(none)');
