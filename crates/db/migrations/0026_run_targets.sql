-- Run tickets that reach other plugins (docs/architecture.md, "Run tickets", Targets).
-- JSON array of { plugin, commands, resources }: the plugins besides `plugin_id` that the ticket may call,
-- each with its own commands (a subset of that plugin's `run_commands`) and its own resource scope.
alter table core.run_tickets add column targets jsonb;
