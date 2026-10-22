-- Search of the shell and preferences of a person (docs/architecture.md, search).
--
-- `search_text`: the searchable fields of an item (the title is apart), written by the kernel after each
-- create and update; null = not indexed yet (the background worker fills it in). `search_vec`: words
-- for the full-text search, with the `simple` configuration (no stemming, the same for every language).

alter table core.resources add column search_text text;
alter table core.resources add column search_vec tsvector
    generated always as (to_tsvector('simple', title || ' ' || coalesce(search_text, ''))) stored;
create index resources_search_vec on core.resources using gin (search_vec);

-- Preferences of a person that follow them everywhere (every tenant, every device): high contrast,
-- guided tours already seen.
create table core.person_prefs (
    user_id     uuid primary key references core.users(id) on delete cascade,
    prefs       jsonb not null default '{}',
    updated_at  timestamptz not null default now()
);
