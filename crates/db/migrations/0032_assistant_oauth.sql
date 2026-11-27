-- OAuth for the MCP server (docs/architecture.md, "AI assistant"): clients that registered themselves, the grants the person
-- approves, and the refresh token of an access token (an access token is a row of core.api_tokens).

create table core.oauth_clients (
    client_id     text primary key,
    name          text not null,
    redirect_uris jsonb not null,
    created_at    timestamptz not null default now()
);

-- A request to connect: pending until the person decides, then it holds the code the client exchanges (once) for tokens.
create table core.oauth_grants (
    id             uuid primary key default gen_random_uuid(),
    client_id      text not null references core.oauth_clients(client_id) on delete cascade,
    tenant_id      uuid not null references core.tenants(id) on delete cascade,
    redirect_uri   text not null,
    code_challenge text not null,
    state          text,
    user_id        uuid references core.users(id) on delete cascade,
    allow_write    boolean not null default false,
    code_hash      bytea unique,
    status         text not null default 'pending' check (status in ('pending', 'approved', 'used', 'denied')),
    expires_at     timestamptz not null,
    created_at     timestamptz not null default now()
);

alter table core.api_tokens add column client_id text references core.oauth_clients(client_id) on delete cascade;
alter table core.api_tokens add column refresh_hash bytea unique;
alter table core.api_tokens add column refresh_expires_at timestamptz;
