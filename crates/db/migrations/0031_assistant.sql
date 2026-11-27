-- AI assistant and MCP server (docs/architecture.md, "AI assistant").

-- Provider settings. `tenant_id` is the nil uuid for the platform row (set by the system Administrator) and the id of a
-- tenant for a row the Manager brought (only when the platform row has `allow_byok`). The key is sealed (SecretBox).
create table core.assistant_settings (
    tenant_id    uuid primary key,
    provider     text not null,
    base_url     text,
    model        text not null,
    secret       bytea,
    enabled      boolean not null default true,
    allow_byok   boolean not null default false,
    hourly_limit integer not null default 60 check (hourly_limit >= 1),
    updated_at   timestamptz not null default now()
);

-- Personal access tokens of the MCP server: one person, one tenant. Only the hash of the token is kept.
create table core.api_tokens (
    id           uuid primary key default gen_random_uuid(),
    token_hash   bytea not null unique,
    user_id      uuid not null references core.users(id) on delete cascade,
    tenant_id    uuid not null references core.tenants(id) on delete cascade,
    name         text not null,
    allow_write  boolean not null default false,
    expires_at   timestamptz,
    revoked_at   timestamptz,
    last_used_at timestamptz,
    created_at   timestamptz not null default now()
);
create index on core.api_tokens (user_id, tenant_id);
