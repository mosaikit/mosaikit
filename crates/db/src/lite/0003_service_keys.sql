-- Keys of outside services (see migrations/0005_service_keys.sql for PostgreSQL).

create table core_service_keys (
    id          uuid primary key default (gen_random_uuid()),
    scope       text not null check (scope in ('platform', 'tenant', 'user')),
    tenant_id   uuid references core_tenants(id) on delete cascade,
    user_id     uuid references core_users(id) on delete cascade,
    service     text not null,
    secret      bytea not null,
    hint        text not null default '',
    shared      boolean not null default false,
    updated_by  uuid references core_users(id) on delete set null,
    updated_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    check ((scope = 'platform' and tenant_id is null and user_id is null)
        or (scope = 'tenant' and tenant_id is not null and user_id is null)
        or (scope = 'user' and tenant_id is null and user_id is not null))
);
create unique index core_service_keys_one on core_service_keys
    (scope, coalesce(tenant_id, ''), coalesce(user_id, ''), service);
