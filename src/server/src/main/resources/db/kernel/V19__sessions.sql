-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-125: the sessions of people, kept by the kernel so that signing out, a suspension or the
-- removal from an organization ends them at once, and people see and end their own.
--
-- A session of the shell opened with a password is a long random value in an HttpOnly cookie, kept
-- here only as its SHA-256 digest, so that a copy of the database opens no session. A session opened
-- through the realm of an organization is the session of the realm (the sid claim of its tokens),
-- kept as the digest of the issuer and the sid: ending it here refuses its tokens, refreshed ones
-- included. Like remember_token, the table belongs to accounts and is read during authentication,
-- before any organization is known: it is not under row-level security.

create table account_session (
    id              uuid          primary key,
    account_id      uuid          not null,
    -- The organization the session last acted on, or null when it acted on none.
    organization_id uuid,
    token_digest    varchar(64)   not null,
    -- password: the cookie of the shell; realm: the tokens of the realm of an organization.
    kind            varchar(16)   not null,
    user_agent      varchar(300),
    address         varchar(64),
    created_at      timestamptz   not null,
    last_seen_at    timestamptz   not null,
    -- The session ends at the latest then, whatever its activity.
    expires_at      timestamptz   not null,
    ended_at        timestamptz,
    constraint account_session_digest_uk unique (token_digest),
    constraint account_session_kind_ck check (kind in ('password', 'realm')),
    constraint account_session_account_fk foreign key (account_id) references user_account (id) on delete cascade,
    constraint account_session_organization_fk foreign key (organization_id) references organization (id) on delete set null
);

create index account_session_account_ix on account_session (account_id);
create index account_session_expires_ix on account_session (expires_at);

-- "Remember me" belongs to the session it was asked in: ending that session revokes the token. When
-- the session ends by itself, the token opens a new one and moves to it.
alter table remember_token add column session_id uuid;
alter table remember_token add constraint remember_token_session_fk
    foreign key (session_id) references account_session (id) on delete set null;
create index remember_token_session_ix on remember_token (session_id) where session_id is not null;

-- A suspended account signs in no more, by any means, until an administrator reactivates it.
alter table user_account add column suspended_at timestamptz;
