-- Migrazioni del plugin: girano con il ruolo del plugin, solo nel suo schema.
-- Ogni tabella deve avere `resource_id uuid not null` e `tenant_id uuid not null`
-- (default core.ctx_tenant()): l'host aggiunge FK e policy RLS.
-- Le viste kpi_* (con tenant_id) sono lette dai gestori e dall'amministratore.

create view kpi_{{table}}_by_status as
  select tenant_id, coalesce(status, '(nessuno)') as stato, count(*) as elementi
  from {{table}}
  group by tenant_id, coalesce(status, '(nessuno)');
