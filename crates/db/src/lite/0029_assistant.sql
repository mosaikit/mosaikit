-- AI assistant and MCP server (see migrations/0031_assistant.sql for PostgreSQL).
create table core_assistant_settings (
    tenant_id    uuid primary key,
    provider     text not null,
    base_url     text,
    model        text not null,
    secret       blob,
    enabled      boolean not null default true,
    allow_byok   boolean not null default false,
    hourly_limit integer not null default 60 check (hourly_limit >= 1),
    updated_at   timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table core_api_tokens (
    id           uuid primary key default (gen_random_uuid()),
    token_hash   blob not null unique,
    user_id      uuid not null references core_users(id) on delete cascade,
    tenant_id    uuid not null references core_tenants(id) on delete cascade,
    name         text not null,
    allow_write  boolean not null default false,
    expires_at   timestamptz,
    revoked_at   timestamptz,
    last_used_at timestamptz,
    created_at   timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index core_api_tokens_user on core_api_tokens (user_id, tenant_id);
