-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-127: the credentials of the installation, which platform administrators keep for the extensions
-- of every organization: the account of a service shared by the whole installation, a mail relay, a
-- licence key. Sealed as those of organizations (V23), with the associated data bound to the scope of
-- the installation, so that a row copied between this table and the one of organizations does not
-- decrypt. The table belongs to no organization: the member role of requests has no right on it
-- (RowSecurity revokes them at every start), and row-level security without a policy shows it no
-- row should a grant come back. Only the kernel reads it, as the owner of the tables.

create table installation_secret (
    id              uuid         primary key,
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
    constraint installation_secret_name_uk unique (name),
    constraint installation_secret_kind_ck check (kind in ('password', 'token', 'key', 'other'))
);

-- The rows of a master key, for a rotation.
create index installation_secret_key_ix on installation_secret (key_id);

-- No policy: a role other than the owner sees and writes no row.
alter table installation_secret enable row level security;
