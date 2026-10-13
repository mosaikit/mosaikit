-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-041, ADR-0029: the files of extensions. The content is in the store of the installation (a
-- directory, or an S3-compatible bucket) under the key <organization>/<extension>/<id>; this table
-- keeps what the kernel knows of each file. Under row-level security like the documents of
-- extensions (V12): a file of the organization is for its members, not its guests; a file of a team
-- is for the people of the team only.

create table stored_file (
    id              uuid          primary key,
    organization_id uuid          not null default current_organization(),
    extension_id    varchar(255)  not null,
    -- The person who stored the file, or null when stored without a person or after they left.
    owner_id        uuid,
    -- The team the file is shared with (MK-032), or null for a file of the organization.
    team_id         uuid,
    name            varchar(255)  not null,
    content_type    varchar(255)  not null,
    size            bigint        not null,
    -- The SHA-256 of the content, in hexadecimal: also the entity tag of the file.
    checksum        varchar(64)   not null,
    storage_key     varchar(600)  not null,
    -- The registered resource the file belongs to (MK-054), so that sharing (MK-055) can govern it.
    resource_id     uuid,
    created_at      timestamptz   not null,
    updated_at      timestamptz   not null,
    constraint stored_file_size_ck check (size >= 0),
    constraint stored_file_key_uk unique (storage_key),
    constraint stored_file_organization_fk foreign key (organization_id) references organization (id) on delete cascade,
    constraint stored_file_owner_fk foreign key (owner_id) references user_account (id) on delete set null,
    constraint stored_file_team_fk foreign key (team_id) references team (id) on delete cascade,
    constraint stored_file_resource_fk foreign key (resource_id) references resource (id) on delete set null
);

create index stored_file_extension_ix on stored_file (organization_id, extension_id, created_at desc);
create index stored_file_team_ix on stored_file (team_id) where team_id is not null;
create index stored_file_owner_ix on stored_file (owner_id) where owner_id is not null;
create index stored_file_resource_ix on stored_file (resource_id) where resource_id is not null;

alter table stored_file enable row level security;
create policy stored_file_access on stored_file
    using (organization_id = current_organization()
        and case
            when team_id is null then not current_guest()
            else exists (select 1 from team_member m
                         where m.team_id = stored_file.team_id and m.account_id = current_account())
        end)
    with check (organization_id = current_organization()
        and case
            when team_id is null then not current_guest()
            else exists (select 1 from team_member m
                         where m.team_id = stored_file.team_id and m.account_id = current_account())
        end);
