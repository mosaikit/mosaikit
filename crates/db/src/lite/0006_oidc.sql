-- Sign-in through an identity provider (OIDC) per tenant (see migrations/0008_oidc.sql for PostgreSQL).

create table core_tenant_oidc (
    tenant_id       uuid primary key references core_tenants(id) on delete cascade,
    enabled         boolean not null default false,
    issuer          text not null,
    client_id       text not null,
    client_secret   bytea,
    secret_hint     text not null default '',
    scopes          text not null default 'openid profile email',
    button_text     text not null default '',
    roles_source    text not null default 'mosaikit' check (roles_source in ('mosaikit', 'idp')),
    manager_groups  jsonb not null default '[]',
    user_groups     jsonb not null default '[]',
    claim_username  text not null default 'preferred_username',
    claim_name      text not null default 'name',
    claim_email     text not null default 'email',
    claim_groups    text not null default 'groups',
    updated_by      uuid references core_users(id) on delete set null,
    updated_at      timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table core_user_identities (
    issuer      text not null,
    subject     text not null,
    user_id     uuid not null references core_users(id) on delete cascade,
    tenant_id   uuid not null references core_tenants(id) on delete cascade,
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_login  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    primary key (tenant_id, issuer, subject)
);
create index core_user_identities_user on core_user_identities (user_id);

alter table core_sessions add column oidc_sid text;
create index core_sessions_oidc_sid on core_sessions (oidc_sid) where oidc_sid is not null;
