-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-062: the credentials and service keys that the administrators of an organization keep for its
-- extensions. Envelope encryption: the value is encrypted with AES-256-GCM under a data key of its
-- own, and the data key under a master key of the installation that never goes in the database;
-- key_id names that master key, so that a rotation can find the rows still under a former one. Both
-- encryptions bind the ciphertext to the organization and the name, so a row copied or swapped does
-- not decrypt. The hint is what people see of the value, masked. Under row-level security like the
-- registry of resources (V16): a request sees and writes only the credentials of its organization.

create table secret (
    id              uuid         primary key,
    organization_id uuid         not null default current_organization(),
    name            varchar(100) not null,
    kind            varchar(16)  not null,
    description     varchar(500) not null,
    -- The extension the credential is meant for, the only one that reads it; null for any extension.
    extension_id    varchar(255),
    hint            varchar(16)  not null,
    key_id          varchar(16)  not null,
    wrapped_key     bytea        not null,
    ciphertext      bytea        not null,
    created_at      timestamptz  not null,
    updated_at      timestamptz  not null,
    -- Who stored or last changed it; no foreign key: the row stays when they leave.
    updated_by      varchar(320) not null,
    constraint secret_name_uk unique (organization_id, name),
    constraint secret_kind_ck check (kind in ('password', 'token', 'key', 'other')),
    constraint secret_organization_fk foreign key (organization_id) references organization (id) on delete cascade
);

-- The rows of a master key, for a rotation.
create index secret_key_ix on secret (key_id);

alter table secret enable row level security;
create policy secret_organization on secret
    using (organization_id = current_organization())
    with check (organization_id = current_organization());
