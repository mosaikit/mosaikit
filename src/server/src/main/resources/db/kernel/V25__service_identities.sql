-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-124: service identities, for the internal callers of the APIs of extensions that are not people,
-- such as a gateway that asks the kernel whether a session or a key is valid, or a server that maps a
-- key to a person through an extension. A platform administrator creates them; each has its own keys
-- (mks_...), the APIs of extensions it may call, the endpoints of the kernel meant for services it may
-- call, and the organizations it may name with the X-Mosaikit-Organization header. It belongs to no
-- organization, has no password and never opens the shell.
--
-- The grants are kept as comma-separated names, as the roles of organization_member. Like access_key,
-- both tables are read during authentication, before any organization is known, and belong to the
-- platform: they are not under row-level security.
--
-- Revoked keys are kept, so that the audit log and the list keep naming them; nothing removes them
-- by itself.

create table service_identity (
    id              uuid           primary key,
    name            varchar(100)   not null,
    description     varchar(500)   not null default '',
    -- Names of the APIs of extensions, as in /api/v1/ext/<api>/.
    apis            varchar(2000)  not null default '',
    -- Endpoints of the kernel meant for services: check-session, check-key.
    endpoints       varchar(255)   not null default '',
    -- Identifiers of the organizations the identity may name with X-Mosaikit-Organization.
    organizations   varchar(4000)  not null default '',
    created_at      timestamptz    not null,
    created_by      varchar(255)   not null,
    constraint service_identity_name_uk unique (name)
);

create table service_key (
    id              uuid          primary key,
    service_id      uuid          not null,
    prefix          varchar(16)   not null,
    token_digest    varchar(64)   not null,
    created_at      timestamptz   not null,
    last_used_at    timestamptz,
    revoked_at      timestamptz,
    constraint service_key_digest_uk unique (token_digest),
    constraint service_key_identity_fk foreign key (service_id) references service_identity (id) on delete cascade
);

create index service_key_identity_ix on service_key (service_id);
