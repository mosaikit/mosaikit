-- Groups of the identity provider mirrored in the tenant (docs/architecture.md, OIDC).
--
-- With `sync_groups` the groups of the token (claim `claim_groups`, only those starting with
-- `group_prefix` when it is set) become groups of the tenant at every sign-in: created when new, the
-- membership of the person refreshed. They are read-only in Mosaikit (`source = 'idp'`): only the provider
-- changes them. A group the provider no longer sends loses its members as they sign in again; it is
-- never deleted, so the items shared with it keep their grants.

alter table core.tenant_oidc add column sync_groups boolean not null default false;
alter table core.tenant_oidc add column group_prefix text not null default '';

alter table core.groups add column source text not null default 'mosaikit' check (source in ('mosaikit', 'idp'));
-- the name of the group in the provider (the name in Mosaikit may differ when it was already taken)
alter table core.groups add column external_name text;
create unique index groups_external on core.groups (tenant_id, external_name) where external_name is not null;
