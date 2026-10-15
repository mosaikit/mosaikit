-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-096 on MK-054: the version history of the resources of extensions. A version belongs to an entry
-- of the registry (V16) and goes with it when the entry is removed. It holds either a snapshot that the
-- kernel keeps, or a file of the extension stored with the file service (V24), and goes with that file
-- when the extension deletes it. The author is the person who saved it, absent for code without a
-- person or after the person left. Under row-level security like the registry: a request sees and
-- writes only the versions of its organization.

create table resource_version (
    id              uuid          primary key,
    organization_id uuid          not null default current_organization(),
    resource_id     uuid          not null,
    -- From 1 within a resource, the newest the highest.
    number          integer       not null,
    author_id       uuid,
    created_at      timestamptz   not null,
    media_type      varchar(255)  not null,
    size            bigint        not null,
    snapshot        bytea,
    file_id         uuid,
    -- The number of the version that this one restores, or null for a save.
    restored_from   integer,
    constraint resource_version_number_uk unique (resource_id, number),
    constraint resource_version_organization_fk foreign key (organization_id) references organization (id) on delete cascade,
    constraint resource_version_resource_fk foreign key (resource_id) references resource (id) on delete cascade,
    constraint resource_version_author_fk foreign key (author_id) references user_account (id) on delete set null,
    constraint resource_version_file_fk foreign key (file_id) references stored_file (id) on delete cascade,
    constraint resource_version_content_ck check ((snapshot is null) <> (file_id is null)),
    constraint resource_version_number_ck check (number > 0)
);

-- The unique key serves the versions of a resource; these the foreign keys.
create index resource_version_organization_ix on resource_version (organization_id);
create index resource_version_author_ix on resource_version (author_id) where author_id is not null;
create index resource_version_file_ix on resource_version (file_id) where file_id is not null;

alter table resource_version enable row level security;
create policy resource_version_organization on resource_version
    using (organization_id = current_organization())
    with check (organization_id = current_organization());
