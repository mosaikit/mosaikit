-- AI assistant: the models, besides the default one, that people (not only the Tenant Managers) may choose (JSON array of ids).
alter table core.assistant_settings add column user_models jsonb not null default '[]'::jsonb;
