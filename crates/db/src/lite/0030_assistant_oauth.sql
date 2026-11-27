-- OAuth for the MCP server (see migrations/0032_assistant_oauth.sql for PostgreSQL).
create table core_oauth_clients (
    client_id     text primary key,
    name          text not null,
    redirect_uris jsonb not null,
    created_at    timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table core_oauth_grants (
    id             uuid primary key default (gen_random_uuid()),
    client_id      text not null references core_oauth_clients(client_id) on delete cascade,
    tenant_id      uuid not null references core_tenants(id) on delete cascade,
    redirect_uri   text not null,
    code_challenge text not null,
    state          text,
    user_id        uuid references core_users(id) on delete cascade,
    allow_write    boolean not null default false,
    code_hash      blob unique,
    status         text not null default 'pending' check (status in ('pending', 'approved', 'used', 'denied')),
    expires_at     timestamptz not null,
    created_at     timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

alter table core_api_tokens add column client_id text references core_oauth_clients(client_id) on delete cascade;
alter table core_api_tokens add column refresh_hash blob;
alter table core_api_tokens add column refresh_expires_at timestamptz;
create unique index core_api_tokens_refresh on core_api_tokens (refresh_hash) where refresh_hash is not null;
