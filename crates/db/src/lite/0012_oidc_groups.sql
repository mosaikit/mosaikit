-- Groups of the identity provider mirrored in the tenant (see migrations/0014_oidc_groups.sql for PostgreSQL).

alter table core_tenant_oidc add column sync_groups boolean not null default false;
alter table core_tenant_oidc add column group_prefix text not null default '';

alter table core_groups add column source text not null default 'mosaikit' check (source in ('mosaikit', 'idp'));
alter table core_groups add column external_name text;
create unique index groups_external on core_groups (tenant_id, external_name) where external_name is not null;
