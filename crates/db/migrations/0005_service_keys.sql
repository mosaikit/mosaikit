-- Keys of outside services (AI providers, text messages, translation...) at three levels: platform,
-- tenant and person. The value is encrypted by the kernel with the secret key of the installation,
-- which is not in the database (see docs/architecture.md, configuration); `hint` keeps the last four
-- characters to show. A shared key of the platform serves the tenants without one of their own; a
-- shared key of a tenant serves its people, otherwise only its Tenant Managers.

create table core.service_keys (
    id          uuid primary key default gen_random_uuid(),
    scope       text not null check (scope in ('platform', 'tenant', 'user')),
    tenant_id   uuid references core.tenants(id) on delete cascade,
    user_id     uuid references core.users(id) on delete cascade,
    service     text not null,
    secret      bytea not null,
    hint        text not null default '',
    shared      boolean not null default false,
    updated_by  uuid references core.users(id) on delete set null,
    updated_at  timestamptz not null default now(),
    check ((scope = 'platform' and tenant_id is null and user_id is null)
        or (scope = 'tenant' and tenant_id is not null and user_id is null)
        or (scope = 'user' and tenant_id is null and user_id is not null))
);
create unique index service_keys_one on core.service_keys
    (scope, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'),
     coalesce(user_id, '00000000-0000-0000-0000-000000000000'), service);
