-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- ADR-0031, MK-046: the documents of plugins without a backend, in collections that their manifest
-- declares. Under row-level security like the tables of plugins (ADR-0018): a request sees and
-- writes only the documents of its organization.

create table plugin_document (
    id              uuid primary key,
    organization_id uuid         not null default current_organization(),
    plugin_id       varchar(255) not null,
    collection      varchar(64)  not null,
    data            jsonb        not null,
    version         integer      not null,
    created_at      timestamptz  not null,
    created_by      varchar(255) not null,
    updated_at      timestamptz  not null,
    updated_by      varchar(255) not null,
    constraint plugin_document_organization_fk foreign key (organization_id)
        references organization (id) on delete cascade
);

create index plugin_document_collection_ix
    on plugin_document (organization_id, plugin_id, collection, updated_at desc);

alter table plugin_document enable row level security;
create policy plugin_document_organization on plugin_document
    using (organization_id = current_organization())
    with check (organization_id = current_organization());
