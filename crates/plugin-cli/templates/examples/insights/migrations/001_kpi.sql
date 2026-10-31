-- STEP 4 - the KPI view. Migrations run with the role of the plugin, only in its schema, on PostgreSQL and on SQLite.
-- A `kpi_*` view has `tenant_id`; the other columns are the numbers (labelled in `[[kpi]]`).
create view kpi_{{table}}_by_category as
  select tenant_id,
         coalesce(category, 'other') as category,
         sum(amount) as total,
         count(*) as items
  from {{table}}
  group by tenant_id, coalesce(category, 'other');
