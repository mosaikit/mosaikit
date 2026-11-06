-- Run tickets that reach other plugins (see migrations/0026_run_targets.sql for PostgreSQL).
alter table core_run_tickets add column targets jsonb;
