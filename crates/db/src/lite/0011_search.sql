-- Search of the shell and preferences of a person (see migrations/0013_search.sql for PostgreSQL).
-- SQLite has no tsvector: the search compares the words with `like` on title and search_text.

alter table core_resources add column search_text text;

create table core_person_prefs (
    user_id     uuid primary key references core_users(id) on delete cascade,
    prefs       jsonb not null default '{}',
    updated_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
