-- STEP 4 - the KPI. Migrations run with the role of the plugin, only in its schema, on PostgreSQL and on SQLite
-- (write plain SQL that both accept). Every table has `resource_id` and `tenant_id`, added by the host.
-- A `kpi_*` view must have `tenant_id`; the other columns are the numbers shown (named in `[[kpi]]`).
create view kpi_{{table}}_status as
  select tenant_id,
         count(*) filter (where not coalesce(done, false)) as open,
         count(*) filter (where coalesce(done, false)) as completed,
         count(*) filter (where not coalesce(done, false) and due < current_date) as overdue
  from {{table}}
  group by tenant_id;
