-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-032: teams, groups of an organization with owners, members and guests. A guest is a person of
-- another organization, member of this one with the role organization-guest only, who sees the
-- teams where they were added and nothing else. The documents of plugins can be shared with a team:
-- row-level security lets only its members read them.

create table team (
    id              uuid         primary key,
    organization_id uuid         not null,
    name            varchar(100) not null,
    description     varchar(500) not null,
    visibility      varchar(16)  not null,
    created_at      timestamptz  not null,
    created_by      varchar(255) not null,
    constraint team_visibility_ck check (visibility in ('public', 'private')),
    constraint team_name_uk unique (organization_id, name),
    constraint team_organization_fk foreign key (organization_id) references organization (id) on delete cascade
);

create table team_member (
    team_id    uuid        not null,
    account_id uuid        not null,
    role       varchar(16) not null,
    added_at   timestamptz not null,
    constraint team_member_pk primary key (team_id, account_id),
    constraint team_member_role_ck check (role in ('owner', 'member', 'guest')),
    constraint team_member_team_fk foreign key (team_id) references team (id) on delete cascade,
    constraint team_member_account_fk foreign key (account_id) references user_account (id) on delete cascade
);

create index team_member_account_ix on team_member (account_id);

-- The person of the request and whether they are a guest of its organization, set by the kernel
-- on every connection with the organization (RowSecurity).
create or replace function current_account() returns uuid
    language sql stable parallel safe
    as $$ select nullif(current_setting('mosaikit.account', true), '')::uuid $$;

create or replace function current_guest() returns boolean
    language sql stable parallel safe
    as $$ select coalesce(current_setting('mosaikit.guest', true), '') = 'true' $$;

alter table plugin_document add column team_id uuid;
alter table plugin_document add constraint plugin_document_team_fk
    foreign key (team_id) references team (id) on delete cascade;
create index plugin_document_team_ix on plugin_document (team_id) where team_id is not null;

-- A document of the organization is for its members, not its guests; a document of a team is for
-- the members of the team only.
drop policy plugin_document_organization on plugin_document;
create policy plugin_document_access on plugin_document
    using (organization_id = current_organization()
        and case
            when team_id is null then not current_guest()
            else exists (select 1 from team_member m
                         where m.team_id = plugin_document.team_id and m.account_id = current_account())
        end)
    with check (organization_id = current_organization()
        and case
            when team_id is null then not current_guest()
            else exists (select 1 from team_member m
                         where m.team_id = plugin_document.team_id and m.account_id = current_account())
        end);
