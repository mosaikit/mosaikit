-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-056, ADR-0038: the permissions that extensions declare in their manifests, granted in each
-- organization through profiles, teams and personal exceptions. A profile is a named set of
-- permissions; each member has one profile, the one assigned to them or else the default profile of
-- their role. Teams and exceptions add permissions to that. The administrators of the organization
-- hold every permission without any row here, and guests only those of their teams and exceptions.
-- A permission is named by its extension and its name; one that the manifest of the extension no
-- longer declares is never granted. Under row-level security like the registry of resources (V16).

create table permission_profile (
    id               uuid         primary key,
    organization_id  uuid         not null default current_organization(),
    name             varchar(100) not null,
    description      varchar(500) not null,
    -- The role whose members without a profile of their own get this one, or null.
    default_for_role varchar(64),
    created_at       timestamptz  not null,
    updated_at       timestamptz  not null,
    constraint permission_profile_role_ck check (default_for_role in ('organization-user')),
    constraint permission_profile_organization_fk foreign key (organization_id)
        references organization (id) on delete cascade
);

create unique index permission_profile_name_uk on permission_profile (organization_id, lower(name));
create unique index permission_profile_default_uk on permission_profile (organization_id, default_for_role)
    where default_for_role is not null;

-- The profile assigned to a member; without a row the member has the default profile of their role.
create table member_profile (
    id              uuid        primary key,
    organization_id uuid        not null default current_organization(),
    account_id      uuid        not null,
    profile_id      uuid        not null,
    assigned_at     timestamptz not null,
    constraint member_profile_uk unique (organization_id, account_id),
    constraint member_profile_member_fk foreign key (account_id, organization_id)
        references organization_member (account_id, organization_id) on delete cascade,
    constraint member_profile_profile_fk foreign key (profile_id) references permission_profile (id) on delete cascade
);

create index member_profile_profile_ix on member_profile (profile_id);

-- A permission granted to exactly one of: a profile, a team, a member as a personal exception.
create table permission_grant (
    id              uuid         primary key,
    organization_id uuid         not null default current_organization(),
    extension_id    varchar(255) not null,
    permission      varchar(48)  not null,
    profile_id      uuid,
    team_id         uuid,
    account_id      uuid,
    granted_at      timestamptz  not null,
    constraint permission_grant_one_subject_ck check (num_nonnulls(profile_id, team_id, account_id) = 1),
    constraint permission_grant_organization_fk foreign key (organization_id)
        references organization (id) on delete cascade,
    constraint permission_grant_profile_fk foreign key (profile_id) references permission_profile (id) on delete cascade,
    constraint permission_grant_team_fk foreign key (team_id) references team (id) on delete cascade,
    constraint permission_grant_member_fk foreign key (account_id, organization_id)
        references organization_member (account_id, organization_id) on delete cascade
);

create unique index permission_grant_profile_uk on permission_grant (profile_id, extension_id, permission)
    where profile_id is not null;
create unique index permission_grant_team_uk on permission_grant (team_id, extension_id, permission)
    where team_id is not null;
create unique index permission_grant_member_uk on permission_grant (organization_id, account_id, extension_id, permission)
    where account_id is not null;
create index permission_grant_extension_ix on permission_grant (extension_id);

alter table permission_profile enable row level security;
create policy permission_profile_organization on permission_profile
    using (organization_id = current_organization())
    with check (organization_id = current_organization());

alter table member_profile enable row level security;
create policy member_profile_organization on member_profile
    using (organization_id = current_organization())
    with check (organization_id = current_organization());

alter table permission_grant enable row level security;
create policy permission_grant_organization on permission_grant
    using (organization_id = current_organization())
    with check (organization_id = current_organization());
