-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-060: personal access keys, for scripts, command-line tools and other clients that cannot use the
-- session of the browser. A key acts for its person in one organization, with the rights the person
-- has there at the time of each call, and only reads unless it was created with the write switch.
--
-- The secret is shown once, when the key is created, and kept here only as its SHA-256 digest, so
-- that a copy of the database opens nothing. The prefix is the start of the secret, kept to tell keys
-- apart in the list. Like account_session, the table is read during authentication, before any
-- organization is known: it is not under row-level security.
--
-- Revoked and expired keys are kept, so that the audit log and the list keep naming them; nothing
-- removes them by itself. Service identities (MK-124) may add a holder other than an account.

create table access_key (
    id              uuid          primary key,
    account_id      uuid          not null,
    organization_id uuid          not null,
    name            varchar(100)  not null,
    prefix          varchar(16)   not null,
    token_digest    varchar(64)   not null,
    -- Whether the key may change anything: without it, only GET, HEAD and OPTIONS pass.
    can_write       boolean       not null,
    created_at      timestamptz   not null,
    expires_at      timestamptz   not null,
    last_used_at    timestamptz,
    revoked_at      timestamptz,
    constraint access_key_digest_uk unique (token_digest),
    constraint access_key_account_fk foreign key (account_id) references user_account (id) on delete cascade,
    constraint access_key_organization_fk foreign key (organization_id) references organization (id) on delete cascade
);

create index access_key_account_ix on access_key (account_id);
