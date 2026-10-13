-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-054, ADR-0037: the registry of the resources of extensions. An extension registers each of
-- its resources (type, identifier, title, owner, link, parent); the data stay in the extension. The
-- generic features of the kernel, starting with the grants of sharing (MK-055), refer to an entry
-- by its id and go with it when it is removed. Under row-level security like the documents of
-- extensions (V6): a request sees and writes only the entries of its organization.

create table resource (
    id              uuid          primary key,
    organization_id uuid          not null default current_organization(),
    extension_id    varchar(255)  not null,
    type            varchar(48)   not null,
    ref_id          varchar(200)  not null,
    -- The person who owns the resource, or null when the organization owns it (registered without
    -- a person, or after its owner left).
    owner_id        uuid,
    title           varchar(200)  not null,
    link            varchar(2000) not null,
    parent_id       uuid,
    created_at      timestamptz   not null,
    updated_at      timestamptz   not null,
    constraint resource_ref_uk unique (organization_id, extension_id, type, ref_id),
    constraint resource_organization_fk foreign key (organization_id) references organization (id) on delete cascade,
    constraint resource_owner_fk foreign key (owner_id) references user_account (id) on delete set null,
    constraint resource_parent_fk foreign key (parent_id) references resource (id) on delete set null,
    constraint resource_not_own_parent_ck check (parent_id is null or parent_id <> id)
);

-- The unique key serves the lists of a type; these serve the lists by owner, the removal of the
-- entries of an extension that is no longer installed, and the foreign keys.
create index resource_owner_ix on resource (organization_id, extension_id, type, owner_id);
create index resource_extension_ix on resource (extension_id);
create index resource_owner_account_ix on resource (owner_id) where owner_id is not null;
create index resource_parent_ix on resource (parent_id) where parent_id is not null;

alter table resource enable row level security;
create policy resource_organization on resource
    using (organization_id = current_organization())
    with check (organization_id = current_organization());
