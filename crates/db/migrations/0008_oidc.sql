-- Sign-in through an identity provider (OIDC) per tenant (docs/architecture.md, OIDC).
--
-- A tenant signs in either with local accounts or with its identity provider, never both: a row with
-- `enabled` makes it an OIDC tenant. The client secret is encrypted by the kernel with the secret key
-- of the installation (`secret_hint` keeps the last four characters to show). `roles_source` says where
-- the roles come from: 'mosaikit' (the Tenant Manager gives them) or 'idp' (the groups of the token,
-- through `manager_groups` and `user_groups`, read at every sign-in).

create table core.tenant_oidc (
    tenant_id       uuid primary key references core.tenants(id) on delete cascade,
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
    updated_by      uuid references core.users(id) on delete set null,
    updated_at      timestamptz not null default now()
);

-- The people of an OIDC tenant: issuer + `sub` of the token, never linked to an account by email. The
-- key includes the tenant: two tenants trusting the same provider give a person two separate accounts.
create table core.user_identities (
    issuer      text not null,
    subject     text not null,
    user_id     uuid not null references core.users(id) on delete cascade,
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    created_at  timestamptz not null default now(),
    last_login  timestamptz not null default now(),
    primary key (tenant_id, issuer, subject)
);
create index user_identities_user on core.user_identities (user_id);

-- The session of the identity provider (`sid`), for the back-channel logout.
alter table core.sessions add column oidc_sid text;
create index sessions_oidc_sid on core.sessions (oidc_sid) where oidc_sid is not null;
