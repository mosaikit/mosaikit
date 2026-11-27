-- AI assistant: the models people may choose (see migrations/0033_assistant_models.sql for PostgreSQL).
alter table core_assistant_settings add column user_models jsonb not null default '[]';
