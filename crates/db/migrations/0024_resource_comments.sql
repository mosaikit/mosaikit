-- Comments on resources, native to the shell (docs/architecture.md, "Comments on resources").
--
-- Like the schedules, a core table with no RLS: the kernel filters by `tenant_id` and checks the right
-- on the resource in every query. A comment follows its resource: it goes when the resource is deleted for good.
create table core.resource_comments (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    resource_id uuid not null references core.resources(id) on delete cascade,
    user_id     uuid not null references core.users(id) on delete cascade,
    body        text not null check (char_length(body) between 1 and 2000),
    created_at  timestamptz not null default now()
);
create index on core.resource_comments (resource_id, created_at);
