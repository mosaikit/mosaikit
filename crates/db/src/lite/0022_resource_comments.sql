-- Comments on resources (see migrations/0024_resource_comments.sql for PostgreSQL).
create table core_resource_comments (
    id          uuid primary key default (gen_random_uuid()),
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    resource_id uuid not null references core_resources(id) on delete cascade,
    user_id     uuid not null references core_users(id) on delete cascade,
    body        text not null check (length(body) between 1 and 2000),
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index core_resource_comments_resource on core_resource_comments (resource_id, created_at);
