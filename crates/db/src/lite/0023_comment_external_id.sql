-- See migrations/0025_comment_external_id.sql for PostgreSQL.
alter table core_resource_comments add column external_id text;
create unique index core_resource_comments_external on core_resource_comments (resource_id, external_id)
    where external_id is not null;
