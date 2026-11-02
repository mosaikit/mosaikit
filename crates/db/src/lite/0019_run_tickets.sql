-- Run tickets (see migrations/0021_run_tickets.sql for PostgreSQL). The resource scope of a context
-- is the `core_ctx_scope()` function of the connection (a JSON array), no table.
create table core_run_tickets (
    id          uuid primary key default (gen_random_uuid()),
    token_hash  blob not null unique,
    user_id     uuid not null references core_users(id) on delete cascade,
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    plugin_id   text not null references core_plugins(id) on delete cascade,
    run_ref     text not null,
    commands    jsonb not null,
    resources   jsonb,
    uses_left   integer not null check (uses_left >= 0),
    expires_at  timestamptz not null,
    revoked_at  timestamptz,
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index core_run_tickets_user on core_run_tickets (user_id, tenant_id);
create index core_run_tickets_expires on core_run_tickets (expires_at);
