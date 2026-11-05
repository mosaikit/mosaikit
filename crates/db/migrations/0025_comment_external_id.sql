-- A comment brought from another store (import by a Tenant Manager) keeps the id it had there, so
-- that running the import twice adds nothing the second time.
alter table core.resource_comments add column external_id text;
create unique index resource_comments_external on core.resource_comments (resource_id, external_id)
    where external_id is not null;
