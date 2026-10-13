-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-055, ADR-0037: one sharing model for the resources of every extension. A registered resource
-- (V16) is shared with a subject (a person, a group, the organization, a link, the public) at a
-- level that the extension declares for its type. Grants go with their resource, their person and
-- their team. Under row-level security like the registry: a request sees and writes only the
-- grants of its organization.

-- The levels of the resource types of the active extensions, from the lowest (rank 0) to the
-- highest, as their manifests list them: the kernel writes them at start and after an installation,
-- so that mk_kernel.allows() orders levels in the database as the Java answers do. Not data of an
-- organization: no row-level security.
create table sharing_level (
    extension_id varchar(255) not null,
    type         varchar(48)  not null,
    level        varchar(64)  not null,
    rank         integer      not null,
    constraint sharing_level_pk primary key (extension_id, type, level),
    constraint sharing_level_rank_ck check (rank >= 0)
);

create table resource_grant (
    id              uuid        primary key,
    organization_id uuid        not null default current_organization(),
    resource_id     uuid        not null,
    subject_kind    varchar(16) not null,
    -- The person of a 'person' grant, the team of a 'group' grant.
    account_id      uuid,
    team_id         uuid,
    level           varchar(64) not null,
    -- The account of the person who shared; no foreign key: the grant stays when they leave.
    granted_by      uuid        not null,
    granted_at      timestamptz not null,
    -- A 'link' grant: the SHA-256 of its secret (never the secret), its expiry, the hash of its
    -- optional password, and when it was revoked: a revoked link is kept, so that it answers 404 and
    -- its uses stay explained in the audit log.
    token_digest    varchar(64),
    expires_at      timestamptz,
    password_hash   varchar(255),
    revoked_at      timestamptz,
    constraint resource_grant_kind_ck
        check (subject_kind in ('person', 'group', 'organization', 'link', 'public')),
    constraint resource_grant_person_ck check ((subject_kind = 'person') = (account_id is not null)),
    constraint resource_grant_group_ck check ((subject_kind = 'group') = (team_id is not null)),
    constraint resource_grant_link_ck
        check ((subject_kind = 'link') = (token_digest is not null and expires_at is not null)),
    constraint resource_grant_link_only_ck
        check (subject_kind = 'link' or (password_hash is null and revoked_at is null)),
    constraint resource_grant_token_uk unique (token_digest),
    constraint resource_grant_organization_fk foreign key (organization_id) references organization (id) on delete cascade,
    constraint resource_grant_resource_fk foreign key (resource_id) references resource (id) on delete cascade,
    constraint resource_grant_account_fk foreign key (account_id) references user_account (id) on delete cascade,
    constraint resource_grant_team_fk foreign key (team_id) references team (id) on delete cascade
);

-- A subject has at most one grant on a resource: granting again replaces its level. Links are not
-- subjects that are granted again: a resource has as many links as people make.
create unique index resource_grant_subject_uk on resource_grant
    (resource_id, subject_kind, coalesce(account_id, team_id, '00000000-0000-0000-0000-000000000000'::uuid))
    where subject_kind <> 'link';
create index resource_grant_resource_ix on resource_grant (resource_id);
create index resource_grant_account_ix on resource_grant (account_id) where account_id is not null;
create index resource_grant_team_ix on resource_grant (team_id) where team_id is not null;

alter table resource_grant enable row level security;
create policy resource_grant_organization on resource_grant
    using (organization_id = current_organization())
    with check (organization_id = current_organization());

-- Whether the person of the request administers its organization, set by the kernel on every
-- connection with the organization (OrganizationConnections), as current_guest() is.
create or replace function current_administrator() returns boolean
    language sql stable parallel safe
    as $$ select coalesce(current_setting('mosaikit.administrator', true), '') = 'true' $$;

-- Whether the request has at least a level on a resource of its organization: the check of
-- Sharing.allows(ref, level) for the queries of extensions, which filter and page large lists in the
-- database with it, such as
--   where mk_kernel.allows('dev.example.dashboards', 'dashboard', d.id::text, 'view')
-- The owner and the administrators of the organization hold every level; otherwise the highest
-- level among the grants to the person, to a team of theirs, to the organization (not for guests)
-- and to the public (always the lowest level). Links are not considered: they are opened by
-- requests without an organization, which the Java API answers. Security invoker: row-level
-- security limits the resources and grants to those of the organization of the request.
create or replace function allows(p_extension text, p_type text, p_ref_id text, p_level text)
    returns boolean
    language sql stable
    set search_path = mk_kernel, pg_temp
    as $$
    select exists (
        select 1
        from resource r
        join sharing_level needed
          on needed.extension_id = r.extension_id and needed.type = r.type and needed.level = p_level
        where r.organization_id = current_organization()
          and r.extension_id = p_extension and r.type = p_type and r.ref_id = p_ref_id
          and (
            (current_account() is not null and r.owner_id = current_account())
            or current_administrator()
            or exists (
                select 1
                from resource_grant g
                join sharing_level given
                  on given.extension_id = r.extension_id and given.type = r.type and given.level = g.level
                where g.resource_id = r.id
                  and case when g.subject_kind = 'public' then 0 else given.rank end >= needed.rank
                  and (
                    g.subject_kind = 'public'
                    or (g.subject_kind = 'organization' and current_account() is not null and not current_guest())
                    or (g.subject_kind = 'person' and g.account_id = current_account())
                    or (g.subject_kind = 'group' and exists (
                            select 1 from team_member m
                            where m.team_id = g.team_id and m.account_id = current_account()))
                  )
            )
          )
    ) $$;

-- The link whose secret has this SHA-256, with its resource, for a request that opens it without an
-- account and so without an organization, which row-level security would leave without rows.
-- Security definer: it answers only for the digest of a secret, which only the people who received
-- the link know; the kernel decides whether it expired or was revoked.
create or replace function shared_link(p_digest text)
    returns table (
        grant_id        uuid,
        organization_id uuid,
        resource_id     uuid,
        extension_id    varchar,
        type            varchar,
        ref_id          varchar,
        title           varchar,
        link            varchar,
        level           varchar,
        expires_at      timestamptz,
        password_hash   varchar,
        revoked_at      timestamptz)
    language sql stable security definer
    set search_path = mk_kernel, pg_temp
    as $$
    select g.id, g.organization_id, r.id, r.extension_id, r.type, r.ref_id, r.title, r.link, g.level,
           g.expires_at, g.password_hash, g.revoked_at
    from resource_grant g
    join resource r on r.id = g.resource_id
    where g.subject_kind = 'link' and g.token_digest = p_digest $$;
